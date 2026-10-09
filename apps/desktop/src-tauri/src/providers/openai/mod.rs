//! OpenAI GPT Image adapter (second remote provider).
//!
//! API verified on 2026-10-09 against the official docs:
//! - Image generation guide (models, sizes, quality, output, moderation, limitations):
//!   https://developers.openai.com/api/docs/guides/image-generation
//!   (platform.openai.com/docs/guides/image-generation redirects there)
//! - `POST /images/generations`: https://developers.openai.com/api/reference/resources/images/methods/generate
//! - `POST /images/edits`: https://developers.openai.com/api/reference/resources/images/methods/edit
//! - `GET /models/{model}` (used by `test_connection`):
//!   https://developers.openai.com/api/reference/resources/models/methods/retrieve
//! - Error codes: https://developers.openai.com/api/docs/guides/error-codes
//! - Model pages: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst (and
//!   `gpt-image-2.5-flare`, `gpt-image-2`)
//!
//! Wire shape used here (Bearer auth; the key only ever goes into the `Authorization` header):
//! - No references: `POST {base}/images/generations`, JSON
//!   `{ model, prompt, n, quality, output_format, size? }`.
//! - With references: `POST {base}/images/edits`, multipart: the same fields as text parts and
//!   one `image[]` file part per reference, in request order (as in the docs' curl examples).
//! - Images come back as `data[].b64_json`; `n` images are requested in one call.
//! - The prompt is one text (see [`build_prompt`]); there is no negative-prompt, seed or
//!   per-image text field. Masks exist but the app has none to send.

mod models;
mod prompt;
mod wire;

#[cfg(test)]
mod tests;

use std::time::Duration;

use serde_json::{json, Value};

use super::text::sanitize;
use super::{
    ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderInfo, ProviderKind, ProviderOutput,
    ProviderRequest,
};

pub use models::{api_size, DEFAULT_MODEL, MAX_OUTPUTS, MAX_REFERENCE_IMAGES};
pub use prompt::build_prompt;

pub const ID: &str = "openai";
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

/// The guide warns that "complex prompts may take up to 2 minutes"; several outputs at 2K with
/// up to 16 reference uploads take longer, so allow 5 minutes.
const GENERATE_TIMEOUT: Duration = Duration::from_secs(300);
const TEST_TIMEOUT: Duration = Duration::from_secs(15);

pub struct OpenAiProvider {
    base_url: String,
    generate_timeout: Duration,
    test_timeout: Duration,
}

impl OpenAiProvider {
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
            ProviderError::new(ProviderErrorKind::Network, "Could not initialise the HTTPS client for OpenAI.")
        })
    }

    /// Send one request and parse the answer, mapping every failure to a key-free error.
    fn send(
        &self,
        request: reqwest::blocking::RequestBuilder,
        timeout: Duration,
        api_key: &str,
    ) -> Result<Value, ProviderError> {
        let response = request.bearer_auth(api_key).send().map_err(|e| transport_error(&e, timeout))?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|e| transport_error(&e, timeout))?;
        if status != 200 {
            return Err(wire::map_http_error(status, &text, api_key));
        }
        serde_json::from_str(&text).map_err(|_| {
            ProviderError::new(ProviderErrorKind::BadResponse, "OpenAI returned a response that is not valid JSON.")
        })
    }
}

impl Default for OpenAiProvider {
    fn default() -> Self {
        Self::new()
    }
}

fn transport_error(error: &reqwest::Error, timeout: Duration) -> ProviderError {
    // The reqwest error text is not forwarded: it carries the URL and low-level detail only.
    if error.is_timeout() {
        ProviderError::new(
            ProviderErrorKind::Timeout,
            format!(
                "OpenAI did not answer within {} s. Try again, or ask for fewer images or a smaller size.",
                timeout.as_secs()
            ),
        )
    } else {
        ProviderError::new(
            ProviderErrorKind::Network,
            "Could not reach OpenAI. Check the internet connection, proxy or firewall, then retry.",
        )
    }
}

