//! Synchronous generation with persisted history (ADR-014) and generated-output lineage
//! (ADR-015).
//!
//! `submit` = validate everything (no row yet) -> insert a `running` row -> release the DB
//! lock -> call the provider -> inspect + write outputs -> one transaction that inserts the
//! assets, versions and output rows and marks the row `completed`. Anything that goes wrong
//! after the provider was called becomes a `failed` history entry, never a bridge error.

use std::fs;
use std::sync::Arc;
use std::time::Instant;

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::domain::{AssetRole, AssetSource, GenerationPurpose, GenerationStatus};
use crate::dto::{GenerationDto, GenerationErrorDto, PromptBundle};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::imaging::{self, Inspection};
use crate::providers::{
    GenerationParams, ImageProvider, ModelCapabilities, PromptText, ProviderOutput, ProviderRequest, ReferenceImage,
};
use crate::repositories::{self as repo, AssetRow, GenerationErrorRow, GenerationRow, VersionRow};
use crate::services::assets::{store_managed_image, StoredImage, Thumbnail};
use crate::services::provider_settings::{find_provider, key_for, not_configured};
use crate::services::{ensure_not_archived, AppCore};
use crate::util::{new_id, now_iso, prefix};

/// Upper bound of `GenerationParamsSchema.outputCount`, whatever the model allows.
pub const MAX_OUTPUT_COUNT: u32 = 4;
pub const INTERRUPTED_MESSAGE: &str = "The app closed before this generation finished. Run it again.";

/// Mirrors `GenerationSubmitRequestSchema`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitRequest {
    pub project_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: String,
    pub prompt: PromptBundle,
    #[serde(default)]
    pub reference_asset_ids: Vec<String>,
    pub params: GenerationParams,
}

/// What `generations.request_json` holds: the provider-neutral request, never a key.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct RequestSnapshot {
    prompt: PromptBundle,
    reference_asset_ids: Vec<String>,
    params: GenerationParams,
}

/// A request that passed every check and is ready to send.
struct Prepared {
    project_id: String,
    provider: Arc<dyn ImageProvider>,
    model: ModelCapabilities,
    purpose: GenerationPurpose,
    snapshot: RequestSnapshot,
    parent_asset_id: Option<String>,
    references: Vec<ReferenceImage>,
    api_key: Option<String>,
}

/// Why a generation ended `failed` after the provider was called.
#[derive(Debug)]
struct Failure(GenerationErrorRow);

impl Failure {
    fn new(kind: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self(GenerationErrorRow { kind: kind.into(), message: message.into(), retryable })
    }
}

/// Local DB / file failure while saving outputs: kind `io` (see the agent note).
impl From<AppError> for Failure {
    fn from(e: AppError) -> Self {
        Failure::new("io", format!("The generated images could not be saved: {}", e.message), true)
    }
}

pub fn parse_purpose(s: &str) -> AppResult<GenerationPurpose> {
    GenerationPurpose::parse(s)
        .ok_or_else(|| AppError::validation(format!("Unknown generation purpose '{s}'. Use 'hero' or 'variation'.")))
}

// ------------------------------------------------------------------ validation

/// Every check of API_CONTRACTS §9, before any row is written or any byte is sent.
fn prepare(core: &AppCore, req: SubmitRequest) -> AppResult<Prepared> {
    let purpose = parse_purpose(&req.purpose)?;
    let provider = find_provider(core, &req.provider_id)?;
    let info = provider.info();
    let model = info
        .model(&req.model_id)
        .cloned()
        .ok_or_else(|| AppError::not_found(&format!("Model of {}", info.label), &req.model_id))?;
    validate_against_model(&req, &model)?;

    // Project + reference rows under the lock; file reads after releasing it.
    let (project, assets) = {
        let conn = core.conn()?;
        let project = repo::get_project(&conn, &req.project_id)?;
        ensure_not_archived(&project)?;
        let assets = req
            .reference_asset_ids
            .iter()
            .map(|id| check_reference(core, &conn, &project.id, id))
            .collect::<AppResult<Vec<AssetRow>>>()?;
        (project, assets)
    };
    let references = assets.iter().map(|a| read_reference(core, a)).collect::<AppResult<Vec<_>>>()?;

    // Lineage anchor: the master if referenced, else the first reference.
    let master = project.active_master_asset_id.as_deref();
    let parent_asset_id =
        assets.iter().find(|a| Some(a.id.as_str()) == master).or_else(|| assets.first()).map(|a| a.id.clone());

    let api_key = if info.requires_api_key {
        Some(key_for(core, provider.as_ref()).ok_or_else(|| not_configured(provider.as_ref()))?.value)
    } else {
        None
    };

    Ok(Prepared {
        project_id: project.id,
        provider,
        model,
        purpose,
        snapshot: RequestSnapshot {
            prompt: req.prompt,
            reference_asset_ids: req.reference_asset_ids,
            params: req.params,
        },
        parent_asset_id,
        references,
        api_key,
    })
}

