//! Comfy Cloud (ADR-043): runs a ComfyUI workflow the user exported in API format.
//!
//! `COMFY_VIDEO_WORKFLOW` names the JSON file. String values in it may hold placeholders:
//! `{{prompt}}`, `{{negative_prompt}}`, `{{image}}` (the uploaded first frame, required) and
//! `{{duration}}` (a value that is exactly `"{{duration}}"` becomes a number). Without
//! `{{duration}}` the workflow's own length wins.
//!
//! Calls follow the ComfyUI server API that Comfy Cloud exposes under `/api`:
//! `POST /api/upload/image` (multipart), `POST /api/prompt`, `GET /api/history/{prompt_id}`,
//! and `GET /api/view?filename=…` for the output, all with `X-API-Key`.

use serde_json::{json, Map, Value};

use super::{
    default_client, download_video, env_base_url, env_value, send_json, str_at, video_model, VideoApi, VideoPoll,
    VideoProvider, VideoRequest, VideoTask,
};
use crate::providers::{ProviderError, ProviderErrorKind};
use crate::secrets::EnvSource;

pub const ID: &str = "comfy_cloud";
pub const ENV_API_KEY: &str = "COMFY_CLOUD_API_KEY";
pub const ENV_BASE_URL: &str = "COMFY_CLOUD_BASE_URL";
pub const ENV_WORKFLOW: &str = "COMFY_VIDEO_WORKFLOW";
pub const MODEL_ID: &str = "workflow";
const DEFAULT_BASE_URL: &str = "https://cloud.comfy.org";
const MAX_WORKFLOW_BYTES: u64 = 2 * 1024 * 1024;
const VENDOR: &str = "Comfy Cloud";

pub fn provider(env: &dyn EnvSource) -> VideoProvider {
    let (workflow, workflow_problem) = match load_workflow(env) {
        Ok(workflow) => (workflow, None),
        Err(problem) => (Value::Null, Some(problem)),
    };
    let (base_url, url_problem) = match env_base_url(env, ENV_BASE_URL, DEFAULT_BASE_URL) {
        Ok(url) => (url, None),
        Err(problem) => (String::new(), Some(problem)),
    };
    VideoProvider {
        id: ID,
        label: "Comfy Cloud (video workflow)",
        models: vec![video_model(MODEL_ID, "Your exported workflow", &[5, 10], &[])],
        problem: url_problem.or(workflow_problem),
        api: Box::new(ComfyApi { base_url, workflow }),
    }
}

fn load_workflow(env: &dyn EnvSource) -> Result<Value, String> {
    let path = env_value(env, ENV_WORKFLOW).ok_or_else(|| {
        format!("Set {ENV_WORKFLOW} to a ComfyUI workflow exported in API format (see README, Video providers).")
    })?;
    let size =
        std::fs::metadata(&path).map_err(|_| format!("{ENV_WORKFLOW} points to a file that cannot be read."))?.len();
    if size > MAX_WORKFLOW_BYTES {
        return Err(format!("The workflow in {ENV_WORKFLOW} is larger than 2 MB."));
    }
    let text =
        std::fs::read_to_string(&path).map_err(|_| format!("{ENV_WORKFLOW} points to a file that cannot be read."))?;
    parse_workflow(&text)
}

/// An API-format workflow: an object of nodes, each with `class_type`, using `{{image}}`.
pub fn parse_workflow(text: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(text).map_err(|_| "The Comfy workflow is not valid JSON.".to_string())?;
    let nodes = value
        .as_object()
        .filter(|o| !o.is_empty())
        .ok_or_else(|| "The Comfy workflow must be exported with \"Export (API)\" (an object of nodes).".to_string())?;
    if nodes.values().any(|node| node.get("class_type").and_then(Value::as_str).is_none()) {
        return Err("The Comfy workflow must be exported with \"Export (API)\", not the regular save.".to_string());
    }
    if !text.contains("{{image}}") {
        return Err("The Comfy workflow needs a {{image}} placeholder in its LoadImage node.".to_string());
    }
    Ok(value)
}

/// The workflow with every placeholder filled in.
pub fn fill(workflow: &Value, request: &VideoRequest, image_name: &str) -> Value {
    match workflow {
        Value::String(s) if s == "{{duration}}" => json!(request.duration_sec),
        Value::String(s) => Value::String(
            s.replace("{{prompt}}", &request.prompt)
                .replace("{{negative_prompt}}", &request.negative_prompt)
                .replace("{{image}}", image_name)
                .replace("{{duration}}", &request.duration_sec.to_string()),
        ),
        Value::Array(items) => Value::Array(items.iter().map(|v| fill(v, request, image_name)).collect()),
        Value::Object(map) => {
            Value::Object(map.iter().map(|(k, v)| (k.clone(), fill(v, request, image_name))).collect::<Map<_, _>>())
        }
        other => other.clone(),
    }
}

pub struct ComfyApi {
    pub base_url: String,
    pub workflow: Value,
}

