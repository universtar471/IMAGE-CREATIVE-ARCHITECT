//! Kling image-to-video (ADR-043): `POST /v1/videos/image2video`, then
//! `GET /v1/videos/image2video/{task_id}` until `task_status` is `succeed` or `failed`.
//!
//! The key is stored as `ACCESS_KEY:SECRET_KEY`; every call carries a short-lived HS256 JWT
//! (`iss` = access key) signed with the secret key. The first frame goes as raw base64.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::{
    default_client, download_video, env_base_url, env_models, jwt_hs256, send_json, str_at, video_model, VideoApi,
    VideoPoll, VideoProvider, VideoRequest, VideoTask,
};
use crate::providers::{ProviderError, ProviderErrorKind};
use crate::secrets::EnvSource;

pub const ID: &str = "kling";
pub const ENV_API_KEY: &str = "KLING_API_KEY";
pub const ENV_BASE_URL: &str = "KLING_BASE_URL";
pub const ENV_MODELS: &str = "KLING_VIDEO_MODEL";
const DEFAULT_BASE_URL: &str = "https://api-singapore.klingai.com";
const DEFAULT_MODELS: &[&str] = &["kling-v2-1"];
const VENDOR: &str = "Kling";

pub fn provider(env: &dyn EnvSource) -> VideoProvider {
    let (models, models_problem) = env_models(env, ENV_MODELS, DEFAULT_MODELS, |id| {
        // Image-to-video follows the first frame's shape, so no aspect ratio is offered.
        video_model(id, id, &[5, 10], &[])
    });
    let (base_url, url_problem) = match env_base_url(env, ENV_BASE_URL, DEFAULT_BASE_URL) {
        Ok(url) => (url, None),
        Err(problem) => (String::new(), Some(problem)),
    };
    VideoProvider {
        id: ID,
        label: "Kling (video)",
        models,
        problem: url_problem.or(models_problem),
        api: Box::new(KlingApi { base_url }),
    }
}

pub struct KlingApi {
    pub base_url: String,
}

/// Splits `ACCESS_KEY:SECRET_KEY`.
fn split_key(key: &str) -> Result<(&str, &str), ProviderError> {
    key.trim()
        .split_once(':')
        .map(|(a, s)| (a.trim(), s.trim()))
        .filter(|(a, s)| !a.is_empty() && !s.is_empty())
        .ok_or_else(|| {
            ProviderError::new(
                ProviderErrorKind::Auth,
                "The Kling key must be entered as ACCESS_KEY:SECRET_KEY (both from the Kling developer console).",
            )
        })
}

/// The bearer token Kling expects, valid 30 minutes from `now` (unix seconds).
pub fn token(key: &str, now: i64) -> Result<String, ProviderError> {
    let (access, secret) = split_key(key)?;
    let claims = BTreeMap::from([("iss", json!(access)), ("exp", json!(now + 1800)), ("nbf", json!(now - 5))]);
    Ok(jwt_hs256(&claims, secret))
}

fn bearer(key: &str) -> Result<String, ProviderError> {
    Ok(format!("Bearer {}", token(key, chrono::Utc::now().timestamp())?))
}

/// Kling answers HTTP 200 with a non-zero `code` on errors.
fn checked(value: Value) -> Result<Value, ProviderError> {
    match value.get("code").and_then(Value::as_i64) {
        None | Some(0) => Ok(value),
        Some(code) => {
            let message = str_at(&value, "/message").unwrap_or("no message");
            let kind = match code {
                1000..=1004 => ProviderErrorKind::Auth,
                1100..=1103 | 1302 | 1303 => ProviderErrorKind::RateLimited,
                1301 => ProviderErrorKind::Blocked,
                5000..=5999 => ProviderErrorKind::Network,
                _ => ProviderErrorKind::InvalidRequest,
            };
            Err(ProviderError::new(kind, format!("Kling refused the request (code {code}): {message}")))
        }
    }
}

impl VideoApi for KlingApi {
    fn submit(&self, request: &VideoRequest, key: &str) -> Result<VideoTask, ProviderError> {
        let mut body = json!({
            "model_name": request.model_id,
            "image": super::base64_of(&request.image.bytes),
            "prompt": request.prompt,
            "duration": request.duration_sec.to_string(),
            "mode": "std",
        });
        if !request.negative_prompt.trim().is_empty() {
            body["negative_prompt"] = json!(request.negative_prompt);
        }
        let http = default_client()?
            .post(format!("{}/v1/videos/image2video", self.base_url))
            .header("Authorization", bearer(key)?)
            .json(&body);
        let value = checked(send_json(VENDOR, http, key)?)?;
        let id = str_at(&value, "/data/task_id").filter(|id| !id.is_empty()).ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::BadResponse, "Kling accepted the request but returned no task id.")
        })?;
        Ok(VideoTask { id: id.to_string(), extra: Value::Null })
    }

    fn poll(&self, task: &VideoTask, key: &str) -> Result<VideoPoll, ProviderError> {
        let http = default_client()?
            .get(format!("{}/v1/videos/image2video/{}", self.base_url, task.id))
            .header("Authorization", bearer(key)?);
        let value = checked(send_json(VENDOR, http, key)?)?;
        match str_at(&value, "/data/task_status").unwrap_or_default() {
            "succeed" => str_at(&value, "/data/task_result/videos/0/url")
                .map(|url| VideoPoll::Done { url: url.to_string() })
                .ok_or_else(|| {
                    ProviderError::new(ProviderErrorKind::BadResponse, "Kling finished but returned no video.")
                }),
            "failed" => {
                let message = str_at(&value, "/data/task_status_msg").unwrap_or("no reason given").to_string();
                let lower = message.to_lowercase();
                let blocked = ["risk", "safety", "sensitive", "violat"].iter().any(|w| lower.contains(w));
                Ok(VideoPoll::Failed { message: format!("Kling could not make the video: {message}"), blocked })
            }
            _ => Ok(VideoPoll::Pending),
        }
    }

    fn download(&self, url: &str, key: &str) -> Result<Vec<u8>, ProviderError> {
        download_video(VENDOR, url, &[], key)
    }
}
