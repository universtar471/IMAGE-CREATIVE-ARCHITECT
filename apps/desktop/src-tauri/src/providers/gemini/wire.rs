//! `generateContent` request/response shapes and error mapping (pure, no I/O).
//!
//! Reference: https://ai.google.dev/api/generate-content (GenerationConfig.imageConfig,
//! PromptFeedback.blockReason, Candidate.finishReason), checked 2026-10-08.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

use super::super::{GenerationParams, PromptText, ProviderError, ProviderErrorKind, ProviderImage, ReferenceImage};
use super::prompt::{compose_prompt, reference_label};

/// Max characters of vendor text (model notes, error messages) copied into a user message.
pub const MAX_VENDOR_TEXT: usize = 200;

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

/// What one successful call produced.
#[derive(Debug, Default)]
pub struct CallResult {
    pub images: Vec<ProviderImage>,
    pub finish_reason: Option<String>,
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

/// Interpret an HTTP 200 body.
pub fn parse_success(body: &Value) -> Result<CallResult, ProviderError> {
    if let Some(reason) = body.pointer("/promptFeedback/blockReason").and_then(Value::as_str) {
        return Err(ProviderError::new(
            ProviderErrorKind::Blocked,
            format!("Gemini blocked the prompt ({reason}). Rephrase the prompt or change the reference images."),
        ));
    }

    let mut result = CallResult {
        model_version: body.get("modelVersion").and_then(Value::as_str).map(String::from),
        ..CallResult::default()
    };
    let mut texts = Vec::new();
    for candidate in body.get("candidates").and_then(Value::as_array).into_iter().flatten() {
        if result.finish_reason.is_none() {
            result.finish_reason = candidate.get("finishReason").and_then(Value::as_str).map(String::from);
        }
        let parts = candidate.pointer("/content/parts").and_then(Value::as_array);
        for part in parts.into_iter().flatten() {
            // Interim "thought images" are not outputs.
            if part.get("thought").and_then(Value::as_bool).unwrap_or(false) {
                continue;
            }
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                texts.push(text.trim().to_string());
            }
            if let Some(image) = parse_inline_image(part)? {
                result.images.push(image);
            }
        }
    }
    let text = texts.into_iter().filter(|t| !t.is_empty()).collect::<Vec<_>>().join(" ");
    result.text = (!text.is_empty()).then(|| truncate(&text, MAX_VENDOR_TEXT));

    if !result.images.is_empty() {
        return Ok(result);
    }
    let reason = result.finish_reason.as_deref().unwrap_or("none");
    if BLOCKED_REASONS.contains(&reason) {
        return Err(ProviderError::new(
            ProviderErrorKind::Blocked,
            format!("Gemini refused to generate this image ({reason}). Adjust the prompt or the reference images."),
        ));
    }
    let mut message = format!("Gemini returned no image (finish reason: {reason}).");
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

/// Collapse whitespace, strip the key if it was echoed, and cap the length.
pub fn sanitize(text: &str, api_key: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let redacted = if api_key.is_empty() { collapsed } else { collapsed.replace(api_key, "[redacted]") };
    truncate(&redacted, MAX_VENDOR_TEXT)
}

fn truncate(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
}