fn valid_prompt_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The first video file among a history entry's outputs.
fn first_video(outputs: &Value) -> Option<(String, String, String)> {
    for node in outputs.as_object()?.values() {
        for list in ["videos", "gifs", "images"] {
            for file in node.get(list).and_then(Value::as_array).into_iter().flatten() {
                let name = file.get("filename").and_then(Value::as_str).unwrap_or_default();
                let lower = name.to_lowercase();
                if [".mp4", ".mov", ".webm"].iter().any(|ext| lower.ends_with(ext)) {
                    let sub = file.get("subfolder").and_then(Value::as_str).unwrap_or_default();
                    let kind = file.get("type").and_then(Value::as_str).unwrap_or("output");
                    return Some((name.to_string(), sub.to_string(), kind.to_string()));
                }
            }
        }
    }
    None
}

impl VideoApi for ComfyApi {
    fn submit(&self, request: &VideoRequest, key: &str) -> Result<VideoTask, ProviderError> {
        if self.workflow.is_null() {
            return Err(ProviderError::new(ProviderErrorKind::InvalidRequest, format!("Set {ENV_WORKFLOW} first.")));
        }
        let ext = if request.image.mime_type == "image/jpeg" { "jpg" } else { "png" };
        let part = reqwest::blocking::multipart::Part::bytes(request.image.bytes.clone())
            .file_name(format!("{}.{ext}", request.image.asset_id))
            .mime_str(&request.image.mime_type)
            .map_err(|_| {
                ProviderError::new(ProviderErrorKind::InvalidRequest, "The first frame has an unknown type.")
            })?;
        let form = reqwest::blocking::multipart::Form::new().part("image", part).text("overwrite", "true");
        let upload = default_client()?
            .post(format!("{}/api/upload/image", self.base_url))
            .header("X-API-Key", key)
            .multipart(form);
        let uploaded = send_json(VENDOR, upload, key)?;
        let name = str_at(&uploaded, "/name").filter(|n| !n.is_empty()).ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::BadResponse, "Comfy Cloud stored the first frame but named no file.")
        })?;
        let image_name = match str_at(&uploaded, "/subfolder").filter(|s| !s.is_empty()) {
            Some(sub) => format!("{sub}/{name}"),
            None => name.to_string(),
        };
        let body = json!({
            "prompt": fill(&self.workflow, request, &image_name),
            "extra_data": { "api_key_comfy_org": key },
        });
        let http = default_client()?.post(format!("{}/api/prompt", self.base_url)).header("X-API-Key", key).json(&body);
        let value = send_json(VENDOR, http, key)?;
        if let Some(error) = value.get("error").filter(|e| !e.is_null()) {
            let message = str_at(error, "/message").map(str::to_string).unwrap_or_else(|| error.to_string());
            return Err(ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                format!("Comfy Cloud rejected the workflow: {}", super::redact(&message, key)),
            ));
        }
        let id = str_at(&value, "/prompt_id").filter(|id| valid_prompt_id(id)).ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::BadResponse, "Comfy Cloud queued the workflow but returned no id.")
        })?;
        Ok(VideoTask { id: id.to_string(), extra: Value::Null })
    }

    fn poll(&self, task: &VideoTask, key: &str) -> Result<VideoPoll, ProviderError> {
        if !valid_prompt_id(&task.id) {
            return Err(ProviderError::new(ProviderErrorKind::BadResponse, "The stored Comfy Cloud id is not valid."));
        }
        let http = default_client()?.get(format!("{}/api/history/{}", self.base_url, task.id)).header("X-API-Key", key);
        let value = send_json(VENDOR, http, key)?;
        let Some(entry) = value.get(&task.id) else {
            return Ok(VideoPoll::Pending);
        };
        let status = str_at(entry, "/status/status_str").unwrap_or_default();
        if status == "error" {
            let detail = entry
                .pointer("/status/messages")
                .and_then(Value::as_array)
                .and_then(|m| m.iter().find(|msg| msg.get(0).and_then(Value::as_str) == Some("execution_error")))
                .and_then(|msg| str_at(msg, "/1/exception_message"))
                .unwrap_or("the workflow stopped with an error");
            return Ok(VideoPoll::Failed {
                message: format!("Comfy Cloud could not run the workflow: {}", super::redact(detail, key)),
                blocked: false,
            });
        }
        let completed = entry.pointer("/status/completed").and_then(Value::as_bool).unwrap_or(status == "success");
        if !completed {
            return Ok(VideoPoll::Pending);
        }
        let (filename, subfolder, kind) =
            first_video(entry.get("outputs").unwrap_or(&Value::Null)).ok_or_else(|| {
                ProviderError::new(
                    ProviderErrorKind::BadResponse,
                    "The Comfy workflow finished without a video output (add a SaveVideo node).",
                )
            })?;
        let mut url = reqwest::Url::parse(&format!("{}/api/view", self.base_url))
            .map_err(|_| ProviderError::new(ProviderErrorKind::BadResponse, "Invalid Comfy Cloud base URL."))?;
        url.query_pairs_mut()
            .append_pair("filename", &filename)
            .append_pair("subfolder", &subfolder)
            .append_pair("type", &kind);
        Ok(VideoPoll::Done { url: url.to_string() })
    }

    /// The `/api/view` link needs the key; the signed storage link it redirects to does not.
    fn download(&self, url: &str, key: &str) -> Result<Vec<u8>, ProviderError> {
        if !url.starts_with(&format!("{}/api/view?", self.base_url)) {
            return Err(ProviderError::new(ProviderErrorKind::BadResponse, "The Comfy Cloud video link is not valid."));
        }
        download_video(VENDOR, url, &[("X-API-Key", key)], key)
    }
}
