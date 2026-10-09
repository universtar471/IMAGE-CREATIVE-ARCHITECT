//! Tauri command bridge. Thin: deserialize, run the use case off the UI thread, return
//! `Result<T, AppError>` so the frontend always receives a typed error.

use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::dto::{
    AssetDto, AssetRemoveResult, BatchDto, CameraAnchorDto, GenerationDto, JobDto, ProjectBundleDto, ProjectDto,
    ProjectSummaryDto, ProviderDescriptorDto, ProviderTestResult, VersionDto,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::services::{
    anchors, assets, batches, dna, generations, projects, prompt_enhance, provider_settings, queue, AppCore,
};

type Core<'a> = State<'a, Arc<AppCore>>;

async fn blocking<T, F>(core: &Core<'_>, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&AppCore) -> AppResult<T> + Send + 'static,
{
    let core = Arc::clone(core.inner());
    tauri::async_runtime::spawn_blocking(move || f(&core))
        .await
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("Background task failed: {e}")))?
}

// ------------------------------------------------------------------ projects

#[tauri::command]
pub async fn project_create(core: Core<'_>, request: projects::CreateProjectRequest) -> AppResult<ProjectDto> {
    blocking(&core, move |c| projects::create(c, request)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    #[serde(default)]
    include_archived: bool,
}

#[tauri::command]
pub async fn project_list(core: Core<'_>, request: ListRequest) -> AppResult<Vec<ProjectSummaryDto>> {
    blocking(&core, move |c| projects::list(c, request.include_archived)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    project_id: String,
}

#[tauri::command]
pub async fn project_get(core: Core<'_>, request: ProjectRef) -> AppResult<ProjectBundleDto> {
    blocking(&core, move |c| projects::get(c, &request.project_id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadataRequest {
    project_id: String,
    name: Option<String>,
    subtype: Option<String>,
}

#[tauri::command]
pub async fn project_update_metadata(core: Core<'_>, request: UpdateMetadataRequest) -> AppResult<ProjectDto> {
    blocking(&core, move |c| projects::update_metadata(c, &request.project_id, request.name, request.subtype)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetArchivedRequest {
    project_id: String,
    archived: bool,
}

#[tauri::command]
pub async fn project_set_archived(core: Core<'_>, request: SetArchivedRequest) -> AppResult<ProjectDto> {
    blocking(&core, move |c| projects::set_archived(c, &request.project_id, request.archived)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveMasterRequest {
    project_id: String,
    approved: bool,
}

#[tauri::command]
pub async fn project_approve_master(core: Core<'_>, request: ApproveMasterRequest) -> AppResult<ProjectDto> {
    blocking(&core, move |c| projects::approve_master(c, &request.project_id, request.approved)).await
}

// ------------------------------------------------------------------ DNA

#[tauri::command]
pub async fn dna_get(core: Core<'_>, request: ProjectRef) -> AppResult<Value> {
    blocking(&core, move |c| dna::get(c, &request.project_id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DnaUpdateRequest {
    project_id: String,
    dna: Value,
}

#[tauri::command]
pub async fn dna_update(core: Core<'_>, request: DnaUpdateRequest) -> AppResult<ProjectDto> {
    blocking(&core, move |c| dna::update(c, &request.project_id, request.dna)).await
}

// ------------------------------------------------------------------ assets

#[tauri::command]
pub async fn asset_import(core: Core<'_>, request: assets::ImportRequest) -> AppResult<AssetDto> {
    blocking(&core, move |c| assets::import(c, request)).await
}

#[tauri::command]
pub async fn asset_list(core: Core<'_>, request: ProjectRef) -> AppResult<Vec<AssetDto>> {
    blocking(&core, move |c| assets::list(c, &request.project_id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoleRequest {
    project_id: String,
    asset_id: String,
    role: String,
}

#[tauri::command]
pub async fn asset_update_role(core: Core<'_>, request: UpdateRoleRequest) -> AppResult<Vec<AssetDto>> {
    blocking(&core, move |c| assets::update_role(c, &request.project_id, &request.asset_id, &request.role)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetMasterRequest {
    project_id: String,
    asset_id: Option<String>,
}

#[tauri::command]
pub async fn asset_set_master(core: Core<'_>, request: SetMasterRequest) -> AppResult<Vec<AssetDto>> {
    blocking(&core, move |c| assets::set_master(c, &request.project_id, request.asset_id.as_deref())).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRef {
    project_id: String,
    asset_id: String,
}

#[tauri::command]
pub async fn asset_remove(core: Core<'_>, request: AssetRef) -> AppResult<AssetRemoveResult> {
    blocking(&core, move |c| assets::remove(c, &request.project_id, &request.asset_id)).await
}

#[tauri::command]
pub async fn version_list(core: Core<'_>, request: ProjectRef) -> AppResult<Vec<VersionDto>> {
    blocking(&core, move |c| assets::list_versions(c, &request.project_id)).await
}

// ------------------------------------------------------------------ providers

#[tauri::command]
pub async fn provider_list(core: Core<'_>) -> AppResult<Vec<ProviderDescriptorDto>> {
    blocking(&core, |c| Ok(provider_settings::list(c))).await
}

/// No `Debug`: the key must never end up in a log line.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetApiKeyRequest {
    provider_id: String,
    api_key: String,
}

#[tauri::command]
pub async fn provider_set_api_key(core: Core<'_>, request: SetApiKeyRequest) -> AppResult<ProviderDescriptorDto> {
    blocking(&core, move |c| provider_settings::set_api_key(c, &request.provider_id, &request.api_key)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderRef {
    provider_id: String,
}

#[tauri::command]
pub async fn provider_clear_api_key(core: Core<'_>, request: ProviderRef) -> AppResult<ProviderDescriptorDto> {
    blocking(&core, move |c| provider_settings::clear_api_key(c, &request.provider_id)).await
}

#[tauri::command]
pub async fn provider_test(core: Core<'_>, request: ProviderRef) -> AppResult<ProviderTestResult> {
    blocking(&core, move |c| provider_settings::test(c, &request.provider_id)).await
}

/// Rewrites the user's extra prompt with the provider's chat model (`prompt_enhance`).
#[tauri::command]
pub async fn prompt_enhance(
    core: Core<'_>,
    request: prompt_enhance::EnhanceRequest,
) -> AppResult<prompt_enhance::EnhanceResult> {
    blocking(&core, move |c| prompt_enhance::enhance(c, request)).await
}

// ------------------------------------------------------------------ generation

/// Validates and enqueues one job (ADR-017); returns the `queued` generation at once.
/// Progress arrives as `job://updated` / `generation://updated` events.
#[tauri::command]
pub async fn generation_submit(core: Core<'_>, request: generations::SubmitRequest) -> AppResult<GenerationDto> {
    blocking(&core, move |c| generations::submit(c, request)).await
}

#[tauri::command]
pub async fn generation_list(core: Core<'_>, request: ProjectRef) -> AppResult<Vec<GenerationDto>> {
    blocking(&core, move |c| generations::list(c, &request.project_id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationRef {
    project_id: String,
    generation_id: String,
}

#[tauri::command]
pub async fn generation_get(core: Core<'_>, request: GenerationRef) -> AppResult<GenerationDto> {
    blocking(&core, move |c| generations::get(c, &request.project_id, &request.generation_id)).await
}

// ------------------------------------------------------------------ batches, jobs, anchors

#[tauri::command]
pub async fn batch_create(core: Core<'_>, request: batches::BatchCreateRequest) -> AppResult<BatchDto> {
    blocking(&core, move |c| batches::create(c, request)).await
}

#[tauri::command]
pub async fn batch_list(core: Core<'_>, request: ProjectRef) -> AppResult<Vec<BatchDto>> {
    blocking(&core, move |c| batches::list(c, &request.project_id)).await
}

#[tauri::command]
pub async fn job_list(core: Core<'_>, request: queue::JobListRequest) -> AppResult<Vec<JobDto>> {
    blocking(&core, move |c| queue::list(c, request.project_id.as_deref())).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRef {
    job_id: String,
}

#[tauri::command]
pub async fn job_cancel(core: Core<'_>, request: JobRef) -> AppResult<JobDto> {
    blocking(&core, move |c| queue::cancel(c, &request.job_id)).await
}

#[tauri::command]
pub async fn job_retry(core: Core<'_>, request: JobRef) -> AppResult<JobDto> {
    blocking(&core, move |c| queue::retry(c, &request.job_id)).await
}

#[tauri::command]
pub async fn camera_anchor_list(core: Core<'_>, request: ProjectRef) -> AppResult<Vec<CameraAnchorDto>> {
    blocking(&core, move |c| anchors::list(c, &request.project_id)).await
}

#[tauri::command]
pub async fn camera_anchor_set(core: Core<'_>, request: anchors::AnchorSetRequest) -> AppResult<Vec<CameraAnchorDto>> {
    blocking(&core, move |c| anchors::set(c, request)).await
}

#[tauri::command]
pub async fn camera_anchor_clear(
    core: Core<'_>,
    request: anchors::AnchorClearRequest,
) -> AppResult<Vec<CameraAnchorDto>> {
    blocking(&core, move |c| anchors::clear(c, request)).await
}

// ------------------------------------------------------------------ app

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    data_root: String,
    schema_version: i64,
    app_version: String,
}

#[tauri::command]
pub async fn app_info(core: Core<'_>) -> AppResult<AppInfo> {
    blocking(&core, |c| {
        Ok(AppInfo {
            data_root: c.storage.root().to_string_lossy().into_owned(),
            schema_version: crate::db::schema_version(&*c.conn()?)?,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        })
    })
    .await
}