fn require_key(api_key: Option<&str>) -> Result<&str, ProviderError> {
    match api_key.map(str::trim) {
        Some(key) if !key.is_empty() => Ok(key),
        _ => Err(ProviderError::new(
            ProviderErrorKind::Auth,
            "No OpenAI API key is configured. Add one in provider settings.",
        )),
    }
}

/// Reject requests the chosen model cannot serve, before spending a network call.
fn validate(model: &ModelCapabilities, request: &ProviderRequest, prompt: &str) -> Result<(), ProviderError> {
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
        if !model.image_sizes.contains(size) {
            return invalid(format!(
                "{} does not support image size {size} (supported: {}).",
                model.label,
                model.image_sizes.join(", ")
            ));
        }
    }
    if prompt.is_empty() {
        return invalid("The prompt is empty.".into());
    }
    if prompt.chars().count() > prompt::MAX_PROMPT_CHARS {
        return invalid(format!("The prompt is longer than OpenAI's {} characters.", prompt::MAX_PROMPT_CHARS));
    }
    Ok(())
}

impl ImageProvider for OpenAiProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ID,
            label: "OpenAI (GPT Image)",
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
                format!("Unknown OpenAI model \"{}\".", sanitize(&request.model_id, api_key)),
            )
        })?;
        let prompt = build_prompt(&request.prompt, &request.references);
        // Validation messages echo request values; redact in case a key was pasted into one.
        validate(&model, request, &prompt).map_err(|e| ProviderError::new(e.kind, sanitize(&e.message, api_key)))?;

        let params = &request.params;
        let size = api_size(params.aspect_ratio.as_deref(), params.image_size.as_deref());
        let n = params.output_count;
        let client = self.client(self.generate_timeout)?;
        let (endpoint, http) = if request.references.is_empty() {
            let body = wire::generation_body(&model.id, &prompt, n, size);
            ("generations", client.post(format!("{}/images/generations", self.base_url)).json(&body))
        } else {
            let form = wire::edit_form(&model.id, &prompt, n, size, &request.references)?;
            ("edits", client.post(format!("{}/images/edits", self.base_url)).multipart(form))
        };
        let value = self.send(http, self.generate_timeout, api_key)?;
        let mut call = wire::parse_success(&value, api_key)?;
        // The API may in principle return more than `n`; never store more than requested.
        call.images.truncate(n as usize);

        let meta = json!({
            "model": model.id,
            "endpoint": endpoint,
            "requested": n,
            "returned": call.images.len(),
            "size": call.size.or(size.map(str::to_string)),
            "quality": call.quality,
            "outputFormat": call.output_format,
        });
        Ok(ProviderOutput { images: call.images, meta })
    }

    fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError> {
        let api_key = require_key(api_key)?;
        let url = format!("{}/models/{}", self.base_url, DEFAULT_MODEL);
        let request = self.client(self.test_timeout)?.get(&url);
        let value = self.send(request, self.test_timeout, api_key).map_err(|e| match e.kind {
            // A non-JSON 200 (proxy login page) is reported below like any other wrong shape.
            ProviderErrorKind::BadResponse => not_model_metadata(),
            _ => e,
        })?;
        // A proxy login page or an empty object must not read as "connected".
        let is_model = value.get("object").and_then(Value::as_str) == Some("model");
        let Some(id) = value.get("id").and_then(Value::as_str).filter(|_| is_model) else {
            return Err(not_model_metadata());
        };
        Ok(format!(
            "Connected to OpenAI; {} is available. Image generation may still need Organization Verification and \
             billing on the account.",
            sanitize(id, api_key)
        ))
    }
}

fn not_model_metadata() -> ProviderError {
    ProviderError::new(
        ProviderErrorKind::BadResponse,
        "OpenAI answered, but not with model metadata. Check for a proxy or captive portal, then retry.",
    )
}
