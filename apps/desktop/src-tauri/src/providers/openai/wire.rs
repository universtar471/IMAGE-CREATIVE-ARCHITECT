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
use super::Flavor;

/// Every request asks for PNG (also the API default), so outputs are lossless.
pub const OUTPUT_FORMAT: &str = "png";

/// Cap for enum-like vendor strings (error codes, sizes, formats).
const MAX_VENDOR_ID: usize = 64;

/// The request fields shared by both endpoints.
#[derive(Clone, Copy)]
pub struct Fields<'a> {
    pub model: &'a str,
    pub prompt: &'a str,
    pub n: u32,
    pub size: Option<&'a str>,
    pub quality: &'a str,
    pub flavor: Flavor,
}

impl Fields<'_> {
    /// `(name, value)` text fields in wire order. Official: `output_format: png`. Gateway:
    /// `response_format: b64_json` when `response_format` (a gateway that rejects it is asked
    /// again without it).
    fn pairs(&self, response_format: bool) -> Vec<(&'static str, String)> {
        let mut pairs = vec![("model", self.model.to_string()), ("prompt", self.prompt.to_string())];
        if let Some(size) = self.size {
            pairs.push(("size", size.to_string()));
        }
        pairs.push(("quality", self.quality.to_string()));
        pairs.push(("n", self.n.to_string()));
        match self.flavor {
            Flavor::Official => pairs.push(("output_format", OUTPUT_FORMAT.to_string())),
            Flavor::Gateway if response_format => pairs.push(("response_format", "b64_json".to_string())),
            Flavor::Gateway => {}
        }
        pairs
    }

    /// JSON body for `POST /images/generations` (no references); `n` is a number.
    pub fn json_body(&self, response_format: bool) -> Value {
        let mut body = serde_json::Map::new();
        for (name, value) in self.pairs(response_format) {
            body.insert(name.to_string(), if name == "n" { json!(self.n) } else { json!(value) });
        }
        Value::Object(body)
    }

    /// Multipart body for `POST /images/edits`: the same fields as text parts, then one file part
    /// per reference, in request order (the prompt numbers them in that order). The file field
    /// is `image[]` (official docs), except that a gateway gets a single reference as `image`.
    pub fn edit_form(&self, response_format: bool, references: &[ReferenceImage]) -> Result<Form, ProviderError> {
        let mut form = Form::new();
        for (name, value) in self.pairs(response_format) {
            form = form.text(name, value);
        }
        let field = if self.flavor == Flavor::Gateway && references.len() == 1 { "image" } else { "image[]" };
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
            form = form.part(field, part);
        }
        Ok(form)
    }
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
    /// `data[].url` of items without `b64_json` (gateways only), still to be downloaded.
    pub urls: Vec<String>,
    pub size: Option<String>,
    pub quality: Option<String>,
    pub output_format: Option<String>,
}

