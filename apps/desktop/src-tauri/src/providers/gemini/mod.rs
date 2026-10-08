//! Google Gemini image adapter (first remote provider, ADR-012). Owned by task P2-B.
//!
//! API verified on 2026-10-08 against the official docs:
//! - Image guide, `generateContent` variant (model ids, limits, request examples):
//!   https://ai.google.dev/gemini-api/docs/generate-content/image-generation
//! - REST reference (`GenerationConfig.imageConfig`, `PromptFeedback`, `FinishReason`):
//!   https://ai.google.dev/api/generate-content
//! - `models.get` (used by `test_connection`): https://ai.google.dev/api/models
//! - Model lifecycle: https://ai.google.dev/gemini-api/docs/deprecations
//! - Interactions API status ("generateContent ... legacy ... remains fully supported"):
//!   https://ai.google.dev/gemini-api/docs/interactions-overview
//!
//! Wire shape used here:
//! - `POST {base}/models/{model}:generateContent`, API key in the `x-goog-api-key` header
//!   (never in the URL, so it cannot leak through a logged URL or a reqwest error).
//! - `contents[0].parts` = composed prompt text, then per reference a label text part and an
//!   `inlineData { mimeType, data }` part, in request order.
//! - `generationConfig.responseModalities = ["TEXT", "IMAGE"]`,
//!   `generationConfig.imageConfig { aspectRatio, imageSize }` (only fields that were set).
//! - Images come back in `candidates[].content.parts[].inlineData`; `thought` parts are skipped.
//!
//! Each call yields one image, so `outputCount > 1` runs sequential calls. Partial failures
//! return the images that succeeded and record the failure count in `meta`.

mod models;
mod prompt;
mod wire;

#[cfg(test)]
mod tests;

use std::time::Duration;

use serde_json::{json, Value};

use super::{
    ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderInfo, ProviderKind, ProviderOutput,
    ProviderRequest,
};

pub use models::{DEFAULT_MODEL, MAX_OUTPUTS};
pub use prompt::{compose_prompt, reference_label};

pub const ID: &str = "gemini";
pub const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

const GENERATE_TIMEOUT: Duration = Duration::from_secs(180);
const TEST_TIMEOUT: Duration = Duration::from_secs(15);

pub struct GeminiProvider {
    base_url: String,
    generate_timeout: Duration,
    test_timeout: Duration,
}

impl GeminiProvider {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    /// Tests point this at a local mock server.
    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            generate_timeout: GENERATE_TIMEOUT,
            test_timeout: TEST_TIMEOUT,
        }
    }

    fn client(&self, timeout: Duration) -> Result<reqwest::blocking::Client, ProviderError> {
        reqwest::blocking::Client::builder().timeout(timeout).build().map_err(|_| {
            ProviderError::new(ProviderErrorKind::Network, "Could not initialise the HTTPS client for Gemini.")
        })
    }

    /// One `generateContent` round trip.
    fn call_once(
        &self,
        client: &reqwest::blocking::Client,
        url: &str,
        api_key: &str,
        body: &Value,
    ) -> Result<wire::CallResult, ProviderError> {
        let response = client
            .post(url)
            .header("x-goog-api-key", api_key)
            .json(body)
            .send()
            .map_err(|e| transport_error(&e, self.generate_timeout))?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|e| transport_error(&e, self.generate_timeout))?;
        if status != 200 {
            return Err(wire::map_http_error(status, &text, api_key));
        }
        let value: Value = serde_json::from_str(&text).map_err(|_| {
            ProviderError::new(ProviderErrorKind::BadResponse, "Gemini returned a response that is not valid JSON.")
        })?;
        wire::parse_success(&value, api_key)
    }
}

impl Default for GeminiProvider {
    fn default() -> Self {
        Self::new()
    }
}

fn transport_error(error: &reqwest::Error, timeout: Duration) -> ProviderError {
    // The reqwest error text is not forwarded: it carries the URL and low-level detail only.
    if error.is_timeout() {
        ProviderError::new(
            ProviderErrorKind::Timeout,
            format!("Gemini did not answer within {} s. Try again, or pick a smaller image size.", timeout.as_secs()),
        )
    } else {
        ProviderError::new(
            ProviderErrorKind::Network,
            "Could not reach Gemini. Check the internet connection, proxy or firewall, then retry.",
        )
    }
}

fn require_key(api_key: Option<&str>) -> Result<&str, ProviderError> {
    match api_key.map(str::trim) {
        Some(key) if !key.is_empty() => Ok(key),
        _ => Err(ProviderError::new(
            ProviderErrorKind::Auth,
            "No Gemini API key is configured. Add one in provider settings.",
        )),
    }
}

