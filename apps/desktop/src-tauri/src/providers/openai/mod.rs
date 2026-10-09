//! OpenAI GPT Image adapter, also used for OpenAI-compatible gateways (see `providers::hhtech`).
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
//!
//! [`Flavor::Gateway`] (third-party OpenAI-compatible gateways, unverifiable docs) differs:
//! it asks for `response_format: "b64_json"` instead of `output_format`, retries once without
//! `response_format` when the gateway rejects that field, uploads a single reference as `image`
//! (several as `image[]`), accepts `data[].url` and downloads it, tests with `GET /models`, maps
//! errors generically (JSON or plain-text bodies) and offers `POST /chat/completions` for
//! prompt enhancement.

mod download;
mod models;
mod prompt;
mod wire;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};

use super::text::sanitize;
use super::{
    ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderInfo, ProviderKind, ProviderOutput,
    ProviderRequest,
};

pub use models::{
    api_size, gateway_model, ratio_of, tier_model_id, tier_size, Route, TierStrategy, ASPECT_RATIOS, DEFAULT_MODEL,
    MAX_OUTPUTS, MAX_REFERENCE_IMAGES, TIER_LONG_EDGES,
};
pub use prompt::{build_prompt, MAX_PROMPT_CHARS};

pub const ID: &str = "openai";
pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

/// The guide warns that "complex prompts may take up to 2 minutes"; several outputs with up to
/// 16 reference uploads take longer, so allow 5 minutes.
pub const GENERATE_TIMEOUT: Duration = Duration::from_secs(300);
const TEST_TIMEOUT: Duration = Duration::from_secs(15);
/// Prompt enhancement is one short chat completion.
const CHAT_TIMEOUT: Duration = Duration::from_secs(60);

/// Which dialect of the Images API the endpoint speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    /// api.openai.com, as verified in the docs above.
    Official,
    /// An OpenAI-compatible gateway: lenient parsing, url fallback, generic error mapping.
    Gateway,
}

/// Everything that differs between providers served by this adapter.
#[derive(Debug, Clone)]
pub struct Config {
    pub id: &'static str,
    pub label: &'static str,
    /// Name used in user messages ("OpenAI", "HHTECH").
    pub vendor: &'static str,
    /// `Err` = why the provider cannot run (shown as "not configured", no request is made).
    pub base_url: Result<String, String>,
    pub flavor: Flavor,
    pub models: Vec<ModelCapabilities>,
    /// Tier / quality routing by model id; a model without an entry gets [`Route::default`]
    /// (no tiers, `quality` sent).
    pub routes: HashMap<String, Route>,
    /// Gateway: size sent when no tier is chosen, without an aspect ratio, and for the ratio it
    /// has; `None` = omit.
    pub default_size: Option<String>,
    /// `quality` sent when the request leaves it null (and the route sends one).
    pub quality: String,
    /// Chat model for prompt enhancement; `None` = not offered.
    pub chat_model: Option<String>,
    /// Appended to 404 messages: where the user fixes the base URL / model names.
    pub setup_hint: &'static str,
    /// How long one images call may take.
    pub generate_timeout: Duration,
}

impl Config {
    pub fn openai(base_url: &str) -> Self {
        Self {
            id: ID,
            label: "OpenAI (GPT Image)",
            vendor: "OpenAI",
            base_url: Ok(base_url.trim_end_matches('/').to_string()),
            flavor: Flavor::Official,
            models: models::all(),
            routes: HashMap::new(),
            default_size: None,
            quality: models::QUALITY.to_string(),
            chat_model: None,
            setup_hint: "",
            generate_timeout: GENERATE_TIMEOUT,
        }
    }
}

/// What one images call sends besides `n` and the references.
#[derive(Debug, Clone, Copy)]
struct Call<'a> {
    /// The id on the wire (a tier-suffixed id for [`TierStrategy::IdSuffix`]).
    model: &'a str,
    prompt: &'a str,
    size: Option<&'a str>,
    /// `None` = the field is not sent.
    quality: Option<&'a str>,
}

pub struct OpenAiProvider {
    cfg: Config,
    generate_timeout: Duration,
    test_timeout: Duration,
    chat_timeout: Duration,
}

