//! Images API request/response shapes and error mapping (pure, no I/O).
//!
//! References, checked 2026-10-09:
//! - `POST /images/generations`: https://developers.openai.com/api/reference/resources/images/methods/generate
//! - `POST /images/edits`: https://developers.openai.com/api/reference/resources/images/methods/edit
//! - error codes: https://developers.openai.com/api/docs/guides/error-codes
//! - moderation errors (`moderation_blocked`, `image_generation_user_error`):
//!   https://developers.openai.com/api/docs/guides/image-generation#content-moderation

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use reqwest::blocking::multipart::{Form, Part};
use serde_json::{json, Value};

use super::super::text::{sanitize, truncate};
use super::super::{ProviderError, ProviderErrorKind, ProviderImage, ReferenceImage};
use super::models::QUALITY;

/// Every request asks for PNG (also the API default), so outputs are lossless.
pub const OUTPUT_FORMAT: &str = "png";

/// Cap for enum-like vendor strings (error codes, sizes, formats).
const MAX_VENDOR_ID: usize = 64;

/// JSON body for `POST /images/generations` (no references).
pub fn generation_body(model: &str, prompt: &str, n: u32, size: Option<&str>) -> Value {
    let mut body = json!({
        "model": model,
        "prompt": prompt,
        "n": n,
        "quality": QUALITY,
        "output_format": OUTPUT_FORMAT,
    });
    if let Some(size) = size {
        body["size"] = json!(size);
    }
    body
}

/// Multipart body for `POST /images/edits`: the same fields as text parts, then one `image[]`
/// file part per reference, in request order (the prompt numbers them in that order).
pub fn edit_form(
    model: &str,
    prompt: &str,
    n: u32,
    size: Option<&str>,
    references: &[ReferenceImage],
) -> Result<Form, ProviderError> {
    let mut form = Form::new()
        .text("model", model.to_string())
        .text("prompt", prompt.to_string())
        .text("n", n.to_string())
        .text("quality", QUALITY)
        .text("output_format", OUTPUT_FORMAT);
    if let Some(size) = size {
        form = form.text("size", size.to_string());
    }
    for (i, reference) in references.iter().enumerate() {
        let part = Part::bytes(reference.bytes.clone())
            .file_name(format!("reference-{}.{}", i + 1, extension(&reference.mime_type)))
            .mime_str(&reference.mime_type)
            .map_err(|_| {
                ProviderError::new(
                    ProviderErrorKind::InvalidRequest,
                    format!("Reference image {} has an unusable file type.", i + 1),
                )
            })?;
        form = form.part("image[]", part);
    }
    Ok(form)
}

fn extension(mime_type: &str) -> &'static str {
    match mime_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "img",
    }
}

/// What one successful call produced. Every string here is already key-redacted and capped.
#[derive(Debug, Default)]
pub struct CallResult {
    pub images: Vec<ProviderImage>,
    pub size: Option<String>,
    pub quality: Option<String>,
    pub output_format: Option<String>,
}

/// Interpret an HTTP 200 `ImagesResponse`: `data[].b64_json` (GPT Image models always answer
/// in base64; `url` is unsupported for them). `api_key` is only used to redact echoes of it.
pub fn parse_success(body: &Value, api_key: &str) -> Result<CallResult, ProviderError> {
    let clean_id = |s: &str| truncate(&sanitize(s, api_key), MAX_VENDOR_ID);
    let field = |name: &str| body.get(name).and_then(Value::as_str).map(clean_id);
    let mut result = CallResult {
        size: field("size"),
        quality: field("quality"),
        output_format: field("output_format"),
        ..Default::default()
    };
    let mime_type = match result.output_format.as_deref() {
        Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        _ => "image/png",
    };
    for item in body.get("data").and_then(Value::as_array).into_iter().flatten() {
        let Some(data) = item.get("b64_json").and_then(Value::as_str) else {
            continue;
        };
        let bytes = B64.decode(data).map_err(|_| {
            ProviderError::new(ProviderErrorKind::BadResponse, "OpenAI returned image data that could not be decoded.")
        })?;
        if !bytes.is_empty() {
            result.images.push(ProviderImage { mime_type: mime_type.to_string(), bytes });
        }
    }
    if result.images.is_empty() {
        return Err(ProviderError::new(ProviderErrorKind::BadResponse, "OpenAI answered without an image."));
    }
    Ok(result)
}

/// `error.code` / `error.type` values that mean money or a spend/usage cap, not request pace.
/// Retrying them "won't restore API access" (error-codes guide), so they are not retryable.
const BILLING_CODES: [&str; 5] = [
    "insufficient_quota",
    "credit_balance_exhausted",
    "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded",
    "organization_usage_limit_exceeded",
];

/// Codes of a request refused by the safety system (`content_policy_violation` is the older
/// spelling of the same refusal).
const MODERATION_CODES: [&str; 2] = ["moderation_blocked", "content_policy_violation"];

/// Map a non-200 HTTP status (plus the OpenAI error JSON, if any) to a short, key-free message.
pub fn map_http_error(status: u16, body: &str, api_key: &str) -> ProviderError {
    use ProviderErrorKind::*;

    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let error = parsed.as_ref().and_then(|v| v.get("error"));
    let field = |name: &str| error.and_then(|e| e.get(name)).and_then(Value::as_str).unwrap_or_default();
    let (code, kind) = (field("code"), field("type"));
    let is = |list: &[&str]| list.contains(&code) || list.contains(&kind);
    let detail = sanitize(field("message"), api_key);
    let with_detail = |base: String| if detail.is_empty() { base } else { format!("{base} OpenAI says: \"{detail}\"") };

    match status {
        401 => ProviderError::new(
            Auth,
            with_detail(
                "OpenAI rejected the API key (HTTP 401). Paste a valid key from platform.openai.com/api-keys in \
                 provider settings."
                    .into(),
            ),
        ),
        403 => ProviderError::new(
            Auth,
            with_detail(
                "OpenAI denied access (HTTP 403). GPT Image models can require Organization Verification \
                 (platform.openai.com/settings/organization/general); the API is also unavailable in some regions."
                    .into(),
            ),
        ),
        429 if is(&BILLING_CODES) => ProviderError::new(
            // Not `RateLimited`: the queue would retry it 15 s and 60 s later and fail the same way.
            Auth,
            format!(
                "OpenAI says the account has no credit left or reached a spend or usage limit (HTTP 429, {}). Add \
                 credits at platform.openai.com/settings/organization/billing or raise the limit, then retry.",
                truncate(&sanitize(if code.is_empty() { kind } else { code }, api_key), MAX_VENDOR_ID)
            ),
        ),
        429 => ProviderError::new(
            RateLimited,
            "OpenAI rate limit reached (HTTP 429). The job is retried automatically; new accounts have low image \
             limits per minute.",
        ),
        400..=499 if is(&MODERATION_CODES) => ProviderError::new(
            Blocked,
            "OpenAI's safety system blocked this request. Rephrase the prompt or change the reference images.",
        ),
        404 => ProviderError::new(
            InvalidRequest,
            with_detail("OpenAI does not offer this model to your key (HTTP 404). Pick another model.".into()),
        ),
        500..=599 => {
            ProviderError::new(Network, format!("OpenAI service error (HTTP {status}). Try again in a moment."))
        }
        _ => ProviderError::new(InvalidRequest, with_detail(format!("OpenAI rejected the request (HTTP {status})."))),
    }
}