fn validate_against_model(req: &SubmitRequest, model: &ModelCapabilities) -> AppResult<()> {
    let p = &req.params;
    let refs = &req.reference_asset_ids;
    if req.prompt.positive_prompt.trim().is_empty() {
        return Err(AppError::validation("The prompt is empty. Describe what to generate first."));
    }
    if p.output_count < 1 || p.output_count > MAX_OUTPUT_COUNT {
        return Err(AppError::validation(format!("Output count must be between 1 and {MAX_OUTPUT_COUNT}.")));
    }
    if p.output_count > model.max_outputs {
        return Err(AppError::validation(format!(
            "{} can make at most {} image(s) per request.",
            model.label, model.max_outputs
        )));
    }
    let mut seen = std::collections::HashSet::new();
    if let Some(dup) = refs.iter().find(|id| !seen.insert(id.as_str())) {
        return Err(AppError::validation(format!("Reference '{dup}' is listed more than once.")));
    }
    if !refs.is_empty() && !model.image_to_image {
        return Err(AppError::validation(format!("{} does not accept reference images.", model.label)));
    }
    if refs.is_empty() && !model.text_to_image {
        return Err(AppError::validation(format!("{} needs at least one reference image.", model.label)));
    }
    if refs.len() > model.max_reference_images as usize {
        return Err(AppError::validation(format!(
            "{} accepts at most {} reference image(s); {} selected.",
            model.label,
            model.max_reference_images,
            refs.len()
        )));
    }
    // An empty list means "the provider decides", so the value must then be null
    // (adapters such as Gemini cannot pass a size the model does not list).
    let offered = |value: &Option<String>, list: &[String]| match value {
        Some(v) => list.contains(v),
        None => true,
    };
    let choices = |list: &[String]| {
        if list.is_empty() {
            "leave it unset; the provider decides".to_string()
        } else {
            format!("use one of: {}", list.join(", "))
        }
    };
    if !offered(&p.aspect_ratio, &model.aspect_ratios) {
        return Err(AppError::validation(format!(
            "{} does not offer aspect ratio '{}'; {}.",
            model.label,
            p.aspect_ratio.as_deref().unwrap_or_default(),
            choices(&model.aspect_ratios)
        )));
    }
    if !offered(&p.image_size, &model.image_sizes) {
        return Err(AppError::validation(format!(
            "{} does not offer image size '{}'; {}.",
            model.label,
            p.image_size.as_deref().unwrap_or_default(),
            choices(&model.image_sizes)
        )));
    }
    if p.seed.is_some() && !model.supports_seed {
        return Err(AppError::validation(format!("{} does not support a fixed seed.", model.label)));
    }
    Ok(())
}

fn missing_reference(a: &AssetRow) -> AppError {
    let name = a.original_name.as_deref().unwrap_or(&a.id);
    AppError::invalid_state(format!(
        "Reference '{name}' has no image file in project storage. Re-import it or remove it from the references."
    ))
    .with_details(json!({ "assetId": a.id }))
}

/// A reference must exist, belong to the project (`NOT_FOUND` otherwise) and be ready with
/// its managed file present (`INVALID_STATE` otherwise). Runs at validation and again in the
/// lock scope of the row insert, so a reference removed in between is never sent.
fn check_reference(core: &AppCore, conn: &Connection, project_id: &str, asset_id: &str) -> AppResult<AssetRow> {
    let asset = match repo::find_asset(conn, asset_id)? {
        Some(a) if a.project_id == project_id => a,
        _ => return Err(AppError::not_found("Reference asset", asset_id)),
    };
    let path = core.storage.resolve(&asset.project_id, &asset.managed_rel_path)?;
    if asset.status != "ready" || !path.is_file() {
        return Err(missing_reference(&asset));
    }
    Ok(asset)
}

fn read_reference(core: &AppCore, a: &AssetRow) -> AppResult<ReferenceImage> {
    let path = core.storage.resolve(&a.project_id, &a.managed_rel_path)?;
    let bytes = fs::read(&path).map_err(|_| missing_reference(a))?;
    let mime_type = a
        .mime_type
        .clone()
        .or_else(|| imaging::detect_format(&bytes).map(|f| f.mime().to_string()))
        .unwrap_or_else(|| "application/octet-stream".into());
    Ok(ReferenceImage { asset_id: a.id.clone(), role: a.role.as_str().to_string(), mime_type, bytes })
}

// ------------------------------------------------------------------ submit