impl OpenAiProvider {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    /// Tests point this at a local mock server.
    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self::from_config(Config::openai(&base_url.into()))
    }

    pub fn from_config(cfg: Config) -> Self {
        Self { generate_timeout: cfg.generate_timeout, cfg, test_timeout: TEST_TIMEOUT, chat_timeout: CHAT_TIMEOUT }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    fn base_url(&self) -> Result<&str, ProviderError> {
        self.cfg
            .base_url
            .as_deref()
            .map_err(|problem| ProviderError::new(ProviderErrorKind::InvalidRequest, problem.clone()))
    }

    fn client(&self, timeout: Duration) -> Result<reqwest::blocking::Client, ProviderError> {
        reqwest::blocking::Client::builder().timeout(timeout).build().map_err(|_| {
            ProviderError::new(
                ProviderErrorKind::Network,
                format!("Could not initialise the HTTPS client for {}.", self.cfg.vendor),
            )
        })
    }

    /// Send one request; returns the status and body text. Transport failures are key-free.
    fn send_raw(
        &self,
        request: reqwest::blocking::RequestBuilder,
        timeout: Duration,
        api_key: &str,
    ) -> Result<(u16, String), ProviderError> {
        let response = request.bearer_auth(api_key).send().map_err(|e| self.transport_error(&e, timeout))?;
        let status = response.status().as_u16();
        let text = response.text().map_err(|e| self.transport_error(&e, timeout))?;
        Ok((status, text))
    }

    fn map_http_error(&self, status: u16, body: &str, api_key: &str) -> ProviderError {
        match self.cfg.flavor {
            Flavor::Official => wire::map_http_error(status, body, api_key),
            Flavor::Gateway => wire::map_gateway_error(self.cfg.vendor, self.cfg.setup_hint, status, body, api_key),
        }
    }

    /// Interpret a status + body: non-200 is mapped to a key-free error, 200 must be JSON.
    fn parse_json(&self, status: u16, text: &str, api_key: &str) -> Result<Value, ProviderError> {
        if status != 200 {
            return Err(self.map_http_error(status, text, api_key));
        }
        serde_json::from_str(text).map_err(|_| {
            ProviderError::new(
                ProviderErrorKind::BadResponse,
                format!("{} returned a response that is not valid JSON.", self.cfg.vendor),
            )
        })
    }

    /// Send one request and parse the answer, mapping every failure to a key-free error.
    fn send(
        &self,
        request: reqwest::blocking::RequestBuilder,
        timeout: Duration,
        api_key: &str,
    ) -> Result<Value, ProviderError> {
        let (status, text) = self.send_raw(request, timeout, api_key)?;
        self.parse_json(status, &text, api_key)
    }

    fn transport_error(&self, error: &reqwest::Error, timeout: Duration) -> ProviderError {
        transport_error(self.cfg.vendor, error, timeout)
    }

    fn require_key<'a>(&self, api_key: Option<&'a str>) -> Result<&'a str, ProviderError> {
        match api_key.map(str::trim) {
            Some(key) if !key.is_empty() => Ok(key),
            _ => Err(ProviderError::new(
                ProviderErrorKind::Auth,
                format!("No {} API key is configured. Add one in provider settings.", self.cfg.vendor),
            )),
        }
    }

    fn find_model(&self, model_id: &str) -> Option<ModelCapabilities> {
        self.cfg.models.iter().find(|m| m.id == model_id).cloned()
    }

    /// The `size` to send: the aspect ratio's size, except that a gateway's configured default
    /// size is used without a ratio and for the ratio it has.
    fn size_for(&self, aspect_ratio: Option<&str>) -> Option<String> {
        if let Some(default) = &self.cfg.default_size {
            let default_ratio = ratio_of(default);
            if aspect_ratio.is_none() || (default_ratio.is_some() && aspect_ratio == default_ratio.as_deref()) {
                return Some(default.clone());
            }
        }
        api_size(aspect_ratio).map(str::to_string)
    }

    fn route(&self, model_id: &str) -> Route {
        self.cfg.routes.get(model_id).copied().unwrap_or_default()
    }

    /// The `size` to send. Without a tier (or for a model without tiers) see [`Self::size_for`].
    /// With a tier the size is computed from the ratio and the tier; without a ratio it uses the
    /// configured default size's ratio, else 1:1.
    fn request_size(&self, route: Route, aspect_ratio: Option<&str>, tier: Option<&str>) -> Option<String> {
        let tier = match (route.tiers, tier) {
            (TierStrategy::None, _) | (_, None) => return self.size_for(aspect_ratio),
            (_, Some(tier)) => tier,
        };
        let ratio = match aspect_ratio {
            Some(ratio) => ratio.to_string(),
            None => self.cfg.default_size.as_deref().and_then(ratio_of).unwrap_or_else(|| "1:1".into()),
        };
        tier_size(&ratio, tier).or_else(|| self.size_for(aspect_ratio))
    }

    /// One images call (generations or edits). A gateway that rejects `response_format` is
    /// asked once more without it.
    fn images_call(
        &self,
        call: Call<'_>,
        n: u32,
        request: &ProviderRequest,
        api_key: &str,
    ) -> Result<Value, ProviderError> {
        let base = self.base_url()?;
        let client = self.client(self.generate_timeout)?;
        let fields = wire::Fields {
            model: call.model,
            prompt: call.prompt,
            n,
            size: call.size,
            quality: call.quality,
            flavor: self.cfg.flavor,
        };
        let build = |response_format: bool| -> Result<reqwest::blocking::RequestBuilder, ProviderError> {
            Ok(if request.references.is_empty() {
                client.post(format!("{base}/images/generations")).json(&fields.json_body(response_format))
            } else {
                let form = fields.edit_form(response_format, &request.references)?;
                client.post(format!("{base}/images/edits")).multipart(form)
            })
        };
        let gateway = self.cfg.flavor == Flavor::Gateway;
        let (status, text) = self.send_raw(build(gateway)?, self.generate_timeout, api_key)?;
        if gateway && status == 400 && text.contains("response_format") {
            let (status, text) = self.send_raw(build(false)?, self.generate_timeout, api_key)?;
            return self.parse_json(status, &text, api_key);
        }
        self.parse_json(status, &text, api_key)
    }

    /// One images call, with any returned URLs downloaded, trimmed to `n` images.
    fn one_call(
        &self,
        call: Call<'_>,
        n: u32,
        request: &ProviderRequest,
        api_key: &str,
    ) -> Result<(wire::CallResult, usize), ProviderError> {
        let value = self.images_call(call, n, request, api_key)?;
        let allow_urls = self.cfg.flavor == Flavor::Gateway;
        let mut result = wire::parse_success(&value, self.cfg.vendor, api_key, allow_urls)?;
        let mut downloaded = 0;
        for url in std::mem::take(&mut result.urls) {
            if result.images.len() >= n as usize {
                break;
            }
            result.images.push(download::fetch(self.cfg.vendor, &url, self.generate_timeout)?);
            downloaded += 1;
        }
        // The API may in principle return more than `n`; never store more than requested.
        result.images.truncate(n as usize);
        Ok((result, downloaded))
    }

    /// `n` single-image calls in parallel. Succeeds with whatever images came back when at
    /// least one call did (the third value counts the failed calls); otherwise returns the first
    /// call's error, so a quota or auth failure keeps its kind.
    fn parallel_calls(
        &self,
        call: Call<'_>,
        n: u32,
        request: &ProviderRequest,
        api_key: &str,
    ) -> Result<(wire::CallResult, usize, usize), ProviderError> {
        let results: Vec<Result<(wire::CallResult, usize), ProviderError>> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..n).map(|_| scope.spawn(|| self.one_call(call, 1, request, api_key))).collect();
            handles
                .into_iter()
                .map(|h| {
                    h.join().unwrap_or_else(|_| {
                        Err(ProviderError::new(ProviderErrorKind::BadResponse, "An image request crashed."))
                    })
                })
                .collect()
        });
        let mut merged: Option<wire::CallResult> = None;
        let (mut downloaded, mut failed, mut first_error) = (0, 0, None);
        for result in results {
            match result {
                Ok((call, d)) => {
                    downloaded += d;
                    match merged.as_mut() {
                        None => merged = Some(call),
                        Some(m) => m.images.extend(call.images),
                    }
                }
                Err(e) => {
                    failed += 1;
                    first_error.get_or_insert(e);
                }
            }
        }
        match merged {
            Some(call) => Ok((call, downloaded, failed)),
            None => Err(first_error.expect("n > 1 calls ran")),
        }
    }

    fn test_official(&self, api_key: &str) -> Result<String, ProviderError> {
        let url = format!("{}/models/{}", self.base_url()?, DEFAULT_MODEL);
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

    /// `GET {base}/models`. A gateway without that endpoint (404) still proved reachable.
    fn test_gateway(&self, api_key: &str) -> Result<String, ProviderError> {
        let vendor = self.cfg.vendor;
        let request = self.client(self.test_timeout)?.get(format!("{}/models", self.base_url()?));
        let (status, text) = self.send_raw(request, self.test_timeout, api_key)?;
        if status == 404 {
            return Ok(format!(
                "{vendor} answered, but it has no /models endpoint (HTTP 404), so the key and model names cannot be \
                 checked without a paid call. Run one generation or Enhance prompt to confirm."
            ));
        }
        let not_a_list = || {
            ProviderError::new(
                ProviderErrorKind::BadResponse,
                format!("{vendor} answered /models, but not with a model list. Check the base URL (it usually ends in /v1)."),
            )
        };
        let value = self.parse_json(status, &text, api_key).map_err(|e| match e.kind {
            ProviderErrorKind::BadResponse => not_a_list(),
            _ => e,
        })?;
        let list = value.get("data").and_then(Value::as_array).or_else(|| value.as_array()).ok_or_else(not_a_list)?;
        let ids: Vec<&str> =
            list.iter().filter_map(|m| m.get("id").and_then(Value::as_str).or_else(|| m.as_str())).collect();
        let listed = |id: &str| if ids.contains(&id) { "listed" } else { "not listed" };
        let mut wanted: Vec<String> =
            self.cfg.models.iter().map(|m| format!("{} {}", sanitize(&m.id, api_key), listed(&m.id))).collect();
        if let Some(chat) = &self.cfg.chat_model {
            wanted.push(format!("chat {} {}", sanitize(chat, api_key), listed(chat)));
        }
        Ok(format!("Connected to {vendor}; {} models listed ({}).", ids.len(), wanted.join(", ")))
    }

    /// One chat completion (`POST {base}/chat/completions`) with a system and a user message;
    /// returns `choices[0].message.content`.
    pub fn chat_completion(&self, system: &str, user: &str, api_key: Option<&str>) -> Result<String, ProviderError> {
        let vendor = self.cfg.vendor;
        let Some(model) = &self.cfg.chat_model else {
            return Err(ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                format!("{} does not offer prompt enhancement.", self.cfg.label),
            ));
        };
        let base = self.base_url()?;
        let api_key = self.require_key(api_key)?;
        let body = json!({
            "model": model,
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user },
            ],
        });
        let request = self.client(self.chat_timeout)?.post(format!("{base}/chat/completions")).json(&body);
        let value = self.send(request, self.chat_timeout, api_key)?;
        wire::parse_chat(&value, vendor, api_key)
    }
}

