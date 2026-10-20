//! Image-to-video providers (phase B1, ADR-043): Kling, Veo (Gemini API), Seedance (BytePlus
//! ModelArk) and Comfy Cloud.
//!
//! Video is asynchronous everywhere: `submit` returns a provider task, `poll` reports its state,
//! and `download` fetches the finished clip. The job queue persists the task right after
//! `submit` (`video_tasks`), so a restarted app resumes polling instead of paying twice.
//!
//! Each adapter is wrapped in [`VideoProvider`], which also implements [`ImageProvider`] so the
//! registry, the key store, the provider list and the queue slots work unchanged; it reports
//! [`OutputKind::Video`] and never generates images. A video model lists its clip durations
//! in `image_sizes` ("5s", "10s") and accepts exactly one reference image (the first frame).
//!
//! The adapters follow the vendors' public API shapes as documented in 2026-10 (some details
//! come from third-party guides because the official pages could not be fetched from the build
//! machine); every response is parsed defensively and quoted (key redacted) on errors.

pub mod comfy;
pub mod kling;
pub mod seedance;
#[cfg(test)]
mod tests;
pub mod veo;

use std::collections::BTreeMap;
use std::io::Read;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    ImageProvider, ModelCapabilities, OutputKind, ProviderError, ProviderErrorKind, ProviderInfo, ProviderKind,
    ProviderOutput, ProviderRequest, ReferenceImage,
};
use crate::secrets::EnvSource;

/// Largest clip the app downloads.
pub const MAX_VIDEO_BYTES: u64 = 500 * 1024 * 1024;
/// Default time between two status checks.
pub const POLL_INTERVAL: Duration = Duration::from_secs(10);
/// A task still running after this long fails the attempt (the task is kept, so Retry resumes).
pub const POLL_DEADLINE: Duration = Duration::from_secs(30 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(120);

/// One clip from one image.
#[derive(Debug, Clone)]
pub struct VideoRequest {
    pub model_id: String,
    pub prompt: String,
    pub negative_prompt: String,
    /// The first frame.
    pub image: ReferenceImage,
    pub duration_sec: u32,
    pub aspect_ratio: Option<String>,
}

/// A provider task, stored as JSON in `video_tasks` between polls and across restarts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VideoTask {
    pub id: String,
    #[serde(default)]
    pub extra: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum VideoPoll {
    Pending,
    Done { url: String },
    Failed { message: String, blocked: bool },
}

/// One vendor's video API.
pub trait VideoApi: Send + Sync {
    fn submit(&self, request: &VideoRequest, key: &str) -> Result<VideoTask, ProviderError>;
    fn poll(&self, task: &VideoTask, key: &str) -> Result<VideoPoll, ProviderError>;
    /// Fetch the finished clip (https only, size-capped).
    fn download(&self, url: &str, key: &str) -> Result<Vec<u8>, ProviderError>;
    fn poll_interval(&self) -> Duration {
        POLL_INTERVAL
    }
    fn deadline(&self) -> Duration {
        POLL_DEADLINE
    }
}

/// A video vendor in the provider registry.
pub struct VideoProvider {
    pub id: &'static str,
    pub label: &'static str,
    pub models: Vec<ModelCapabilities>,
    /// Why the provider cannot run regardless of the key (bad base URL, missing workflow…).
    pub problem: Option<String>,
    pub api: Box<dyn VideoApi>,
}

impl ImageProvider for VideoProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: self.id,
            label: self.label,
            kind: ProviderKind::Remote,
            requires_api_key: true,
            models: self.models.clone(),
        }
    }

    fn generate(&self, _request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        Err(ProviderError::new(ProviderErrorKind::InvalidRequest, format!("{} makes videos, not images.", self.label)))
    }

    /// No vendor offers a free key check that is the same everywhere; the key is used on the
    /// first clip, and this only confirms the setup.
    fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError> {
        if let Some(problem) = &self.problem {
            return Err(ProviderError::new(ProviderErrorKind::InvalidRequest, problem.clone()));
        }
        match api_key {
            Some(key) if !key.trim().is_empty() => {
                Ok(format!("{} is set up; the key is checked on the first video (no clip is made now).", self.label))
            }
            _ => Err(ProviderError::new(ProviderErrorKind::Auth, format!("{} needs an API key.", self.label))),
        }
    }

    fn config_problem(&self) -> Option<String> {
        self.problem.clone()
    }

    /// A paid clip that timed out may still be billed: never resubmit on its own.
    fn auto_retries_timeouts(&self) -> bool {
        false
    }

    fn output_kind(&self) -> OutputKind {
        OutputKind::Video
    }

    fn video(&self) -> Option<&dyn VideoApi> {
        Some(self.api.as_ref())
    }
}

