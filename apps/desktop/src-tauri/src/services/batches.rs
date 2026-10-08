//! Batches (ADR-018): a named group of independent jobs sharing one provider, model and
//! purpose. Every item is validated like `generation_submit` before anything is inserted;
//! then the batch, its generations and its jobs are inserted in one transaction, in item order.

use serde::Deserialize;
use serde_json::json;

use crate::dto::{BatchDto, JobCounts, PromptBundle};
use crate::error::{AppError, AppResult};
use crate::providers::GenerationParams;
use crate::repositories::{self as repo, BatchRow};
use crate::services::generations::{self, JobOptions, SubmitRequest};
use crate::services::{queue, AppCore};
use crate::util::{new_id, prefix};

pub const MAX_ITEMS: usize = 50;
pub const PRIORITY_RANGE: std::ops::RangeInclusive<i64> = -10..=10;

/// Mirrors `BatchItemSchema`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItem {
    #[serde(default)]
    pub camera_id: Option<String>,
    pub label: String,
    pub prompt: PromptBundle,
    #[serde(default)]
    pub reference_asset_ids: Vec<String>,
    pub params: GenerationParams,
}

/// Mirrors `BatchCreateRequestSchema`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchCreateRequest {
    pub project_id: String,
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: String,
    #[serde(default)]
    pub priority: i64,
    pub items: Vec<BatchItem>,
}

/// Validate every item, then insert everything or nothing. All jobs start `queued`.
pub fn create(core: &AppCore, req: BatchCreateRequest) -> AppResult<BatchDto> {
    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::validation("Give the batch a name."));
    }
    if req.items.is_empty() || req.items.len() > MAX_ITEMS {
        return Err(AppError::validation(format!("A batch needs between 1 and {MAX_ITEMS} items.")));
    }
    if !PRIORITY_RANGE.contains(&req.priority) {
        return Err(AppError::validation(format!(
            "Priority must be between {} and {}.",
            PRIORITY_RANGE.start(),
            PRIORITY_RANGE.end()
        )));
    }
    let purpose = generations::parse_purpose(&req.purpose)?;

    let mut validated = Vec::with_capacity(req.items.len());
    for (index, item) in req.items.into_iter().enumerate() {
        let item_error = |e: AppError| {
            let message = format!("Item {} ('{}'): {}", index + 1, item.label.trim(), e.message);
            let mut details = e.details.clone().unwrap_or_else(|| json!({}));
            if let Some(map) = details.as_object_mut() {
                map.insert("itemIndex".into(), json!(index));
            }
            AppError { code: e.code, message, details: Some(details) }
        };
        let label = item.label.trim().to_string();
        if label.is_empty() {
            return Err(item_error(AppError::validation("The item label is empty.")));
        }
        let request = SubmitRequest {
            project_id: req.project_id.clone(),
            provider_id: req.provider_id.clone(),
            model_id: req.model_id.clone(),
            purpose: req.purpose.clone(),
            prompt: item.prompt.clone(),
            reference_asset_ids: item.reference_asset_ids.clone(),
            params: item.params.clone(),
            camera_id: item.camera_id.clone(),
        };
        let v = generations::validate(core, request).map_err(item_error)?;
        validated.push((v, label));
    }

    let now = core.now_iso();
    let batch = BatchRow {
        id: new_id(prefix::BATCH),
        project_id: req.project_id.clone(),
        name,
        provider_id: req.provider_id.clone(),
        model_id: req.model_id.clone(),
        purpose,
        created_at: now.clone(),
    };
    let job_ids = {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        repo::insert_batch(&tx, &batch)?;
        let mut job_ids = Vec::with_capacity(validated.len());
        for (v, label) in &validated {
            let options = JobOptions { label: label.clone(), priority: req.priority, batch_id: Some(batch.id.clone()) };
            job_ids.push(generations::insert_queued(core, &tx, v, &options, &now)?.1);
        }
        tx.commit()?;
        job_ids
    };
    queue::enqueued(core, &job_ids);
    let conn = core.conn()?;
    to_dto(&conn, batch)
}

fn to_dto(conn: &rusqlite::Connection, b: BatchRow) -> AppResult<BatchDto> {
    let jobs = repo::list_batch_jobs(conn, &b.id)?;
    let mut counts = JobCounts::default();
    for (_, status) in &jobs {
        counts.add(*status);
    }
    Ok(BatchDto {
        id: b.id,
        project_id: b.project_id,
        name: b.name,
        provider_id: b.provider_id,
        model_id: b.model_id,
        purpose: b.purpose,
        created_at: b.created_at,
        job_ids: jobs.into_iter().map(|(id, _)| id).collect(),
        counts,
    })
}

/// Newest first, with per-status job counts.
pub fn list(core: &AppCore, project_id: &str) -> AppResult<Vec<BatchDto>> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    repo::list_batches(&conn, project_id)?.into_iter().map(|b| to_dto(&conn, b)).collect()
}

pub fn get(core: &AppCore, batch_id: &str) -> AppResult<BatchDto> {
    let conn = core.conn()?;
    let batch = repo::find_batch(&conn, batch_id)?.ok_or_else(|| AppError::not_found("Batch", batch_id))?;
    to_dto(&conn, batch)
}