/// Interpret an HTTP 200 `ImagesResponse`: `data[].b64_json` (GPT Image models always answer
/// in base64). With `allow_urls` (gateways), items that only carry `url` are collected for
/// download. `api_key` is only used to redact echoes of it.
pub fn parse_success(body: &Value, vendor: &str, api_key: &str, allow_urls: bool) -> Result<CallResult, ProviderError> {
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
        let Some(data) = item.get("b64_json").and_then(Value::as_str).filter(|d| !d.is_empty()) else {
            if let Some(url) = item.get("url").and_then(Value::as_str).filter(|_| allow_urls) {
                result.urls.push(url.to_string());
            }
            continue;
        };
        let bytes = B64.decode(data.trim()).map_err(|_| {
            ProviderError::new(
                ProviderErrorKind::BadResponse,
                format!("{vendor} returned image data that could not be decoded."),
            )
        })?;
        if !bytes.is_empty() {
            result.images.push(ProviderImage { mime_type: mime_type.to_string(), bytes });
        }
    }
    if result.images.is_empty() && result.urls.is_empty() {
        return Err(ProviderError::new(ProviderErrorKind::BadResponse, format!("{vendor} answered without an image.")));
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

/// The gateway's own words about a failure: `error.message` (OpenAI shape), `error` as a
/// string, `message` or `detail` (other common shapes), else the plain-text body. HTML pages
/// (proxies, gateways' error pages) are not quoted. Key-redacted, whitespace-collapsed, capped.
pub fn gateway_detail(body: &str, api_key: &str) -> String {
    let text = match serde_json::from_str::<Value>(body) {
        Ok(value) => {
            let error = value.get("error");
            let candidates = [
                error.and_then(|e| e.get("message")),
                error.filter(|e| e.is_string()),
                value.get("message"),
                value.get("detail"),
            ];
            match candidates.into_iter().flatten().find_map(Value::as_str) {
                Some(message) => message.to_string(),
                None => return String::new(),
            }
        }
        Err(_) if body.trim_start().starts_with('<') => return "(an HTML error page)".into(),
        Err(_) => body.to_string(),
    };
    sanitize(&text, api_key)
}

/// Map a non-200 answer of an OpenAI-compatible gateway. Every message names the HTTP status and
/// quotes the gateway's own message (key redacted); codes and types follow the OpenAI shape when
/// the gateway uses it.
pub fn map_gateway_error(vendor: &str, setup_hint: &str, status: u16, body: &str, api_key: &str) -> ProviderError {
    use ProviderErrorKind::*;

    let parsed: Option<Value> = serde_json::from_str(body).ok();
    let error = parsed.as_ref().and_then(|v| v.get("error"));
    let field = |name: &str| error.and_then(|e| e.get(name)).and_then(Value::as_str).unwrap_or_default();
    let (code, kind) = (field("code"), field("type"));
    let is = |list: &[&str]| list.contains(&code) || list.contains(&kind);
    let detail = gateway_detail(body, api_key);
    let says = if detail.is_empty() { String::new() } else { format!(" {vendor} says: \"{detail}\"") };
    let hint = if setup_hint.is_empty() { String::new() } else { format!(" {setup_hint}") };

    match status {
        401 => ProviderError::new(
            Auth,
            format!("{vendor} rejected the API key (HTTP 401).{says} Check the key in provider settings."),
        ),
        403 => ProviderError::new(
            Auth,
            format!("{vendor} denied access (HTTP 403).{says} The key may not have access to this model."),
        ),
        429 if is(&BILLING_CODES) => ProviderError::new(
            Auth,
            format!("{vendor} says the account has no credit or quota left (HTTP 429).{says} Top up, then retry."),
        ),
        429 => ProviderError::new(
            RateLimited,
            format!("{vendor} rate limit reached (HTTP 429).{says} The job is retried automatically."),
        ),
        400..=499 if is(&MODERATION_CODES) => ProviderError::new(
            Blocked,
            format!(
                "{vendor}'s safety system blocked this request (HTTP {status}).{says} Rephrase the prompt or change \
                 the reference images."
            ),
        ),
        404 => ProviderError::new(
            InvalidRequest,
            format!("{vendor} has no such model or endpoint (HTTP 404).{says}{hint}"),
        ),
        500..=599 => {
            ProviderError::new(Network, format!("{vendor} service error (HTTP {status}).{says} Try again in a moment."))
        }
        _ => ProviderError::new(InvalidRequest, format!("{vendor} rejected the request (HTTP {status}).{says}")),
    }
}

/// Longest enhanced prompt accepted from a chat model (the Images API prompt limit).
const MAX_CHAT_TEXT: usize = super::prompt::MAX_PROMPT_CHARS;

/// `choices[0].message.content` of a chat completion: a string, or an array of
/// `{ type: "text", text }` parts (joined). Trimmed; the key is redacted if echoed.
pub fn parse_chat(body: &Value, vendor: &str, api_key: &str) -> Result<String, ProviderError> {
    let text = match body.pointer("/choices/0/message/content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => {
            parts.iter().filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("")
        }
        _ => String::new(),
    };
    let text = text.trim();
    if text.is_empty() {
        return Err(ProviderError::new(ProviderErrorKind::BadResponse, format!("{vendor} answered without any text.")));
    }
    let text = if api_key.is_empty() { text.to_string() } else { text.replace(api_key, "[redacted]") };
    Ok(truncate(&text, MAX_CHAT_TEXT))
}