/// Capabilities of a video model: one reference (the first frame), one clip per request, the
/// clip durations as "5s"-style sizes.
pub fn video_model(id: &str, label: &str, durations: &[u32], ratios: &[&str]) -> ModelCapabilities {
    ModelCapabilities {
        id: id.to_string(),
        label: label.to_string(),
        text_to_image: false,
        image_to_image: true,
        max_reference_images: 1,
        max_outputs: 1,
        aspect_ratios: ratios.iter().map(|r| r.to_string()).collect(),
        image_sizes: durations.iter().map(|d| format!("{d}s")).collect(),
        supports_negative_prompt: true,
        supports_seed: false,
        quality_options: Vec::new(),
        price_hint: None,
        supports_mask: false,
    }
}

/// Seconds of a "5s"-style duration.
pub fn parse_duration(size: Option<&str>) -> Option<u32> {
    size?.strip_suffix('s')?.parse().ok()
}

// ---------------------------------------------------------------- environment

/// Trimmed, non-empty environment value.
pub(crate) fn env_value(env: &dyn EnvSource, name: &str) -> Option<String> {
    env.var(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// The models named in `<VAR>` (comma-separated), else `defaults`; invalid ids are a problem.
pub(crate) fn env_models(
    env: &dyn EnvSource,
    var: &str,
    defaults: &[&str],
    make: impl Fn(&str) -> ModelCapabilities,
) -> (Vec<ModelCapabilities>, Option<String>) {
    match env_value(env, var) {
        None => (defaults.iter().map(|id| make(id)).collect(), None),
        Some(list) => {
            let ids: Vec<&str> = list.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
            if ids.iter().any(|id| !super::gateway_env::valid_id(id)) {
                return (Vec::new(), Some(format!("{var} contains an invalid model id.")));
            }
            let mut unique: Vec<&str> = Vec::new();
            for id in ids {
                if !unique.contains(&id) {
                    unique.push(id);
                }
            }
            (unique.into_iter().map(make).collect(), None)
        }
    }
}

/// https, or http only to a loopback host (tests and local gateways); no trailing slash.
pub(crate) fn env_base_url(env: &dyn EnvSource, var: &str, default: &str) -> Result<String, String> {
    let raw = env_value(env, var).unwrap_or_else(|| default.to_string());
    let trimmed = raw.trim_end_matches('/').to_string();
    let url = reqwest::Url::parse(&trimmed).map_err(|_| format!("{var} is not a valid URL."))?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    match url.scheme() {
        "https" => Ok(trimmed),
        "http" if loopback => Ok(trimmed),
        _ => Err(format!("{var} must use https.")),
    }
}

// ---------------------------------------------------------------- HTTP helpers

pub(crate) fn client(timeout: Duration) -> Result<reqwest::blocking::Client, ProviderError> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|_| ProviderError::new(ProviderErrorKind::Network, "Could not start the HTTP client."))
}

pub(crate) fn default_client() -> Result<reqwest::blocking::Client, ProviderError> {
    client(HTTP_TIMEOUT)
}

/// Removes `secret` (and anything after "Bearer ") from text quoted back to the user.
pub(crate) fn redact(text: &str, secret: &str) -> String {
    let mut out = if secret.len() >= 4 { text.replace(secret, "[key]") } else { text.to_string() };
    for part in secret.split(':').filter(|p| p.len() >= 4) {
        out = out.replace(part, "[key]");
    }
    out.chars().take(400).collect()
}

/// Maps a transport error.
pub(crate) fn transport_error(vendor: &str, err: reqwest::Error) -> ProviderError {
    if err.is_timeout() {
        ProviderError::new(ProviderErrorKind::Timeout, format!("{vendor} did not answer in time."))
    } else {
        ProviderError::new(ProviderErrorKind::Network, format!("Could not reach {vendor}. Check the network."))
    }
}

/// Maps an HTTP error status, quoting the vendor's message (key redacted).
pub(crate) fn status_error(vendor: &str, status: u16, body: &str, key: &str) -> ProviderError {
    let kind = match status {
        401 | 403 => ProviderErrorKind::Auth,
        402 | 429 => ProviderErrorKind::RateLimited,
        408 | 504 => ProviderErrorKind::Timeout,
        500..=599 => ProviderErrorKind::Network,
        _ => ProviderErrorKind::InvalidRequest,
    };
    let quoted = redact(body.trim(), key);
    let detail = if quoted.is_empty() { String::new() } else { format!(": {quoted}") };
    ProviderError::new(kind, format!("{vendor} answered HTTP {status}{detail}"))
}