impl Default for OpenAiProvider {
    fn default() -> Self {
        Self::new()
    }
}

fn transport_error(vendor: &str, error: &reqwest::Error, timeout: Duration) -> ProviderError {
    // The reqwest error text is not forwarded: it carries the URL and low-level detail only.
    if error.is_timeout() {
        ProviderError::new(
            ProviderErrorKind::Timeout,
            format!(
                "{vendor} did not answer within {} s. Try again, or ask for fewer images or a smaller size.",
                timeout.as_secs()
            ),
        )
    } else {
        ProviderError::new(
            ProviderErrorKind::Network,
            format!("Could not reach {vendor}. Check the internet connection, proxy or firewall, then retry."),
        )
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
        if model.image_sizes.is_empty() {
            return invalid(format!(
                "{} has no resolution tiers; leave the image size empty (the size follows the aspect ratio).",
                model.label
            ));
        }
        if !model.image_sizes.contains(size) {
            return invalid(format!(
                "{} does not support image size {size} (supported: {}).",
                model.label,
                model.image_sizes.join(", ")
            ));
        }
    }
    if let Some(quality) = &params.quality {
        if !model.quality_options.contains(quality) {
            return invalid(format!("{} does not offer quality {quality}.", model.label));
        }
    }
    if prompt.is_empty() {
        return invalid("The prompt is empty.".into());
    }
    if prompt.chars().count() > prompt::MAX_PROMPT_CHARS {
        return invalid(format!("The prompt is longer than the API's {} characters.", prompt::MAX_PROMPT_CHARS));
    }
    Ok(())
}