#[cfg(test)]
thread_local! {
    /// Runs between validation and the row insert (no lock held), to race the insert in tests.
    static AFTER_PREPARE: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

pub fn submit(core: &AppCore, req: SubmitRequest) -> AppResult<GenerationDto> {
    let prepared = prepare(core, req)?;
    #[cfg(test)]
    if let Some(hook) = AFTER_PREPARE.with(|h| h.borrow_mut().take()) {
        hook();
    }

    // 1. persist the running row (the project may have been archived since validation)
    let now = now_iso();
    let row = GenerationRow {
        id: new_id(prefix::GENERATION),
        project_id: prepared.project_id.clone(),
        provider_id: prepared.provider.info().id.to_string(),
        model_id: prepared.model.id.clone(),
        purpose: prepared.purpose,
        status: GenerationStatus::Running,
        request_json: serde_json::to_string(&prepared.snapshot)
            .map_err(|e| AppError::new(ErrorCode::DbError, format!("Cannot record the request: {e}")))?,
        parent_asset_id: prepared.parent_asset_id.clone(),
        error_kind: None,
        error_message: None,
        error_retryable: None,
        started_at: now.clone(),
        finished_at: None,
        duration_ms: None,
        created_at: now.clone(),
        updated_at: now,
    };
    {
        let conn = core.conn()?;
        ensure_not_archived(&repo::get_project(&conn, &row.project_id)?)?;
        // References may have been removed or lost their file since validation.
        for id in &prepared.snapshot.reference_asset_ids {
            check_reference(core, &conn, &row.project_id, id)?;
        }
        repo::insert_generation(&conn, &row)?;
    } // DB lock released: the provider call below must never hold it.

    // 2. provider call
    let clock = Instant::now();
    let request = ProviderRequest {
        model_id: prepared.model.id.clone(),
        prompt: PromptText {
            positive: prepared.snapshot.prompt.positive_prompt.clone(),
            negative: prepared.snapshot.prompt.negative_prompt.clone(),
            reference_instructions: prepared.snapshot.prompt.reference_instructions.clone(),
            preservation_instructions: prepared.snapshot.prompt.preservation_instructions.clone(),
        },
        references: prepared.references.clone(),
        params: prepared.snapshot.params.clone(),
        api_key: prepared.api_key.clone(),
    };
    let result = prepared.provider.generate(&request);
    drop(request);

    // 3. store outputs, or record the failure
    let failure = match result {
        Err(e) => Failure::new(e.kind.as_str(), e.message, e.kind.retryable()),
        Ok(output) => match store_outputs(core, &prepared, &row, output, &clock) {
            Ok(()) => return get(core, &row.project_id, &row.id),
            Err(f) => f,
        },
    };
    {
        let conn = core.conn()?;
        repo::finish_generation(
            &conn,
            &row.id,
            GenerationStatus::Failed,
            Some(&failure.0),
            &now_iso(),
            elapsed_ms(&clock),
        )?;
    }
    get(core, &row.project_id, &row.id)
}

fn elapsed_ms(clock: &Instant) -> i64 {
    i64::try_from(clock.elapsed().as_millis()).unwrap_or(i64::MAX)
}

/// Fully decode every image, write the files, then commit all rows in one transaction.
/// On any failure no asset row survives and every written file is removed.
fn store_outputs(
    core: &AppCore,
    prepared: &Prepared,
    generation: &GenerationRow,
    output: ProviderOutput,
    clock: &Instant,
) -> Result<(), Failure> {
    if output.images.is_empty() {
        return Err(Failure::new("bad_response", "The provider returned no image.", true));
    }
    // A provider that returns more than asked for: keep the requested count only.
    let images: Vec<_> = output.images.into_iter().take(prepared.snapshot.params.output_count as usize).collect();
    // Header inspection alone accepts a PNG with corrupt pixel data; decoding proves it opens.
    let checked = images
        .iter()
        .enumerate()
        .map(|(i, img)| {
            let unreadable = || {
                Failure::new(
                    "bad_response",
                    format!("The provider returned output {} that is not a readable JPEG, PNG or WebP image.", i + 1),
                    true,
                )
            };
            let info = imaging::inspect(&img.bytes, &format!("output {}", i + 1)).map_err(|_| unreadable())?;
            let decoded = imaging::decode(&img.bytes, info.format).map_err(|_| unreadable())?;
            Ok((info, decoded))
        })
        .collect::<Result<Vec<_>, Failure>>()?;

    let mut stored: Vec<StoredImage> = Vec::new();
    let cleanup = |stored: &[StoredImage]| {
        for s in stored {
            s.remove_files();
        }
    };
    for (img, (info, decoded)) in images.iter().zip(&checked) {
        let asset_id = new_id(prefix::ASSET);
        match store_managed_image(
            &core.storage,
            &generation.project_id,
            &asset_id,
            &img.bytes,
            info,
            Thumbnail::Required(decoded),
        ) {
            Ok(s) => stored.push(s),
            Err(e) => {
                cleanup(&stored);
                return Err(e.into());
            }
        }
    }

    let inspected: Vec<&Inspection> = checked.iter().map(|(info, _)| info).collect();
    let result = commit_outputs(core, prepared, generation, &stored, &inspected, clock);
    if result.is_err() {
        cleanup(&stored);
    }
    result
}

fn commit_outputs(
    core: &AppCore,
    prepared: &Prepared,
    generation: &GenerationRow,
    stored: &[StoredImage],
    inspected: &[&Inspection],
    clock: &Instant,
) -> Result<(), Failure> {
    let mut conn = core.conn()?;
    let tx = conn.transaction().map_err(AppError::from)?;
    let project = repo::get_project(&tx, &generation.project_id)?;
    if project.archived_at.is_some() {
        return Err(Failure::new(
            "interrupted",
            format!("'{}' was archived while the image was generating, so the results were discarded.", project.name),
            false,
        ));
    }
    // The parent may have been removed during the call; the FK would reject a dangling id.
    let parent_asset_id = match &prepared.parent_asset_id {
        Some(id) if repo::find_asset(&tx, id)?.is_some() => Some(id.clone()),
        _ => None,
    };
    let parent_version_id = match &parent_asset_id {
        Some(id) => repo::latest_version_id(&tx, id)?,
        None => None,
    };
    let now = now_iso();
    for (index, (files, info)) in stored.iter().zip(inspected).enumerate() {
        let asset_id = &files.asset_id;
        let index = index as u32;
        let name = format!("{} {} — {}", prepared.purpose.label(), index + 1, prepared.model.label);
        let operation_json = json!({
            "generationId": generation.id,
            "providerId": generation.provider_id,
            "modelId": generation.model_id,
            "outputIndex": index,
        })
        .to_string();
        repo::insert_asset(
            &tx,
            &AssetRow {
                id: asset_id.clone(),
                project_id: generation.project_id.clone(),
                source: AssetSource::AiGenerated,
                role: AssetRole::RegularImage,
                status: "ready".into(),
                original_name: Some(name.clone()),
                managed_rel_path: files.managed_rel.clone(),
                thumbnail_rel_path: files.thumbnail_rel.clone(),
                mime_type: Some(info.format.mime().into()),
                file_size_bytes: Some(info.size_bytes as i64),
                width_px: Some(info.width as i64),
                height_px: Some(info.height as i64),
                sha256: Some(info.sha256.clone()),
                parent_asset_id: parent_asset_id.clone(),
                operation: Some("generate".into()),
                operation_json: Some(operation_json.clone()),
                created_at: now.clone(),
                updated_at: now.clone(),
            },
        )?;
        repo::insert_version(
            &tx,
            &VersionRow {
                id: new_id(prefix::VERSION),
                project_id: generation.project_id.clone(),
                asset_id: asset_id.clone(),
                parent_version_id: parent_version_id.clone(),
                label: Some(name),
                operation: "generate".into(),
                operation_json: Some(operation_json),
                generation_id: Some(generation.id.clone()),
                created_at: now.clone(),
            },
        )?;
        repo::insert_generation_output(&tx, &generation.id, index, asset_id)?;
    }
    repo::finish_generation(&tx, &generation.id, GenerationStatus::Completed, None, &now, elapsed_ms(clock))?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

// ------------------------------------------------------------------ read

fn to_dto(conn: &Connection, row: GenerationRow) -> AppResult<GenerationDto> {
    let snapshot: RequestSnapshot = serde_json::from_str(&row.request_json).map_err(|e| {
        AppError::new(ErrorCode::DbError, format!("Stored request of generation '{}' is not valid: {e}", row.id))
    })?;
    let output_asset_ids = repo::list_generation_outputs(conn, &row.id)?;
    let error = row.error_kind.map(|kind| GenerationErrorDto {
        kind,
        message: row.error_message.unwrap_or_default(),
        retryable: row.error_retryable.unwrap_or(false),
    });
    Ok(GenerationDto {
        id: row.id,
        project_id: row.project_id,
        provider_id: row.provider_id,
        model_id: row.model_id,
        purpose: row.purpose,
        status: row.status,
        prompt: snapshot.prompt,
        reference_asset_ids: snapshot.reference_asset_ids,
        params: snapshot.params,
        parent_asset_id: row.parent_asset_id,
        output_asset_ids,
        error,
        started_at: row.started_at,
        finished_at: row.finished_at,
        duration_ms: row.duration_ms,
    })
}

/// Newest first.
pub fn list(core: &AppCore, project_id: &str) -> AppResult<Vec<GenerationDto>> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    repo::list_generations(&conn, project_id)?.into_iter().map(|row| to_dto(&conn, row)).collect()
}

pub fn get(core: &AppCore, project_id: &str, generation_id: &str) -> AppResult<GenerationDto> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    match repo::find_generation(&conn, generation_id)? {
        Some(row) if row.project_id == project_id => to_dto(&conn, row),
        _ => Err(AppError::not_found("Generation", generation_id)),
    }
}

