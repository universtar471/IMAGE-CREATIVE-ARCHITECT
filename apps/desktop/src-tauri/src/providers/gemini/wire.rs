//! `generateContent` request/response shapes and error mapping (pure, no I/O).
//!
//! Reference: https://ai.google.dev/api/generate-content (GenerationConfig.imageConfig,
//! PromptFeedback.blockReason, Candidate.finishReason), checked 2026-10-08.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

pub use super::super::text::sanitize;
use super::super::text::truncate;
use super::super::{GenerationParams, PromptText, ProviderError, ProviderErrorKind, ProviderImage, ReferenceImage};
use super::prompt::{compose_prompt, reference_label};

/// Body for `POST models/{model}:generateContent`. Part order: the composed prompt, then for
/// each reference (in request order) a label text part followed by its inline image.
pub fn build_request(prompt: &PromptText, references: &[ReferenceImage], params: &GenerationParams) -> Value {
    let mut parts = vec![json!({ "text": compose_prompt(prompt) })];
    for (i, reference) in references.iter().enumerate() {
        parts.push(json!({ "text": reference_label(i + 1, &reference.role) }));
        parts.push(json!({
            "inlineData": { "mimeType": reference.mime_type, "data": B64.encode(&reference.bytes) }
        }));
    }

    let mut generation_config = json!({ "responseModalities": ["TEXT", "IMAGE"] });
    let mut image_config = serde_json::Map::new();
    if let Some(ratio) = &params.aspect_ratio {
        image_config.insert("aspectRatio".into(), json!(ratio));
    }
    if let Some(size) = &params.image_size {
        image_config.insert("imageSize".into(), json!(size));
    }
    if !image_config.is_empty() {
        generation_config["imageConfig"] = Value::Object(image_config);
    }

    json!({
        "contents": [{ "role": "user", "parts": parts }],
        "generationConfig": generation_config,
    })
}

/// What one successful call produced. Every string here is already key-redacted and capped.
#[derive(Debug, Default)]
pub struct CallResult {
    pub images: Vec<ProviderImage>,
    /// One entry per candidate that reported a finish reason, in response order.
    pub finish_reasons: Vec<String>,
    pub model_version: Option<String>,
    pub text: Option<String>,
}

/// Finish / block reasons that mean the provider refused on policy grounds.
const BLOCKED_REASONS: [&str; 8] = [
    "SAFETY",
    "PROHIBITED_CONTENT",
    "BLOCKLIST",
    "SPII",
    "RECITATION",
    "IMAGE_SAFETY",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
];

/// Cap for enum-like vendor strings (finish reasons, model versions).
const MAX_VENDOR_ID: usize = 64;

/// Interpret an HTTP 200 body. `api_key` is only used to redact echoes of it: every vendor
/// string that ends up in an error message or in `CallResult` goes through [`sanitize`].
///
/// Finish reasons are judged per candidate: images of a candidate that finished with a policy
/// reason are dropped, images of other candidates are kept. No image left plus any policy
/// reason means `Blocked`.
pub fn parse_success(body: &Value, api_key: &str) -> Result<CallResult, ProviderError> {
    let clean_id = |s: &str| truncate(&sanitize(s, api_key), MAX_VENDOR_ID);

    if let Some(reason) = body.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(ProviderError::new(
            ProviderErrorKind::Blocked,
            format!(
                "Gemini blocked the prompt ({}). Rephrase the prompt or change the reference images.",
                clean_id(reason)
            ),
        ));
    }

    let mut result = CallResult {
        model_version: body.get("modelVersion").and_then(Value::as_str).map(clean_id),
        ..CallResult::default()
    };
    let mut blocked_reason: Option<String> = None;
    let mut texts = Vec::new();
    for candidate in body.get("candidates").and_then(Value::as_array).into_iter().flatten() {
        let reason = candidate.get("finishReason").and_then(Value::as_str);
        let blocked = reason.is_some_and(|r| BLOCKED_REASONS.contains(&r));
        if let Some(reason) = reason {
            result.finish_reasons.push(clean_id(reason));
            if blocked && blocked_reason.is_none() {
                blocked_reason = Some(reason.to_string()); // a known enum value, no vendor free text
            }
        }
        let parts = candidate.pointer("/content/parts").and_then(Value::as_array);
        for part in parts.into_iter().flatten() {
            // Interim "thought images" are not outputs.
            if part.get("thought").and_then(Value::as_bool).unwrap_or(false) {
                continue;
            }
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                texts.push(text.to_string());
            }
            if blocked {
                continue;
            }
            if let Some(image) = parse_inline_image(part)? {
                result.images.push(image);
            }
        }
    }
    let text = sanitize(&texts.join(" "), api_key);
    result.text = (!text.is_empty()).then_some(text);

    if !result.images.is_empty() {
        return Ok(result);
    }
    if let Some(reason) = blocked_reason {
        return Err(ProviderError::new(
            ProviderErrorKind::Blocked,
            format!("Gemini refused to generate this image ({reason}). Adjust the prompt or the reference images."),
        ));
    }
    let reasons = if result.finish_reasons.is_empty() { "none".to_string() } else { result.finish_reasons.join(", ") };
    let mut message = format!("Gemini returned no image (finish reason: {reasons}).");
    if let Some(text) = &result.text {
        message.push_str(&format!(" Model said: \"{text}\""));
    }
    Err(ProviderError::new(ProviderErrorKind::BadResponse, message))
}