/// Reject requests the chosen model cannot serve, before spending a network call.
fn validate(model: &ModelCapabilities, request: &ProviderRequest) -> Result<(), ProviderError> {
    let invalid = |message: String| Err(ProviderError::new(ProviderErrorKind::InvalidRequest, message));
    let params = &request.params;
    if params.output_count == 0 || params.output_count > model.max_outputs {
        return invalid(format!("{} can produce 1 to {} images per request.", model.label, model.max_outputs));
    }
    if request.references.len() > model.max_reference_images as usize {
        return invalid(format!(
            "{} accepts at most {} reference images; {} were sent.",
            model.label,
            model.max_reference_images,
            request.references.len()
        ));
    }
    if let Some(ratio) = &params.aspect_ratio {
        if !model.aspect_ratios.contains(ratio) {
            return invalid(format!("{} does not support aspect ratio {ratio}.", model.label));
        }
    }
    if let Some(size) = &params.image_size {
        if model.image_sizes.is_empty() {
            return invalid(format!("{} has a fixed output size; leave image size unset.", model.label));
        }
        if !model.image_sizes.contains(size) {
            return invalid(format!(
                "{} does not support image size {size} (supported: {}).",
                model.label,
                model.image_sizes.join(", ")
            ));
        }
    }
    if compose_prompt(&request.prompt).is_empty() {
        return invalid("The prompt is empty.".into());
    }
    Ok(())
}

impl ImageProvider for GeminiProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ID,
            label: "Google Gemini",
            kind: ProviderKind::Remote,
            requires_api_key: true,
            models: models::all(),
        }
    }

    fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        let api_key = require_key(request.api_key.as_deref())?;
        let model = models::find(&request.model_id).ok_or_else(|| {
            ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                format!("Unknown Gemini model \"{}\".", wire::sanitize(&request.model_id, api_key)),
            )
        })?;
        // Validation messages echo request values; redact in case a key was pasted into one.
        validate(&model, request).map_err(|e| ProviderError::new(e.kind, wire::sanitize(&e.message, api_key)))?;

        let body = wire::build_request(&request.prompt, &request.references, &request.params);
        let url = format!("{}/models/{}:generateContent", self.base_url, model.id);
        let client = self.client(self.generate_timeout)?;
        let requested = request.params.output_count as usize;

        let mut images = Vec::new();
        let mut finish_reasons = Vec::new();
        let mut model_version = None;
        let mut text = None;
        let mut errors: Vec<ProviderError> = Vec::new();
        for _ in 0..requested {
            match self.call_once(&client, &url, api_key, &body) {
                Ok(call) => {
                    images.extend(call.images);
                    finish_reasons.extend(call.finish_reasons);
                    model_version = model_version.or(call.model_version);
                    text = text.or(call.text);
                }
                Err(error) => {
                    // A bad key or a malformed request fails identically on every retry.
                    let stop = matches!(error.kind, ProviderErrorKind::Auth | ProviderErrorKind::InvalidRequest);
                    errors.push(error);
                    if stop {
                        break;
                    }
                }
            }
            if images.len() >= requested {
                break;
            }
        }

        if images.is_empty() {
            return Err(errors
                .pop()
                .unwrap_or_else(|| ProviderError::new(ProviderErrorKind::BadResponse, "Gemini returned no image.")));
        }
        images.truncate(requested);
        let meta = json!({
            "model": model.id,
            "modelVersion": model_version,
            "requested": requested,
            "returned": images.len(),
            "failed": errors.len(),
            "errors": errors.iter().map(|e| json!({ "kind": e.kind.as_str(), "message": e.message })).collect::<Vec<_>>(),
            "finishReasons": finish_reasons,
            "text": text,
        });
        Ok(ProviderOutput { images, meta })
    }

    fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError> {
        let api_key = require_key(api_key)?;
        let url = format!("{}/models/{}", self.base_url, DEFAULT_MODEL);
        let response = self
            .client(self.test_timeout)?
            .get(&url)
            .header("x-goog-api-key", api_key)
            .send()
            .map_err(|e| transport_error(&e, self.test_timeout))?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|e| transport_error(&e, self.test_timeout))?;
        if status != 200 {
            return Err(wire::map_http_error(status, &text, api_key));
        }
        // A proxy login page or an empty object must not read as "connected".
        let metadata = serde_json::from_str::<Value>(&text)
            .ok()
            .filter(|v| v.get("name").and_then(Value::as_str).is_some_and(|n| n.starts_with("models/")));
        let Some(metadata) = metadata else {
            return Err(ProviderError::new(
                ProviderErrorKind::BadResponse,
                "Gemini answered, but not with model metadata. Check for a proxy or captive portal, then retry.",
            ));
        };
        let name = metadata.get("displayName").and_then(Value::as_str).unwrap_or(DEFAULT_MODEL);
        Ok(format!("Connected to Gemini; {} is available.", wire::sanitize(name, api_key)))
    }
}
