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

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;
    use crate::domain::{GenerationPurpose, JobStatus};
    use crate::error::ErrorCode;
    use crate::services::tests_support::{
        queue_harness, run_queue, set_cameras, test_create_villa, test_import, QueueHarness, CAM_A, CAM_B,
        TEST_LOCAL_PROVIDER, TEST_PROVIDER,
    };
    use crate::services::{generations, provider_settings};

    fn item(label: &str, camera: Option<&str>, refs: &[&str]) -> Value {
        json!({ "cameraId": camera, "label": label, "referenceAssetIds": refs,
            "prompt": { "compilerVersion": "1", "positivePrompt": format!("Render {label}"), "negativePrompt": "",
                        "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
            "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null } })
    }

    fn request(project_id: &str, provider: &str, items: Vec<Value>) -> BatchCreateRequest {
        serde_json::from_value(json!({ "projectId": project_id, "name": " Anchors ", "providerId": provider,
            "modelId": "full", "purpose": "anchor", "items": items }))
        .unwrap()
    }

    fn rows(h: &QueueHarness) -> (i64, i64, i64) {
        let conn = h.core.conn().unwrap();
        let n = |t: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0)).unwrap();
        (n("batches"), n("generations"), n("jobs"))
    }

    #[test]
    fn creates_one_queued_job_per_item_in_order() {
        let h = queue_harness();
        let p = test_create_villa(&h.core, "Batch villa");
        set_cameras(&h.core, &p.id, &[(CAM_A, "Front corner", true), (CAM_B, "Rear", true)]);
        let master = test_import(&h.core, h.tmp.path(), &p.id, "m.png", "master_architecture");
        let req = request(
            &p.id,
            TEST_LOCAL_PROVIDER,
            vec![item("Front corner — anchor", Some(CAM_A), &[&master.id]), item("Rear — anchor", Some(CAM_B), &[])],
        );
        let b = create(&h.core, req).unwrap();
        assert!(b.id.starts_with("BAT_"));
        assert_eq!((b.name.as_str(), b.purpose), ("Anchors", GenerationPurpose::Anchor));
        assert_eq!(b.job_ids.len(), 2);
        assert_eq!((b.counts.queued, b.counts.completed), (2, 0));

        let jobs: Vec<_> = b.job_ids.iter().map(|id| queue::get(&h.core, id).unwrap()).collect();
        assert_eq!(jobs[0].label, "Front corner — anchor");
        assert_eq!(jobs[1].camera_id.as_deref(), Some(CAM_B));
        assert!(jobs.iter().all(|j| j.batch_id.as_deref() == Some(b.id.as_str()) && j.status == JobStatus::Queued));
        let g = generations::get(&h.core, &p.id, &jobs[0].generation_id).unwrap();
        assert_eq!((g.batch_id.as_deref(), g.camera_id.as_deref()), (Some(b.id.as_str()), Some(CAM_A)));
        assert_eq!(g.prompt.positive_prompt, "Render Front corner — anchor");
        assert_eq!(g.parent_asset_id.as_deref(), Some(master.id.as_str()));

        run_queue(&h.core);
        let listed = list(&h.core, &p.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!((listed[0].counts.completed, listed[0].counts.queued), (2, 0));
        assert_eq!(listed[0].job_ids, b.job_ids, "item order");
    }

    #[test]
    fn one_invalid_item_rejects_the_whole_batch() {
        let h = queue_harness();
        provider_settings::set_api_key(&h.core, TEST_PROVIDER, "k").unwrap();
        let p = test_create_villa(&h.core, "Batch villa");
        set_cameras(&h.core, &p.id, &[(CAM_A, "Front", true)]);
        let ok = || item("ok", Some(CAM_A), &[]);
        let cases: Vec<(&str, Vec<Value>, ErrorCode)> = vec![
            ("unknown reference", vec![ok(), item("bad", None, &["AST_nope"])], ErrorCode::NotFound),
            ("camera not in the DNA", vec![ok(), item("bad", Some(CAM_B), &[])], ErrorCode::ValidationError),
            ("blank label", vec![ok(), item("  ", None, &[])], ErrorCode::ValidationError),
            (
                "empty prompt",
                vec![ok(), {
                    let mut i = ok();
                    i["prompt"]["positivePrompt"] = json!(" ");
                    i
                }],
                ErrorCode::ValidationError,
            ),
        ];
        for (what, items, code) in cases {
            let err = create(&h.core, request(&p.id, TEST_PROVIDER, items)).expect_err(what);
            assert_eq!(err.code, code, "{what}: {}", err.message);
            assert_eq!(err.details.as_ref().unwrap()["itemIndex"], json!(1), "{what}");
            assert!(err.message.starts_with("Item 2"), "{what}: {}", err.message);
        }
        assert_eq!(rows(&h), (0, 0, 0), "nothing inserted");

        let many: Vec<Value> = (0..MAX_ITEMS + 1).map(|i| item(&format!("i{i}"), None, &[])).collect();
        assert_eq!(create(&h.core, request(&p.id, TEST_PROVIDER, many)).unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(
            create(&h.core, request(&p.id, TEST_PROVIDER, vec![])).unwrap_err().code,
            ErrorCode::ValidationError
        );
        let mut unnamed = request(&p.id, TEST_PROVIDER, vec![ok()]);
        unnamed.name = " ".into();
        assert_eq!(create(&h.core, unnamed).unwrap_err().code, ErrorCode::ValidationError);
        let mut loud = request(&p.id, TEST_PROVIDER, vec![ok()]);
        loud.priority = 11;
        assert_eq!(create(&h.core, loud).unwrap_err().code, ErrorCode::ValidationError);
        provider_settings::clear_api_key(&h.core, TEST_PROVIDER).unwrap();
        let err = create(&h.core, request(&p.id, TEST_PROVIDER, vec![ok()])).unwrap_err();
        assert_eq!(err.code, ErrorCode::ProviderNotConfigured);
        assert_eq!(rows(&h), (0, 0, 0));
        assert_eq!(h.remote.calls(), 0);
    }

    #[test]
    fn items_fail_and_succeed_independently() {
        let h = queue_harness();
        let p = test_create_villa(&h.core, "Batch villa");
        let b = create(&h.core, request(&p.id, TEST_LOCAL_PROVIDER, vec![item("a", None, &[]), item("b", None, &[])]))
            .unwrap();
        queue::cancel(&h.core, &b.job_ids[0]).unwrap();
        run_queue(&h.core);
        let after = list(&h.core, &p.id).unwrap().remove(0);
        assert_eq!((after.counts.cancelled, after.counts.completed), (1, 1));
        let counts = serde_json::to_value(&after.counts).unwrap();
        let mut keys: Vec<&str> = counts.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["cancelled", "completed", "failed", "interrupted", "queued", "retrying", "running"]);
    }
}