fn parse_inline_image(part: &Value) -> Result<Option<ProviderImage>, ProviderError> {
    // The REST API answers in camelCase; snake_case is accepted defensively.
    let Some(inline) = part.get("inlineData").or_else(|| part.get("inline_data")) else {
        return Ok(None);
    };
    let mime_type =
        inline.get("mimeType").or_else(|| inline.get("mime_type")).and_then(Value::as_str).unwrap_or_default();
    if !mime_type.starts_with("image/") {
        return Ok(None);
    }
    let data = inline.get("data").and_then(Value::as_str).unwrap_or_default();
    let bytes = B64.decode(data).map_err(|_| {
        ProviderError::new(ProviderErrorKind::BadResponse, "Gemini returned image data that could not be decoded.")
    })?;
    if bytes.is_empty() {
        return Ok(None);
    }
    Ok(Some(ProviderImage { mime_type: mime_type.to_string(), bytes }))
}

/// Map a non-200 HTTP status (plus the Google error JSON, if any) to a short, key-free message.
pub fn map_http_error(status: u16, body: &str, api_key: &str) -> ProviderError {
    use ProviderErrorKind::*;

    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let error = parsed.as_ref().and_then(|v| v.get("error"));
    let vendor_message = error.and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or_default();
    let key_invalid = error
        .and_then(|e| e.get("details"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|d| d.get("reason").and_then(Value::as_str) == Some("API_KEY_INVALID"))
        || vendor_message.contains("API key not valid")
        || vendor_message.contains("API key expired");
    let detail = sanitize(vendor_message, api_key);
    let with_detail = |base: String| if detail.is_empty() { base } else { format!("{base} Gemini says: \"{detail}\"") };

    match status {
        401 | 403 => ProviderError::new(
            Auth,
            with_detail(format!(
                "Gemini refused the API key (HTTP {status}). Check the key in provider settings and that it has access \
                 to this model."
            )),
        ),
        400 if key_invalid => ProviderError::new(
            Auth,
            "Gemini rejected the API key as invalid. Paste a valid key from Google AI Studio in provider settings.",
        ),
        404 => ProviderError::new(
            InvalidRequest,
            with_detail("Gemini does not offer this model for your key (HTTP 404). Pick another model.".into()),
        ),
        429 if quota_exhausted(error) => ProviderError::new(
            // Not `RateLimited`: the queue would retry it 15 s and 60 s later and fail the same way.
            Auth,
            "Gemini says the quota for this model is used up (HTTP 429): the free tier has no or no remaining \
             image quota, or a daily limit was reached. Enable billing for the key's project in Google AI Studio \
             (aistudio.google.com), or wait for the daily reset, then retry.",
        ),
        429 => ProviderError::new(
            RateLimited,
            "Gemini rate limit or quota reached (HTTP 429). Wait a minute and retry, or check your quota in Google AI \
             Studio.",
        ),
        500..=599 => {
            ProviderError::new(Network, format!("Gemini service error (HTTP {status}). Try again in a moment."))
        }
        _ => ProviderError::new(InvalidRequest, with_detail(format!("Gemini rejected the request (HTTP {status})."))),
    }
}

/// True when a 429 carries a `google.rpc.QuotaFailure` violation that waiting a minute will
/// not fix: a free-tier quota (image models have none, so its limit is 0), a quota whose limit
/// is 0, or a per-day quota. Any other 429 (no details, per-minute paid quota) is a plain,
/// retryable rate limit.
fn quota_exhausted(error: Option<&Value>) -> bool {
    let details = error.and_then(|e| e.get("details")).and_then(Value::as_array).into_iter().flatten();
    details
        .filter(|d| d.get("@type").and_then(Value::as_str).is_some_and(|t| t.ends_with("google.rpc.QuotaFailure")))
        .filter_map(|d| d.get("violations").and_then(Value::as_array))
        .flatten()
        .any(|violation| {
            let field = |name: &str| violation.get(name).and_then(Value::as_str).unwrap_or_default();
            let (id, metric) = (field("quotaId"), field("quotaMetric"));
            id.contains("FreeTier")
                || metric.contains("free_tier")
                || id.contains("PerDay")
                || field("quotaValue") == "0"
        })
}
