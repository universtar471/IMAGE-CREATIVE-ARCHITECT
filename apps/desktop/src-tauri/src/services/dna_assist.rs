//! Proposal-only AI DNA assistance through the HHTECH chat gateway (ADR-030).
use std::io::Cursor;
use std::time::{Duration, Instant};

use base64::Engine;
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::domain::{AssetRole, GenerationPurpose, GenerationStatus};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::providers::{hhtech, text::truncate};
use crate::repositories as repo;
use crate::secrets;
use crate::services::AppCore;
use crate::util::{self, prefix};

pub const MAX_BRIEF_CHARS: usize = 1_000;
pub const MAX_REFERENCES: usize = 3;
const ASSIST_TIMEOUT: Duration = Duration::from_secs(60);
const DEFAULT_MODEL: &str = "gemini-3.8-flash";
pub const ENV_ASSIST_MODEL: &str = "HHTECH_ASSIST_MODEL";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequest {
    pub project_id: String,
    pub mode: String,
    pub scope: String,
    pub brief: Option<String>,
    #[serde(default)]
    pub reference_asset_ids: Vec<String>,
    pub catalog: Value,
    pub system_prompt: String,
    #[serde(default)]
    pub translate: Vec<TranslateItem>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateItem { pub path: String, pub text: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistResult {
    pub raw: String,
    pub model_id: String,
    pub usage: Option<AssistUsage>,
    pub generation_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistUsage { pub input_tokens: u64, pub output_tokens: u64 }

pub fn run(core: &AppCore, request: AssistRequest) -> AppResult<AssistResult> {
    validate_request(&request)?;
    let (project, refs) = {
        let conn = core.conn()?;
        let project = repo::get_project(&conn, &request.project_id)?;
        let requested = if request.mode == "master" {
            if project.master_approved_at.is_none() || project.active_master_asset_id.is_none() {
                return Err(AppError::invalid_state("Approve a master image before using AI DNA assist in master mode."));
            }
            vec![project.active_master_asset_id.clone().unwrap()]
        } else { request.reference_asset_ids.clone() };
        let mut refs = Vec::new();
        for id in requested {
            let asset = repo::find_asset(&conn, &id)?.ok_or_else(|| AppError::not_found("Asset", &id))?;
            if asset.project_id != request.project_id { return Err(AppError::validation("Reference image must belong to this project.")); }
            if request.mode == "master" && asset.role != AssetRole::MasterArchitecture { return Err(AppError::invalid_state("The approved master asset is unavailable.")); }
            refs.push(asset);
        }
        (project, refs)
    };
    let config = hhtech::config(core.env.as_ref());
    let base = config.base_url.map_err(|_| AppError::new(ErrorCode::ProviderNotConfigured, "HHTECH_BASE_URL is required for AI DNA assist."))?;
    let key = secrets::resolve_key(core.secrets.as_ref(), core.env.as_ref(), hhtech::ID)
        .ok_or_else(|| AppError::new(ErrorCode::ProviderNotConfigured, "HHTECH API key is required for AI DNA assist."))?;
    let model = core.env.var(ENV_ASSIST_MODEL).map(|v| v.trim().to_owned()).filter(|v| !v.is_empty()).unwrap_or_else(|| DEFAULT_MODEL.into());
    let images = refs.iter().map(|asset| {
        let path = core.storage.resolve(&request.project_id, &asset.managed_rel_path)?;
        let bytes = std::fs::read(path).map_err(|_| AppError::new(ErrorCode::IoError, "Could not read a managed reference image."))?;
        downscale_jpeg(&bytes).map_err(|_| AppError::new(ErrorCode::UnsupportedFile, "Reference asset is not a readable image."))
    }).collect::<AppResult<Vec<_>>>()?;
    let generation_id = util::new_id(prefix::GENERATION);
    let now = core.now_iso();
    let safe_request = json!({"mode":request.mode,"scope":request.scope,"referenceCount":images.len(),"modelId":model});
    let row = repo::GenerationRow {
        id: generation_id.clone(), project_id: project.id, provider_id: hhtech::ID.into(), model_id: model.clone(),
        purpose: GenerationPurpose::Assist, status: GenerationStatus::Running, request_json: safe_request.to_string(),
        parent_asset_id: None, error_kind: None, error_message: None, error_retryable: None,
        started_at: now.clone(), finished_at: None, duration_ms: None, created_at: now.clone(), updated_at: now,
        camera_id: None, batch_id: None, job_id: None, job_started_at: None,
    };
    repo::insert_generation(&core.conn()?, &row)?;
    let started = Instant::now();
    let result = call_gateway(&base, &key.value, &model, &request, &images);
    let duration = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let now = core.now_iso();
    match result {
        Ok((raw, usage)) => {
            repo::finish_generation(&core.conn()?, &generation_id, GenerationStatus::Completed, None, None, Some(duration), &now)?;
            Ok(AssistResult { raw, model_id: model, usage, generation_id })
        }
        Err(error) => {
            let kind = if error.code == ErrorCode::ProviderQuota { "quota" } else if error.code == ErrorCode::InvalidState { "invalid_state" } else { "provider_error" };
            let _ = repo::finish_generation(&core.conn()?, &generation_id, GenerationStatus::Failed, Some(kind), Some(&error.message), Some(duration), &now);
            Err(error)
        }
    }
}

fn validate_request(request: &AssistRequest) -> AppResult<()> {
    if !["brief", "images", "master", "translate"].contains(&request.mode.as_str()) || !["interior", "building", "context", "lighting"].contains(&request.scope.as_str()) {
        return Err(AppError::validation("Unknown AI assist mode or scope."));
    }
    if request.brief.as_ref().is_some_and(|s| s.chars().count() > MAX_BRIEF_CHARS) { return Err(AppError::validation("Brief is longer than 1000 characters.")); }
    if request.reference_asset_ids.len() > MAX_REFERENCES { return Err(AppError::validation("Choose no more than 3 reference images.")); }
    if request.system_prompt.chars().count() > 20_000 || request.translate.iter().any(|t| t.text.chars().count() > 2_000) { return Err(AppError::validation("AI assist prompt is too long.")); }
    Ok(())
}

fn downscale_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let image = image.thumbnail(1024, 1024).to_rgb8();
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image).write_to(&mut output, ImageFormat::Jpeg).map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}

fn call_gateway(base: &str, key: &str, model: &str, request: &AssistRequest, images: &[Vec<u8>]) -> AppResult<(String, Option<AssistUsage>)> {
    let mut content = vec![json!({"type":"text","text":user_text(request)})];
    for image in images {
        let encoded = base64::engine::general_purpose::STANDARD.encode(image);
        content.push(json!({"type":"image_url","image_url":{"url":format!("data:image/jpeg;base64,{encoded}")}}));
    }
    let body = json!({"model":model,"messages":[{"role":"system","content":request.system_prompt},{"role":"user","content":content}],"response_format":{"type":"json_object"},"temperature":0.2});
    let client = reqwest::blocking::Client::builder().timeout(ASSIST_TIMEOUT).build().map_err(|_| AppError::new(ErrorCode::ProviderError,"Could not initialize HHTECH request."))?;
    let response = client.post(format!("{base}/chat/completions")).bearer_auth(key).json(&body).send().map_err(|e| {
        AppError::new(ErrorCode::ProviderError, if e.is_timeout() { "AI DNA assist timed out after 60 seconds." } else { "Could not reach the AI DNA assist provider." })
    })?;
    let status = response.status();
    let body_text = response.text().unwrap_or_default();
    if !status.is_success() {
        let lower = body_text.to_lowercase();
        if status.as_u16() == 401 || status.as_u16() == 402 || lower.contains("credit") || lower.contains("hết credit") || lower.contains("quota") {
            return Err(AppError::new(ErrorCode::ProviderQuota, "HHTECH quota or credit is exhausted. Check the provider balance and API key."));
        }
        return Err(AppError::new(ErrorCode::ProviderError, format!("AI DNA assist provider returned HTTP {}.", status.as_u16())));
    }
    let value: Value = serde_json::from_str(&body_text).map_err(|_| AppError::new(ErrorCode::ProviderError,"AI DNA assist provider returned an invalid response."))?;
    let raw = value.pointer("/choices/0/message/content").and_then(Value::as_str).ok_or_else(|| AppError::new(ErrorCode::ProviderError,"AI DNA assist provider returned an invalid reply."))?.to_owned();
    if serde_json::from_str::<Value>(&raw).is_err() && !raw.trim_start().starts_with("```") { return Err(AppError::new(ErrorCode::ProviderError,"AI DNA assist provider returned an invalid reply.")); }
    let usage = value.get("usage").and_then(|u| Some(AssistUsage { input_tokens: u.get("prompt_tokens")?.as_u64()?, output_tokens: u.get("completion_tokens")?.as_u64()? }));
    let _ = truncate(&raw, 0); // Keep raw reply exclusively in the returned proposal.
    Ok((raw, usage))
}

fn user_text(request: &AssistRequest) -> String {
    let mut parts = Vec::new();
    if let Some(brief) = request.brief.as_deref().filter(|s| !s.trim().is_empty()) { parts.push(format!("Brief:\n{}", brief.trim())); }
    if !request.translate.is_empty() { parts.push(format!("Translate only these paths:\n{}", serde_json::to_string(&request.translate).unwrap_or_default())); }
    if parts.is_empty() { "Infer suggestions from the attached reference images.".into() } else { parts.join("\n\n") }
}