/// Startup recovery (ADR-014): a row still `running` means the app died mid-call.
pub fn recover_interrupted(conn: &Connection) -> AppResult<usize> {
    repo::interrupt_running_generations(conn, INTERRUPTED_MESSAGE, &now_iso())
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Arc;

    use serde_json::{json, Value};

    use super::*;
    use crate::dto::AssetDto;
    use crate::providers::local_preview;
    use crate::providers::ProviderErrorKind;
    use crate::services::assets::{self, ImportRequest};
    use crate::services::projects;
    use crate::services::provider_settings;
    use crate::services::tests_support::{
        core_with_double, open_test_core, test_create_villa, write_png, TestBehavior, TEST_PROVIDER,
    };

    fn bundle(positive: &str) -> PromptBundle {
        let metadata = json!({ "moduleId": "generate", "dnaVersion": 1 });
        PromptBundle {
            compiler_version: "1.0.0".into(),
            positive_prompt: positive.into(),
            negative_prompt: "blurry".into(),
            reference_instructions: "Image 1 is the master.".into(),
            preservation_instructions: "Keep the massing.".into(),
            metadata: metadata.as_object().unwrap().clone(),
        }
    }

    fn params(count: u32) -> GenerationParams {
        GenerationParams { aspect_ratio: None, image_size: None, output_count: count, seed: None }
    }

    fn request(
        project_id: &str,
        provider: &str,
        model: &str,
        refs: &[&str],
        params: GenerationParams,
    ) -> SubmitRequest {
        SubmitRequest {
            project_id: project_id.into(),
            provider_id: provider.into(),
            model_id: model.into(),
            purpose: "hero".into(),
            prompt: bundle("Tropical villa at dusk"),
            reference_asset_ids: refs.iter().map(|s| s.to_string()).collect(),
            params,
        }
    }

    fn local(project_id: &str, refs: &[&str], count: u32) -> SubmitRequest {
        request(project_id, local_preview::ID, local_preview::MODEL_ID, refs, params(count))
    }

    fn import(core: &AppCore, dir: &Path, project_id: &str, name: &str, role: &str, rgb: [u8; 3]) -> AssetDto {
        assets::import(
            core,
            ImportRequest {
                project_id: project_id.into(),
                source_path: write_png(dir, name, 32, 24, rgb).to_string_lossy().into_owned(),
                source: "external".into(),
                role: role.into(),
                allow_duplicate: false,
            },
        )
        .unwrap()
    }

    fn count(core: &AppCore, table: &str) -> i64 {
        core.conn().unwrap().query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    fn set_key(core: &AppCore, key: &str) {
        provider_settings::set_api_key(core, TEST_PROVIDER, key).unwrap();
    }

    #[test]
    fn local_preview_submit_creates_assets_versions_outputs_and_lineage() {
        let (tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        let master = import(&core, tmp.path(), &p.id, "m.png", "master_architecture", [200, 0, 0]);
        let material = import(&core, tmp.path(), &p.id, "mat.png", "material_reference", [0, 200, 0]);

        let g = submit(&core, local(&p.id, &[&material.id, &master.id], 2)).unwrap();
        assert_eq!(g.status, GenerationStatus::Completed, "{:?}", g.error);
        assert!(g.id.starts_with("GEN_"));
        assert_eq!(g.purpose, GenerationPurpose::Hero);
        assert_eq!(g.parent_asset_id.as_deref(), Some(master.id.as_str()), "master wins over first reference");
        assert_eq!(g.reference_asset_ids, [material.id.clone(), master.id.clone()], "order kept");
        assert_eq!(g.prompt, bundle("Tropical villa at dusk"));
        assert_eq!(g.output_asset_ids.len(), 2);
        assert!(g.error.is_none() && g.finished_at.is_some() && g.duration_ms.is_some());

        let all = assets::list(&core, &p.id).unwrap();
        let versions = assets::list_versions(&core, &p.id).unwrap();
        let master_version = versions.iter().find(|v| v.asset_id == master.id).unwrap();
        for (i, id) in g.output_asset_ids.iter().enumerate() {
            let a = all.iter().find(|a| &a.id == id).unwrap();
            assert_eq!(a.source, AssetSource::AiGenerated);
            assert_eq!(a.role, AssetRole::RegularImage);
            assert_eq!(a.status, "ready");
            assert_eq!(a.operation.as_deref(), Some("generate"));
            assert_eq!(a.parent_asset_id.as_deref(), Some(master.id.as_str()));
            assert_eq!(a.original_name.as_deref(), Some(format!("Hero {} — Placeholder renderer", i + 1).as_str()));
            assert_eq!((a.width_px, a.height_px), (Some(1024), Some(768)));
            assert!(Path::new(&a.absolute_path).exists() && a.thumbnail_path.is_some());

            let v = versions.iter().find(|v| &v.asset_id == id).unwrap();
            assert_eq!(v.generation_id.as_deref(), Some(g.id.as_str()));
            assert_eq!(v.parent_version_id.as_deref(), Some(master_version.id.as_str()));
            assert_eq!(v.operation, "generate");
            let vjson = serde_json::to_value(v).unwrap();
            assert_eq!(vjson["generationId"], json!(g.id));

            let op: Value = {
                let conn = core.conn().unwrap();
                let text: String =
                    conn.query_row("SELECT operation_json FROM assets WHERE id = ?1", [id], |r| r.get(0)).unwrap();
                serde_json::from_str(&text).unwrap()
            };
            assert_eq!(
                op,
                json!({ "generationId": g.id, "providerId": "local_preview", "modelId": "placeholder-v1", "outputIndex": i })
            );
        }
        assert!(master_version.generation_id.is_none());

        assert_eq!(list(&core, &p.id).unwrap(), vec![g.clone()]);
        assert_eq!(get(&core, &p.id, &g.id).unwrap(), g);
        assert_eq!(get(&core, &p.id, "GEN_nope").unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn text_to_image_has_no_parent_and_same_output_twice_is_allowed() {
        let (_tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        let first = submit(&core, local(&p.id, &[], 1)).unwrap();
        let second = submit(&core, local(&p.id, &[], 1)).unwrap();
        // Deterministic renderer: identical bytes, but generated outputs skip the duplicate-SHA check.
        assert_eq!(second.status, GenerationStatus::Completed);
        assert!(first.parent_asset_id.is_none());
        let versions = assets::list_versions(&core, &p.id).unwrap();
        assert!(versions.iter().all(|v| v.parent_version_id.is_none()));
        let assets = assets::list(&core, &p.id).unwrap();
        assert_eq!(assets[0].sha256, assets[1].sha256);
        assert_eq!(list(&core, &p.id).unwrap()[0].id, second.id, "newest first");
    }

    #[test]
    fn first_reference_is_parent_without_master() {
        let (tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        let a = import(&core, tmp.path(), &p.id, "a.png", "architecture_reference", [1, 2, 3]);
        let b = import(&core, tmp.path(), &p.id, "b.png", "mood_reference", [4, 5, 6]);
        let g = submit(&core, local(&p.id, &[&b.id, &a.id], 1)).unwrap();
        assert_eq!(g.parent_asset_id.as_deref(), Some(b.id.as_str()));
    }

    #[test]
    fn every_validation_rule_rejects_before_any_row_or_call() {
        let (tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        let other = test_create_villa(&core, "B");
        let r1 = import(&core, tmp.path(), &p.id, "1.png", "regular_image", [1, 0, 0]);
        let r2 = import(&core, tmp.path(), &p.id, "2.png", "regular_image", [2, 0, 0]);
        let r3 = import(&core, tmp.path(), &p.id, "3.png", "regular_image", [3, 0, 0]);
        let foreign = import(&core, tmp.path(), &other.id, "4.png", "regular_image", [4, 0, 0]);
        let gone = import(&core, tmp.path(), &p.id, "5.png", "regular_image", [5, 0, 0]);
        std::fs::remove_file(&gone.absolute_path).unwrap();

        let full = |refs: &[&str], params: GenerationParams| request(&p.id, TEST_PROVIDER, "full", refs, params);
        let with = |f: &dyn Fn(&mut GenerationParams)| {
            let mut p = params(1);
            f(&mut p);
            p
        };
        let mut empty_prompt = full(&[], params(1));
        empty_prompt.prompt.positive_prompt = "  \n ".into();
        let mut bad_purpose = full(&[], params(1));
        bad_purpose.purpose = "poster".into();

        use ErrorCode::*;
        let cases: Vec<(&str, SubmitRequest, ErrorCode)> = vec![
            ("empty prompt", empty_prompt, ValidationError),
            ("unknown purpose", bad_purpose, ValidationError),
            ("duplicate refs", full(&[&r1.id, &r1.id], params(1)), ValidationError),
            ("too many refs", full(&[&r1.id, &r2.id, &r3.id], params(1)), ValidationError),
            ("output count above model max", full(&[], params(2 + 1)), ValidationError),
            ("output count zero", full(&[], params(0)), ValidationError),
            ("output count above 4", local(&p.id, &[], 5), ValidationError),
            ("aspect ratio not offered", full(&[], with(&|p| p.aspect_ratio = Some("4:3".into()))), ValidationError),
            ("image size not offered", full(&[], with(&|p| p.image_size = Some("4K".into()))), ValidationError),
            ("seed without support", full(&[], with(&|p| p.seed = Some(1))), ValidationError),
            (
                "image size on a model that lists none",
                request(&p.id, TEST_PROVIDER, "text-only", &[], with(&|p| p.image_size = Some("1K".into()))),
                ValidationError,
            ),
            (
                "aspect ratio on a model that lists none",
                request(&p.id, TEST_PROVIDER, "text-only", &[], with(&|p| p.aspect_ratio = Some("1:1".into()))),
                ValidationError,
            ),
            ("refs on text-only", request(&p.id, TEST_PROVIDER, "text-only", &[&r1.id], params(1)), ValidationError),
            ("no refs on edit-only", request(&p.id, TEST_PROVIDER, "edit-only", &[], params(1)), ValidationError),
            ("unknown project", request("PRJ_nope", TEST_PROVIDER, "full", &[], params(1)), NotFound),
            ("unknown provider", request(&p.id, "nope", "full", &[], params(1)), NotFound),
            ("unknown model", request(&p.id, TEST_PROVIDER, "nope", &[], params(1)), NotFound),
            ("unknown reference", full(&["AST_nope"], params(1)), NotFound),
            ("reference of another project", full(&[&foreign.id], params(1)), NotFound),
            ("reference file missing", full(&[&gone.id], params(1)), InvalidState),
        ];
        for (what, req, code) in cases {
            let err = submit(&core, req).expect_err(what);
            assert_eq!(err.code, code, "{what}: {}", err.message);
        }
        // Offered values pass.
        let ok = full(&[&r1.id], with(&|p| p.aspect_ratio = Some("16:9".into())));
        assert_eq!(submit(&core, ok).unwrap().status, GenerationStatus::Completed);
        assert_eq!(count(&core, "generations"), 1);
        assert_eq!(double.calls(), 1);
    }

    #[test]
    fn archived_project_is_rejected() {
        let (_tmp, core, double) = core_with_double();
        let p = test_create_villa(&core, "A");
        projects::set_archived(&core, &p.id, true).unwrap();
        assert_eq!(submit(&core, local(&p.id, &[], 1)).unwrap_err().code, ErrorCode::InvalidState);
        assert_eq!(count(&core, "generations"), 0);
        assert_eq!(double.calls(), 0);
    }

    #[test]
    fn missing_key_is_provider_not_configured_and_writes_nothing() {
        let (_tmp, core, double) = core_with_double();
        let p = test_create_villa(&core, "A");
        let err = submit(&core, request(&p.id, TEST_PROVIDER, "full", &[], params(1))).unwrap_err();
        assert_eq!(err.code, ErrorCode::ProviderNotConfigured);
        assert_eq!(err.details.unwrap()["providerId"], json!(TEST_PROVIDER));
        assert_eq!(count(&core, "generations"), 0);
        assert_eq!(double.calls(), 0);
    }

    #[test]
    fn provider_errors_become_failed_generations_without_assets() {
        let (_tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        let cases = [
            (TestBehavior::Fail(ProviderErrorKind::RateLimited), "rate_limited", true),
            (TestBehavior::Fail(ProviderErrorKind::Auth), "auth", false),
            (TestBehavior::NotAnImage, "bad_response", true),
            (TestBehavior::NoImages, "bad_response", true),
        ];
        for (behavior, kind, retryable) in cases {
            double.set_behavior(behavior);
            let g = submit(&core, request(&p.id, TEST_PROVIDER, "full", &[], params(1))).unwrap();
            assert_eq!(g.status, GenerationStatus::Failed, "{behavior:?}");
            let e = g.error.unwrap();
            assert_eq!((e.kind.as_str(), e.retryable), (kind, retryable), "{behavior:?}");
            assert!(!e.message.is_empty());
            assert!(g.output_asset_ids.is_empty() && g.finished_at.is_some() && g.duration_ms.is_some());
        }
        assert_eq!(count(&core, "assets"), 0);
        assert_eq!(count(&core, "versions"), 0);
        assert_eq!(list(&core, &p.id).unwrap().len(), 4);
        let originals = core.storage.project_dir(&p.id).join("assets/original");
        assert_eq!(std::fs::read_dir(originals).unwrap().count(), 0, "no stray files");
    }

    #[test]
    fn outputs_and_history_survive_reopen() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        let (pid, g) = {
            let (core, _) = open_test_core(&root);
            let p = test_create_villa(&core, "A");
            let g = submit(&core, local(&p.id, &[], 2)).unwrap();
            (p.id, g)
        };
        let (core, _) = open_test_core(&root);
        assert_eq!(list(&core, &pid).unwrap(), vec![g.clone()]);
        let assets = assets::list(&core, &pid).unwrap();
        assert_eq!(assets.iter().map(|a| a.id.clone()).collect::<Vec<_>>(), g.output_asset_ids);
        assert!(assets.iter().all(|a| a.status == "ready"));
        assert_eq!(assets::list_versions(&core, &pid).unwrap().len(), 2);
    }

    #[test]
    fn running_generation_becomes_interrupted_on_reopen() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        let pid = {
            let (core, double) = open_test_core(&root);
            let p = test_create_villa(&core, "A");
            set_key(&core, "k");
            // Simulate the app dying mid-call: the provider call never returns normally,
            // after the running row was committed.
            double.set_hook(|| panic!("simulated app exit during the provider call"));
            let req = request(&p.id, TEST_PROVIDER, "full", &[], params(1));
            let died = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| submit(&core, req)));
            assert!(died.is_err());
            assert_eq!(list(&core, &p.id).unwrap()[0].status, GenerationStatus::Running);
            p.id
        };
        let (core, _) = open_test_core(&root);
        let gens = list(&core, &pid).unwrap();
        assert_eq!(gens.len(), 1);
        let g = &gens[0];
        assert_eq!(g.status, GenerationStatus::Interrupted);
        let e = g.error.as_ref().unwrap();
        assert_eq!((e.kind.as_str(), e.retryable), ("interrupted", true));
        assert!(g.finished_at.is_none() && g.output_asset_ids.is_empty());
    }

    #[test]
    fn removing_an_output_keeps_the_generation() {
        let (_tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        let g = submit(&core, local(&p.id, &[], 3)).unwrap();
        assets::remove(&core, &p.id, &g.output_asset_ids[1]).unwrap();
        let after = get(&core, &p.id, &g.id).unwrap();
        assert_eq!(after.status, GenerationStatus::Completed);
        assert_eq!(after.output_asset_ids, [g.output_asset_ids[0].clone(), g.output_asset_ids[2].clone()]);
    }

    #[test]
    fn key_reaches_the_adapter_but_never_the_database() {
        let (_tmp, core, double) = core_with_double();
        let key = "SECRET-KEY-do-not-store-42";
        set_key(&core, key);
        let p = test_create_villa(&core, "A");
        let g = submit(&core, request(&p.id, TEST_PROVIDER, "full", &[], params(1))).unwrap();
        assert_eq!(g.status, GenerationStatus::Completed);
        assert_eq!(double.last_request.lock().unwrap().as_ref().unwrap().api_key.as_deref(), Some(key));

        let request_json: String = core
            .conn()
            .unwrap()
            .query_row("SELECT request_json FROM generations WHERE id = ?1", [&g.id], |r| r.get(0))
            .unwrap();
        assert!(!request_json.contains(key));
        let snapshot: Value = serde_json::from_str(&request_json).unwrap();
        let mut keys: Vec<&str> = snapshot.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["params", "prompt", "referenceAssetIds"]);
        assert!(!serde_json::to_string(&g).unwrap().contains(key));

        // Nothing anywhere in the database files either.
        core.conn().unwrap().execute_batch("PRAGMA wal_checkpoint(FULL);").unwrap();
        for entry in std::fs::read_dir(core.storage.root()).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                let bytes = std::fs::read(&path).unwrap();
                assert!(!bytes.windows(key.len()).any(|w| w == key.as_bytes()), "{}", path.display());
            }
        }
    }

    #[test]
    fn db_lock_is_free_during_the_provider_call() {
        let (_tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        let weak = Arc::downgrade(&core);
        let seen = Arc::new(std::sync::Mutex::new(None));
        let seen_in_hook = seen.clone();
        double.set_hook(move || {
            let core = weak.upgrade().unwrap();
            *seen_in_hook.lock().unwrap() = Some(core.db.try_lock().is_ok());
        });
        submit(&core, request(&p.id, TEST_PROVIDER, "full", &[], params(1))).unwrap();
        assert_eq!(*seen.lock().unwrap(), Some(true));
    }

    #[test]
    fn project_archived_during_the_call_fails_without_assets() {
        let (_tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        let weak = Arc::downgrade(&core);
        let pid = p.id.clone();
        double.set_hook(move || {
            projects::set_archived(&weak.upgrade().unwrap(), &pid, true).unwrap();
        });
        let g = submit(&core, request(&p.id, TEST_PROVIDER, "full", &[], params(2))).unwrap();
        assert_eq!(g.status, GenerationStatus::Failed);
        assert_eq!(g.error.unwrap().kind, "interrupted");
        assert_eq!(count(&core, "assets"), 0);
        let originals = core.storage.project_dir(&p.id).join("assets/original");
        assert_eq!(std::fs::read_dir(&originals).unwrap().count(), 0, "written outputs are removed");
        let previews = core.storage.project_dir(&p.id).join("previews");
        assert_eq!(std::fs::read_dir(&previews).unwrap().count(), 0);
    }

    #[test]
    fn generation_dto_json_keys_match_zod_schema() {
        let (_tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        let g = submit(&core, local(&p.id, &[], 1)).unwrap();
        let value = serde_json::to_value(&g).unwrap();
        let keys = |v: &Value| {
            let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
            k.sort_unstable();
            k
        };
        assert_eq!(
            keys(&value),
            [
                "durationMs",
                "error",
                "finishedAt",
                "id",
                "modelId",
                "outputAssetIds",
                "params",
                "parentAssetId",
                "projectId",
                "prompt",
                "providerId",
                "purpose",
                "referenceAssetIds",
                "startedAt",
                "status"
            ]
        );
        assert_eq!(keys(&value["params"]), ["aspectRatio", "imageSize", "outputCount", "seed"]);
        assert_eq!(
            keys(&value["prompt"]),
            [
                "compilerVersion",
                "metadata",
                "negativePrompt",
                "positivePrompt",
                "preservationInstructions",
                "referenceInstructions"
            ]
        );
        assert_eq!((value["purpose"].clone(), value["status"].clone()), (json!("hero"), json!("completed")));
        assert_eq!(value["error"], Value::Null);

        let failed = GenerationErrorDto { kind: "auth".into(), message: "m".into(), retryable: false };
        assert_eq!(keys(&serde_json::to_value(failed).unwrap()), ["kind", "message", "retryable"]);
    }

    #[test]
    fn submit_request_parses_the_zod_shape() {
        let raw = json!({
            "projectId": "PRJ_1", "providerId": "local_preview", "modelId": "placeholder-v1", "purpose": "variation",
            "prompt": { "compilerVersion": "1", "positivePrompt": "p", "negativePrompt": "", "referenceInstructions": "",
                        "preservationInstructions": "", "metadata": {} },
            "referenceAssetIds": ["AST_1"],
            "params": { "aspectRatio": null, "imageSize": "1K", "outputCount": 2, "seed": 42 }
        });
        let req: SubmitRequest = serde_json::from_value(raw).unwrap();
        assert_eq!(req.params.seed, Some(42));
        assert_eq!(req.reference_asset_ids, ["AST_1"]);
    }

    // ------------------------------------------------------------------ review round 1

    fn managed_file_count(core: &AppCore, project_id: &str) -> usize {
        ["assets/original", "previews"]
            .iter()
            .map(|d| std::fs::read_dir(core.storage.project_dir(project_id).join(d)).map(|r| r.count()).unwrap_or(0))
            .sum()
    }

    fn assert_failed_and_clean(core: &AppCore, g: &GenerationDto, kind: &str) {
        assert_eq!(g.status, GenerationStatus::Failed);
        assert_eq!(g.error.as_ref().unwrap().kind, kind, "{:?}", g.error);
        assert!(g.output_asset_ids.is_empty());
        for table in ["assets", "versions", "generation_outputs"] {
            assert_eq!(count(core, table), 0, "{table} must be rolled back");
        }
        assert_eq!(managed_file_count(core, &g.project_id), 0, "no stray files");
    }

    #[test]
    fn header_valid_png_with_corrupt_pixels_is_bad_response() {
        let bytes = crate::services::tests_support::corrupt_pixel_png();
        assert!(imaging::inspect(&bytes, "x").is_ok(), "fixture must pass header inspection");

        let (_tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        double.set_behavior(TestBehavior::CorruptPixels);
        let g = submit(&core, request(&p.id, TEST_PROVIDER, "full", &[], params(1))).unwrap();
        assert_failed_and_clean(&core, &g, "bad_response");
    }

    #[test]
    fn thumbnail_write_failure_fails_the_whole_batch_as_io() {
        let (_tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        assets::faults::FAIL_THUMBNAIL_AT.with(|c| c.set(2));
        let g = submit(&core, local(&p.id, &[], 2)).unwrap();
        assets::faults::FAIL_THUMBNAIL_AT.with(|c| c.set(0));
        assert_failed_and_clean(&core, &g, "io");
    }

    #[test]
    fn original_write_failure_mid_batch_rolls_back_everything() {
        let (_tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        assets::faults::FAIL_ORIGINAL_AT.with(|c| c.set(2));
        let g = submit(&core, local(&p.id, &[], 2)).unwrap();
        assets::faults::FAIL_ORIGINAL_AT.with(|c| c.set(0));
        assert_failed_and_clean(&core, &g, "io");
    }

    #[test]
    fn sql_failure_on_second_output_rolls_back_everything() {
        let (_tmp, core, _) = core_with_double();
        let p = test_create_villa(&core, "A");
        core.conn()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER fail_second_output BEFORE INSERT ON generation_outputs
                 WHEN NEW.output_index = 1 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;",
            )
            .unwrap();
        let g = submit(&core, local(&p.id, &[], 2)).unwrap();
        assert_failed_and_clean(&core, &g, "io");
        assert_eq!(list(&core, &p.id).unwrap().len(), 1, "the failed generation stays in history");
    }

    #[test]
    fn reference_removed_before_insert_is_rejected_without_a_row() {
        for remove_master in [true, false] {
            let (tmp, core, double) = core_with_double();
            set_key(&core, "k");
            let p = test_create_villa(&core, "A");
            let master = import(&core, tmp.path(), &p.id, "m.png", "master_architecture", [9, 9, 9]);
            let other = import(&core, tmp.path(), &p.id, "o.png", "regular_image", [8, 8, 8]);
            let victim = if remove_master { master.id.clone() } else { other.id.clone() };

            let weak = Arc::downgrade(&core);
            let pid = p.id.clone();
            AFTER_PREPARE.with(|h| {
                *h.borrow_mut() = Some(Box::new(move || {
                    assets::remove(&weak.upgrade().unwrap(), &pid, &victim).unwrap();
                }))
            });
            let err =
                submit(&core, request(&p.id, TEST_PROVIDER, "full", &[&master.id, &other.id], params(1))).unwrap_err();
            assert_eq!(err.code, ErrorCode::NotFound, "remove_master={remove_master}: {}", err.message);
            assert_eq!(count(&core, "generations"), 0);
            assert_eq!(double.calls(), 0, "nothing may be sent");
        }
    }

    #[test]
    fn reference_file_lost_before_insert_is_invalid_state() {
        let (tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        let r = import(&core, tmp.path(), &p.id, "r.png", "regular_image", [7, 7, 7]);
        let path = r.absolute_path.clone();
        AFTER_PREPARE.with(|h| *h.borrow_mut() = Some(Box::new(move || std::fs::remove_file(&path).unwrap())));
        let err = submit(&core, request(&p.id, TEST_PROVIDER, "full", &[&r.id], params(1))).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidState);
        assert_eq!(count(&core, "generations"), 0);
        assert_eq!(double.calls(), 0);
    }

    #[test]
    fn empty_capability_lists_require_null_values() {
        // API_CONTRACTS §9 (main 8a06735): an empty aspectRatios/imageSizes list means
        // "provider decides", so a value must be null.
        let (_tmp, core, double) = core_with_double();
        set_key(&core, "k");
        let p = test_create_villa(&core, "A");
        let text_only = |f: &dyn Fn(&mut GenerationParams)| {
            let mut params = params(1);
            f(&mut params);
            request(&p.id, TEST_PROVIDER, "text-only", &[], params)
        };
        for req in
            [text_only(&|p| p.image_size = Some("1K".into())), text_only(&|p| p.aspect_ratio = Some("1:1".into()))]
        {
            assert_eq!(submit(&core, req).unwrap_err().code, ErrorCode::ValidationError);
        }
        assert_eq!(double.calls(), 0);
        let ok = submit(&core, text_only(&|_| {})).unwrap();
        assert_eq!(ok.status, GenerationStatus::Completed);
    }

    #[test]
    fn three_outputs_list_in_output_order() {
        // Outputs share one created_at; listing must still follow output order every run.
        for _ in 0..5 {
            let (_tmp, core, _) = core_with_double();
            let p = test_create_villa(&core, "A");
            let g = submit(&core, local(&p.id, &[], 3)).unwrap();
            let names: Vec<String> =
                assets::list(&core, &p.id).unwrap().into_iter().map(|a| a.original_name.unwrap()).collect();
            assert_eq!(
                names,
                ["Hero 1 — Placeholder renderer", "Hero 2 — Placeholder renderer", "Hero 3 — Placeholder renderer"]
            );
            let asset_ids: Vec<String> = assets::list(&core, &p.id).unwrap().into_iter().map(|a| a.id).collect();
            assert_eq!(asset_ids, g.output_asset_ids);
            let version_assets: Vec<String> =
                assets::list_versions(&core, &p.id).unwrap().into_iter().map(|v| v.asset_id).collect();
            assert_eq!(version_assets, g.output_asset_ids);
        }
    }
}
