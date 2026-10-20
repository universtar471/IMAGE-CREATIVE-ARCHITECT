//! Tauri command bridge. Thin: deserialize, run the use case off the UI thread, return
//! `Result<T, AppError>` so the frontend always receives a typed error.

use std::sync::Arc;

use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;
use tauri::State;

use crate::dto::{
    AssetDto, AssetRemoveResult, BatchDto, CameraAnchorDto, GenerationDto, JobDto, ProjectBundleDto, ProjectDto,
    ProjectSummaryDto, ProviderDescriptorDto, ProviderTestResult, ShotValidationSnapshot, VersionDto,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::services::regions::{RegionDto, RegionInput};
use crate::services::{
    anchors, assets, batches, diagram, dna, dna_assist, generations, grade, luts, projects, prompt_enhance,
    provider_settings, publications, queue, regions, sketchup_inbox, user_presets, workflow, AppCore,
};

type Core<'a> = State<'a, Arc<AppCore>>;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutPathRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutSourceRequest {
    source_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutFavoriteRequest {
    lut_id: String,
    favorite: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LutPreviewRequest {
    lut_id: String,
    asset_id: String,
    size: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradePreviewRequest {
    project_id: String,
    asset_id: String,
    grade: grade::ColorGrade,
    size: Option<u32>,
}

#[tauri::command]
pub async fn lut_source_add(core: Core<'_>, request: LutPathRequest) -> AppResult<luts::ScanResult> {
    blocking(&core, move |core| luts::add(core, &request.path)).await
}

#[tauri::command]
pub async fn lut_source_list(core: Core<'_>) -> AppResult<Vec<luts::LutSource>> {
    blocking(&core, luts::list_sources).await
}

#[tauri::command]
pub async fn lut_source_remove(core: Core<'_>, request: LutSourceRequest) -> AppResult<()> {
    blocking(&core, move |core| luts::remove(core, &request.source_id)).await
}

#[tauri::command]
pub async fn lut_source_rescan(core: Core<'_>, request: LutSourceRequest) -> AppResult<luts::ScanResult> {
    blocking(&core, move |core| luts::rescan(core, &request.source_id)).await
}

#[tauri::command]
pub async fn lut_list(core: Core<'_>, request: luts::ListRequest) -> AppResult<luts::ListResult> {
    blocking(&core, move |core| luts::list(core, request)).await
}

#[tauri::command]
pub async fn lut_set_favorite(core: Core<'_>, request: LutFavoriteRequest) -> AppResult<()> {
    blocking(&core, move |core| luts::set_favorite(core, &request.lut_id, request.favorite)).await
}

#[tauri::command]
pub async fn lut_preview(core: Core<'_>, request: LutPreviewRequest) -> AppResult<tauri::ipc::Response> {
    let bytes =
        blocking(&core, move |core| luts::preview(core, &request.lut_id, &request.asset_id, request.size)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn grade_preview(core: Core<'_>, request: GradePreviewRequest) -> AppResult<tauri::ipc::Response> {
    let bytes = blocking(&core, move |core| {
        luts::grade_preview(core, &request.project_id, &request.asset_id, &request.grade, request.size)
    })
    .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionListRequest {
    project_id: String,
    asset_id: String,
}

#[tauri::command]
pub async fn region_list(core: Core<'_>, request: RegionListRequest) -> AppResult<Vec<RegionDto>> {
    blocking(&core, move |c| regions::list(c, &request.project_id, &request.asset_id)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionSaveRequest {
    project_id: String,
    asset_id: String,
    region: RegionInput,
}

#[tauri::command]
pub async fn region_save(core: Core<'_>, request: RegionSaveRequest) -> AppResult<RegionDto> {
    blocking(&core, move |c| regions::save(c, &request.project_id, &request.asset_id, request.region)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionDeleteRequest {
    project_id: String,
    region_id: String,
}

#[tauri::command]
pub async fn region_delete(core: Core<'_>, request: RegionDeleteRequest) -> AppResult<Value> {
    blocking(&core, move |c| {
        regions::delete(c, &request.project_id, &request.region_id).map(|_| serde_json::json!({"deleted": true}))
    })
    .await
}

// ------------------------------------------------------------------ publications (ADR-038)

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicationRef {
    project_id: String,
    publication_id: String,
}

#[tauri::command]
pub async fn publication_list(
    core: Core<'_>,
    request: ProjectRef,
) -> AppResult<Vec<publications::PublicationSummaryDto>> {
    blocking(&core, move |c| publications::list(c, &request.project_id)).await
}

#[tauri::command]
pub async fn publication_get(core: Core<'_>, request: PublicationRef) -> AppResult<publications::PublicationRecordDto> {
    blocking(&core, move |c| publications::get(c, &request.project_id, &request.publication_id)).await
}

#[tauri::command]
pub async fn publication_save(
    core: Core<'_>,
    request: publications::SaveRequest,
) -> AppResult<publications::PublicationRecordDto> {
    blocking(&core, move |c| publications::save(c, request)).await
}

#[tauri::command]
pub async fn publication_delete(core: Core<'_>, request: PublicationRef) -> AppResult<Value> {
    blocking(&core, move |c| {
        publications::delete(c, &request.project_id, &request.publication_id)
            .map(|_| serde_json::json!({"deleted": true}))
    })
    .await
}

#[tauri::command]
pub async fn publication_caption_draft(
    core: Core<'_>,
    request: publications::CaptionDraftRequest,
) -> AppResult<publications::CaptionDraftResult> {
    blocking(&core, move |c| publications::caption_draft(c, request)).await
}

/// Writes webview-rendered export files (SRS P5b). The files are checked first; then a
/// native dialog asks where to save (a file for PDF, a folder for page images). The webview
/// never names the path.
#[tauri::command]
pub async fn publication_export_save(
    app: tauri::AppHandle,
    core: Core<'_>,
    request: publications::ExportSaveRequest,
) -> AppResult<publications::ExportSaveResult> {
    use tauri_plugin_dialog::DialogExt;
    blocking(&core, move |c| {
        let files = publications::prepare_export(c, &request)?;
        let base = publications::safe_base_name(&request.base_name);
        let dialog = app.dialog().file();
        let picked = match request.format {
            publications::ExportFormat::Pdf => dialog
                .set_file_name(format!("{base}.pdf"))
                .add_filter("PDF", &["pdf"])
                .blocking_save_file()
                .map(|p| p.into_path().map(publications::ExportTarget::File)),
            _ => dialog.blocking_pick_folder().map(|p| p.into_path().map(publications::ExportTarget::Folder)),
        };
        let Some(target) = picked else {
            return Ok(publications::ExportSaveResult { saved: false, paths: Vec::new() });
        };
        let target = target.map_err(|e| AppError::validation(format!("The chosen location cannot be used: {e}")))?;
        let paths = publications::write_export(&target, request.format, &base, &files)?;
        Ok(publications::ExportSaveResult { saved: true, paths })
    })
    .await
}

fn parse_validation<T: DeserializeOwned>(value: Value) -> AppResult<T> {
    serde_json::from_value(value).map_err(|err| AppError::validation(format!("Invalid request: {err}")))
}

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

// ------------------------------------------------------------------ guided workflow

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepRequest {
    project_id: String,
    step_id: String,
}

#[tauri::command]
pub async fn workflow_get(core: Core<'_>, request: ProjectRef) -> AppResult<crate::dto::WorkflowDto> {
    blocking(&core, move |c| workflow::get(c, &request.project_id)).await
}

#[tauri::command]
pub async fn workflow_confirm_step(core: Core<'_>, request: WorkflowStepRequest) -> AppResult<crate::dto::WorkflowDto> {
    blocking(&core, move |c| workflow::confirm(c, &request.project_id, &request.step_id)).await
}

#[tauri::command]
pub async fn workflow_reopen_step(core: Core<'_>, request: WorkflowStepRequest) -> AppResult<crate::dto::WorkflowDto> {
    blocking(&core, move |c| workflow::reopen(c, &request.project_id, &request.step_id)).await
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

#[tauri::command]
pub async fn grade_apply(core: Core<'_>, request: grade::GradeApplyRequest) -> AppResult<AssetDto> {
    blocking(&core, move |c| grade::apply(c, request)).await
}

#[tauri::command]
pub async fn asset_preview(core: Core<'_>, request: grade::AssetPreviewRequest) -> AppResult<tauri::ipc::Response> {
    let bytes = blocking(&core, move |c| grade::asset_preview(c, request)).await?;
    Ok(tauri::ipc::Response::new(bytes))
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

#[tauri::command]
pub async fn dna_assist(core: Core<'_>, request: dna_assist::AssistRequest) -> AppResult<dna_assist::AssistResult> {
    blocking(&core, move |c| dna_assist::run(c, request)).await
}

// ------------------------------------------------------------------ generation

/// Validates and enqueues one job (ADR-017); returns the `queued` generation at once.
/// Progress arrives as `job://updated` / `generation://updated` events.
#[tauri::command]
pub async fn generation_submit(core: Core<'_>, request: Value) -> AppResult<GenerationDto> {
    let request: generations::SubmitRequest = parse_validation(request)?;
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
pub async fn batch_create(core: Core<'_>, request: Value) -> AppResult<BatchDto> {
    let request: batches::BatchCreateRequest = parse_validation(request)?;
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

/// `job_retry`: the job, plus the desktop gate's fresh verdict for its stored snapshot.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRetryRequest {
    job_id: String,
    #[serde(default)]
    validation: Option<ShotValidationSnapshot>,
}

#[tauri::command]
pub async fn job_retry(core: Core<'_>, request: JobRetryRequest) -> AppResult<JobDto> {
    blocking(&core, move |c| queue::retry_with(c, &request.job_id, request.validation)).await
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

// ------------------------------------------------------------------ diagram (ADR-037)

#[tauri::command]
pub async fn diagram_image_save(core: Core<'_>, request: diagram::ImageSaveRequest) -> AppResult<AssetDto> {
    blocking(&core, move |c| diagram::save_image(c, request)).await
}

#[tauri::command]
pub async fn diagram_ffmpeg_status(core: Core<'_>) -> AppResult<diagram::FfmpegStatus> {
    blocking(&core, |_| Ok(diagram::ffmpeg_status())).await
}

#[tauri::command]
pub async fn diagram_video_export(
    core: Core<'_>,
    request: diagram::VideoExportRequest,
) -> AppResult<diagram::VideoExportResult> {
    blocking(&core, move |c| diagram::export_video(c, request)).await
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

#[cfg(test)]
mod tests {
    use super::parse_validation;
    use crate::error::ErrorCode;

    #[test]
    fn malformed_numeric_request_is_a_validation_error() {
        let err = parse_validation::<i32>(serde_json::json!(40.5)).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
    }
}

// ------------------------------------------------------------------ my presets (ADR-040)

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPresetRef {
    id: String,
}

#[tauri::command]
pub async fn user_preset_list(core: Core<'_>) -> AppResult<Vec<user_presets::UserPresetDto>> {
    blocking(&core, user_presets::list).await
}

#[tauri::command]
pub async fn user_preset_save(
    core: Core<'_>,
    request: user_presets::SaveRequest,
) -> AppResult<user_presets::UserPresetDto> {
    blocking(&core, move |c| user_presets::save(c, request)).await
}

#[tauri::command]
pub async fn user_preset_delete(core: Core<'_>, request: UserPresetRef) -> AppResult<Value> {
    blocking(&core, move |c| user_presets::delete(c, &request.id).map(|_| serde_json::json!({"deleted": true}))).await
}

// ------------------------------------------------------------------ SketchUp inbox (ADR-040)

#[tauri::command]
pub async fn sketchup_inbox_list(core: Core<'_>) -> AppResult<sketchup_inbox::InboxListing> {
    blocking(&core, sketchup_inbox::list).await
}

#[tauri::command]
pub async fn sketchup_inbox_import(
    core: Core<'_>,
    request: sketchup_inbox::InboxImportRequest,
) -> AppResult<sketchup_inbox::InboxImportResult> {
    blocking(&core, move |c| sketchup_inbox::import(c, request)).await
}