/// Sends a request and parses a JSON answer; non-2xx statuses become typed errors.
pub(crate) fn send_json(
    vendor: &str,
    request: reqwest::blocking::RequestBuilder,
    key: &str,
) -> Result<Value, ProviderError> {
    let response = request.send().map_err(|e| transport_error(vendor, e))?;
    let status = response.status().as_u16();
    let body = response.text().map_err(|e| transport_error(vendor, e))?;
    if !(200..300).contains(&status) {
        return Err(status_error(vendor, status, &body, key));
    }
    serde_json::from_str(&body).map_err(|_| {
        ProviderError::new(
            ProviderErrorKind::BadResponse,
            format!("{vendor} answered with something that is not JSON: {}", redact(&body, key)),
        )
    })
}

fn checked_link(vendor: &str, url: &str) -> Result<reqwest::Url, ProviderError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| {
        ProviderError::new(ProviderErrorKind::BadResponse, format!("{vendor} returned an invalid video link."))
    })?;
    let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err(ProviderError::new(
            ProviderErrorKind::BadResponse,
            format!("{vendor} returned a video link that is not https."),
        ));
    }
    Ok(parsed)
}

/// GETs a clip: https (or loopback http), at most [`MAX_VIDEO_BYTES`], and it must look like a
/// video file. `headers` (the key) go to `url` only: a redirect is followed once, without them,
/// so a signed storage link never receives the key.
pub(crate) fn download_video(
    vendor: &str,
    url: &str,
    headers: &[(&str, &str)],
    key: &str,
) -> Result<Vec<u8>, ProviderError> {
    let parsed = checked_link(vendor, url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15 * 60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ProviderError::new(ProviderErrorKind::Network, "Could not start the HTTP client."))?;
    let mut request = client.get(parsed.clone());
    for (name, value) in headers {
        request = request.header(*name, *value);
    }
    let mut response = request.send().map_err(|e| transport_error(vendor, e))?;
    if response.status().is_redirection() {
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| parsed.join(v).ok())
            .ok_or_else(|| {
                ProviderError::new(
                    ProviderErrorKind::BadResponse,
                    format!("{vendor} redirected the video download nowhere."),
                )
            })?;
        let next = checked_link(vendor, location.as_str())?;
        response = client.get(next).send().map_err(|e| transport_error(vendor, e))?;
    }
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        let body = response.text().unwrap_or_default();
        return Err(status_error(vendor, status, &body, key));
    }
    let mut bytes = Vec::new();
    response.take(MAX_VIDEO_BYTES + 1).read_to_end(&mut bytes).map_err(|_| {
        ProviderError::new(ProviderErrorKind::Network, format!("The video download from {vendor} was interrupted."))
    })?;
    if bytes.len() as u64 > MAX_VIDEO_BYTES {
        return Err(ProviderError::new(
            ProviderErrorKind::BadResponse,
            format!("The video from {vendor} is larger than {} MB.", MAX_VIDEO_BYTES / 1024 / 1024),
        ));
    }
    if video_mime(&bytes).is_none() {
        return Err(ProviderError::new(
            ProviderErrorKind::BadResponse,
            format!("{vendor} returned a file that is not an MP4, MOV or WebM video."),
        ));
    }
    Ok(bytes)
}

/// MIME type and extension of a clip, from its signature.
pub fn video_mime(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        return Some(if brand == b"qt  " { ("video/quicktime", "mov") } else { ("video/mp4", "mp4") });
    }
    if bytes.len() >= 4 && bytes[..4] == [0x1A, 0x45, 0xDF, 0xA3] {
        return Some(("video/webm", "webm"));
    }
    None
}

/// `data:<mime>;base64,<…>` of the first frame.
pub(crate) fn data_url(image: &ReferenceImage) -> String {
    use base64::Engine;
    format!("data:{};base64,{}", image.mime_type, base64::engine::general_purpose::STANDARD.encode(&image.bytes))
}

pub(crate) fn base64_of(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// The string at a JSON pointer, if any.
pub(crate) fn str_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

// ---------------------------------------------------------------- HS256 JWT (Kling)

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut block = [0u8; BLOCK];
    if key.len() > BLOCK {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.iter().map(|b| b ^ 0x36).collect::<Vec<u8>>());
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(block.iter().map(|b| b ^ 0x5c).collect::<Vec<u8>>());
    outer.update(inner);
    outer.finalize().into()
}

fn base64_url(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// A compact HS256 JWT over `claims`.
pub(crate) fn jwt_hs256(claims: &BTreeMap<&str, Value>, secret: &str) -> String {
    let header = base64_url(br#"{"alg":"HS256","typ":"JWT"}"#);
    let payload = base64_url(serde_json::to_string(claims).expect("claims serialize").as_bytes());
    let signing_input = format!("{header}.{payload}");
    let signature = base64_url(&hmac_sha256(secret.as_bytes(), signing_input.as_bytes()));
    format!("{signing_input}.{signature}")
}