impl ImageProvider for OpenAiProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: self.cfg.id,
            label: self.cfg.label,
            kind: ProviderKind::Remote,
            requires_api_key: true,
            models: self.cfg.models.clone(),
        }
    }

    fn config_problem(&self) -> Option<String> {
        self.cfg.base_url.as_ref().err().cloned()
    }

    fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        self.base_url()?;
        let api_key = self.require_key(request.api_key.as_deref())?;
        let model = self.find_model(&request.model_id).ok_or_else(|| {
            ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                format!("Unknown {} model \"{}\".", self.cfg.vendor, sanitize(&request.model_id, api_key)),
            )
        })?;
        let prompt = build_prompt(&request.prompt, &request.references);
        // Validation messages echo request values; redact in case a key was pasted into one.
        validate(&model, request, &prompt).map_err(|e| ProviderError::new(e.kind, sanitize(&e.message, api_key)))?;

        let route = self.route(&model.id);
        let tier = request.params.image_size.as_deref();
        let size = self.request_size(route, request.params.aspect_ratio.as_deref(), tier);
        let request_model = tier_model_id(&model.id, route.tiers, tier);
        let quality =
            route.sends_quality.then(|| request.params.quality.clone().unwrap_or_else(|| self.cfg.quality.clone()));
        let call = Call { model: &request_model, prompt: &prompt, size: size.as_deref(), quality: quality.as_deref() };
        let n = request.params.output_count;
        // Gateways tend to render `n` images one after another inside a single HTTP call (or
        // ignore `n`), so several outputs are asked for as parallel single-image calls: the wall
        // time stays that of one image, and one slow image does not time out the others.
        let (result, downloaded, failed) = if self.cfg.flavor == Flavor::Gateway && n > 1 {
            self.parallel_calls(call, n, request, api_key)?
        } else {
            let (result, downloaded) = self.one_call(call, n, request, api_key)?;
            (result, downloaded, 0)
        };

        let endpoint = if request.references.is_empty() { "generations" } else { "edits" };
        let mut meta = json!({
            "model": model.id,
            // The id actually sent (tier-suffixed for HHTECH Gemini) and the tier asked for.
            "requestModel": request_model,
            "tier": tier,
            "endpoint": endpoint,
            "requested": n,
            "returned": result.images.len(),
            "size": result.size.or(size),
            "quality": result.quality.or(quality),
            "outputFormat": result.output_format,
        });
        if downloaded > 0 {
            meta["downloaded"] = json!(downloaded);
        }
        if failed > 0 {
            meta["failedCalls"] = json!(failed);
        }
        Ok(ProviderOutput { images: result.images, meta })
    }

    fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError> {
        self.base_url()?;
        let api_key = self.require_key(api_key)?;
        match self.cfg.flavor {
            Flavor::Official => self.test_official(api_key),
            Flavor::Gateway => self.test_gateway(api_key),
        }
    }

    fn auto_retries_timeouts(&self) -> bool {
        // A gateway may keep rendering (and bill) after the app stops waiting.
        self.cfg.flavor == Flavor::Official
    }

    fn chat_model(&self) -> Option<String> {
        self.cfg.chat_model.clone()
    }

    fn chat(&self, system: &str, user: &str, api_key: Option<&str>) -> Result<String, ProviderError> {
        self.chat_completion(system, user, api_key)
    }
}

fn not_model_metadata() -> ProviderError {
    ProviderError::new(
        ProviderErrorKind::BadResponse,
        "OpenAI answered, but not with model metadata. Check for a proxy or captive portal, then retry.",
    )
}
