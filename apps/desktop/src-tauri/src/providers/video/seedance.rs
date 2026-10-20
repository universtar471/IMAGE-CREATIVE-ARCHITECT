//! Seedance through BytePlus ModelArk (ADR-043): `POST /api/v3/contents/generations/tasks`
//! with a text part and the first frame, then `GET …/tasks/{id}` until `succeeded` or
//! `failed`. Duration and ratio ride in the text as `--duration` / `--ratio` flags, as the
//! ModelArk guide shows. Seedance has no negative prompt; the app's avoid list is appended to
//! the prompt as plain "Avoid: …" text instead.

use serde_json::{json, Value};

use super::{
    data_url, default_client, download_video, env_base_url, env_models, send_json, str_at, video_model, VideoApi,
    VideoPoll, VideoProvider, VideoRequest, VideoTask,
};
use crate::providers::{ProviderError, ProviderErrorKind};
use crate::secrets::EnvSource;

pub const ID: &str = "seedance";
pub const ENV_API_KEY: &str = "ARK_API_KEY";
pub const ENV_BASE_URL: &str = "SEEDANCE_BASE_URL";
pub const ENV_MODELS: &str = "SEEDANCE_VIDEO_MODEL";
const DEFAULT_BASE_URL: &str = "https://ark.ap-southeast.bytepluses.com";
const DEFAULT_MODELS: &[&str] = &["seedance-1-0-pro-250528"];
const VENDOR: &str = "Seedance";

pub fn provider(env: &dyn EnvSource) -> VideoProvider {
    let (models, models_problem) = env_models(env, ENV_MODELS, DEFAULT_MODELS, |id| {
        let mut model = video_model(id, id, &[5, 10], &["adaptive", "16:9", "9:16", "1:1"]);
        model.supports_negative_prompt = false;
        model
    });
    let (base_url, url_problem) = match env_base_url(env, ENV_BASE_URL, DEFAULT_BASE_URL) {
        Ok(url) => (url, None),
        Err(problem) => (String::new(), Some(problem)),
    };
    VideoProvider {
        id: ID,
        label: "Seedance (video)",
        models,
        problem: url_problem.or(models_problem),
        api: Box::new(SeedanceApi { base_url }),
    }
}

pub struct SeedanceApi {
    pub base_url: String,
}

fn valid_task_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_".contains(c))
}

/// The text part: prompt, avoid list, then the parameter flags.
pub fn text_part(request: &VideoRequest) -> String {
    let mut text = request.prompt.trim().to_string();
    if !request.negative_prompt.trim().is_empty() {
        text.push_str(&format!(" Avoid: {}.", request.negative_prompt.trim().trim_end_matches('.')));
    }
    text.push_str(&format!(" --duration {}", request.duration_sec));
    text.push_str(&format!(" --ratio {}", request.aspect_ratio.as_deref().unwrap_or("adaptive")));
    text
}

impl VideoApi for SeedanceApi {
    fn submit(&self, request: &VideoRequest, key: &str) -> Result<VideoTask, ProviderError> {
        let body = json!({
            "model": request.model_id,
            "content": [
                { "type": "text", "text": text_part(request) },
                { "type": "image_url", "image_url": { "url": data_url(&request.image) } },
            ],
        });
        let http = default_client()?
            .post(format!("{}/api/v3/contents/generations/tasks", self.base_url))
            .bearer_auth(key)
            .json(&body);
        let value = send_json(VENDOR, http, key)?;
        let id = str_at(&value, "/id").filter(|id| valid_task_id(id)).ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::BadResponse, "Seedance accepted the request but returned no task id.")
        })?;
        Ok(VideoTask { id: id.to_string(), extra: Value::Null })
    }

    fn poll(&self, task: &VideoTask, key: &str) -> Result<VideoPoll, ProviderError> {
        if !valid_task_id(&task.id) {
            return Err(ProviderError::new(
                ProviderErrorKind::BadResponse,
                "The stored Seedance task id is not valid.",
            ));
        }
        let http = default_client()?
            .get(format!("{}/api/v3/contents/generations/tasks/{}", self.base_url, task.id))
            .bearer_auth(key);
        let value = send_json(VENDOR, http, key)?;
        match str_at(&value, "/status").unwrap_or_default() {
            "succeeded" => {
                str_at(&value, "/content/video_url").map(|url| VideoPoll::Done { url: url.to_string() }).ok_or_else(
                    || ProviderError::new(ProviderErrorKind::BadResponse, "Seedance finished but returned no video."),
                )
            }
            status @ ("failed" | "cancelled" | "expired") => {
                let message = str_at(&value, "/error/message").unwrap_or(status).to_string();
                let code = str_at(&value, "/error/code").unwrap_or_default().to_lowercase();
                let blocked = code.contains("sensitive") || code.contains("risk");
                Ok(VideoPoll::Failed { message: format!("Seedance could not make the video: {message}"), blocked })
            }
            _ => Ok(VideoPoll::Pending),
        }
    }

    fn download(&self, url: &str, key: &str) -> Result<Vec<u8>, ProviderError> {
        download_video(VENDOR, url, &[], key)
    }
}
