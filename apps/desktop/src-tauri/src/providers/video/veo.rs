//! Veo through the Gemini API (ADR-043): `POST /v1beta/models/{model}:predictLongRunning`
//! returns an operation; `GET /v1beta/{operation}` until `done`. The key goes in
//! `x-goog-api-key` (a Gemini API key works); the clip link also needs it.

use serde_json::{json, Value};

use super::{
    default_client, download_video, env_base_url, env_models, send_json, str_at, video_model, VideoApi, VideoPoll,
    VideoProvider, VideoRequest, VideoTask,
};
use crate::providers::{ProviderError, ProviderErrorKind};
use crate::secrets::EnvSource;

pub const ID: &str = "veo";
pub const ENV_API_KEY: &str = "VEO_API_KEY";
/// A Gemini API key also works for Veo.
pub const ENV_GEMINI_KEY: &str = "GEMINI_API_KEY";
pub const ENV_BASE_URL: &str = "VEO_BASE_URL";
pub const ENV_MODELS: &str = "VEO_VIDEO_MODEL";
const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com";
const DEFAULT_MODELS: &[&str] = &["veo-3.1-generate-preview"];
const VENDOR: &str = "Veo";

pub fn provider(env: &dyn EnvSource) -> VideoProvider {
    let (models, models_problem) =
        env_models(env, ENV_MODELS, DEFAULT_MODELS, |id| video_model(id, id, &[4, 6, 8], &["16:9", "9:16"]));
    let (base_url, url_problem) = match env_base_url(env, ENV_BASE_URL, DEFAULT_BASE_URL) {
        Ok(url) => (url, None),
        Err(problem) => (String::new(), Some(problem)),
    };
    VideoProvider {
        id: ID,
        label: "Veo (video)",
        models,
        problem: url_problem.or(models_problem),
        api: Box::new(VeoApi { base_url }),
    }
}

pub struct VeoApi {
    pub base_url: String,
}

/// Operation names look like `models/<model>/operations/<id>`; nothing else is followed.
fn valid_operation(name: &str) -> bool {
    !name.is_empty()
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-._/".contains(c))
        && name.contains("operations/")
}

impl VideoApi for VeoApi {
    fn submit(&self, request: &VideoRequest, key: &str) -> Result<VideoTask, ProviderError> {
        let mut parameters = json!({ "durationSeconds": request.duration_sec, "sampleCount": 1 });
        if let Some(ratio) = &request.aspect_ratio {
            parameters["aspectRatio"] = json!(ratio);
        }
        if !request.negative_prompt.trim().is_empty() {
            parameters["negativePrompt"] = json!(request.negative_prompt);
        }
        let body = json!({
            "instances": [{
                "prompt": request.prompt,
                "image": {
                    "bytesBase64Encoded": super::base64_of(&request.image.bytes),
                    "mimeType": request.image.mime_type,
                },
            }],
            "parameters": parameters,
        });
        let http = default_client()?
            .post(format!("{}/v1beta/models/{}:predictLongRunning", self.base_url, request.model_id))
            .header("x-goog-api-key", key)
            .json(&body);
        let value = send_json(VENDOR, http, key)?;
        let name = str_at(&value, "/name").filter(|n| valid_operation(n)).ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::BadResponse, "Veo accepted the request but returned no operation.")
        })?;
        Ok(VideoTask { id: name.to_string(), extra: Value::Null })
    }

    fn poll(&self, task: &VideoTask, key: &str) -> Result<VideoPoll, ProviderError> {
        if !valid_operation(&task.id) {
            return Err(ProviderError::new(ProviderErrorKind::BadResponse, "The stored Veo operation is not valid."));
        }
        let http = default_client()?.get(format!("{}/v1beta/{}", self.base_url, task.id)).header("x-goog-api-key", key);
        let value = send_json(VENDOR, http, key)?;
        if !value.get("done").and_then(Value::as_bool).unwrap_or(false) {
            return Ok(VideoPoll::Pending);
        }
        if let Some(message) = str_at(&value, "/error/message") {
            return Ok(VideoPoll::Failed {
                message: format!("Veo could not make the video: {message}"),
                blocked: false,
            });
        }
        let response = value.pointer("/response/generateVideoResponse").cloned().unwrap_or(Value::Null);
        if let Some(uri) = str_at(&response, "/generatedSamples/0/video/uri") {
            return Ok(VideoPoll::Done { url: uri.to_string() });
        }
        let reasons: Vec<&str> = response
            .get("raiMediaFilteredReasons")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        if !reasons.is_empty() {
            return Ok(VideoPoll::Failed {
                message: format!("Veo's safety filter held the video back: {}", reasons.join("; ")),
                blocked: true,
            });
        }
        Err(ProviderError::new(ProviderErrorKind::BadResponse, "Veo finished but returned no video."))
    }

    fn download(&self, url: &str, key: &str) -> Result<Vec<u8>, ProviderError> {
        download_video(VENDOR, url, &[("x-goog-api-key", key)], key)
    }
}
