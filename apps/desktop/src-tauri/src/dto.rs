//! Shapes returned to the UI. Mirrors `packages/domain/src/schemas/dto.ts` and
//! `generation.ts` and `jobs.ts` (camelCase).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::domain::{
    AssetRole, AssetSource, GenerationPurpose, GenerationStatus, JobStatus, ProjectStatus, ProjectType,
};
use crate::providers::{GenerationParams, ModelCapabilities, ProviderKind};
use crate::secrets::KeySource;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: String,
    pub name: String,
    pub project_type: ProjectType,
    pub subtype: Option<String>,
    pub status: ProjectStatus,
    pub active_master_asset_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryDto {
    #[serde(flatten)]
    pub project: ProjectDto,
    pub asset_count: i64,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetDto {
    pub id: String,
    pub project_id: String,
    pub source: AssetSource,
    pub role: AssetRole,
    /// `ready` or `missing_file` (computed on read; DB rows are never auto-deleted).
    pub status: String,
    pub original_name: Option<String>,
    pub managed_rel_path: String,
    pub absolute_path: String,
    pub thumbnail_path: Option<String>,
    pub mime_type: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub width_px: Option<i64>,
    pub height_px: Option<i64>,
    pub sha256: Option<String>,
    pub parent_asset_id: Option<String>,
    pub operation: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBundleDto {
    pub project: ProjectDto,
    pub dna: Value,
    pub assets: Vec<AssetDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionDto {
    pub id: String,
    pub project_id: String,
    pub asset_id: String,
    pub parent_version_id: Option<String>,
    pub label: Option<String>,
    pub operation: String,
    /// The generation that produced this version, if any.
    pub generation_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRemoveResult {
    pub asset_id: String,
    /// Set when the DB record was removed but a managed file could not be deleted.
    pub file_cleanup_warning: Option<String>,
}

// ------------------------------------------------------------------ Phase 2: providers + generation

/// Mirrors `PromptBundleSchema` (`packages/domain/src/schemas/prompt.ts`). Compiled by the UI
/// and stored verbatim in the generation request snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptBundle {
    pub compiler_version: String,
    pub positive_prompt: String,
    pub negative_prompt: String,
    pub reference_instructions: String,
    pub preservation_instructions: String,
    pub metadata: Map<String, Value>,
}

/// Mirrors `ProviderDescriptorDTOSchema`. Never carries the key itself.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptorDto {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub requires_api_key: bool,
    pub configured: bool,
    pub key_source: Option<KeySource>,
    pub models: Vec<ModelCapabilities>,
}

/// Mirrors `ProviderTestResultSchema`; `ok: false` is a normal answer, not an error.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestResult {
    pub ok: bool,
    pub message: String,
}

/// Mirrors `GenerationErrorSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationErrorDto {
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

/// Mirrors `GenerationDTOSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationDto {
    pub id: String,
    pub project_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: GenerationPurpose,
    pub status: GenerationStatus,
    pub prompt: PromptBundle,
    pub reference_asset_ids: Vec<String>,
    pub params: GenerationParams,
    pub parent_asset_id: Option<String>,
    /// Output assets still present in the project, in output order.
    pub output_asset_ids: Vec<String>,
    pub error: Option<GenerationErrorDto>,
    pub camera_id: Option<String>,
    pub batch_id: Option<String>,
    /// The queue job that runs this generation (`None` for Phase 2 history).
    pub job_id: Option<String>,
    /// Time the generation was queued.
    pub created_at: String,
    /// When the provider call of the latest attempt began; `None` while queued.
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
}

// ------------------------------------------------------------------ Phase 3: jobs, batches, anchors

/// Mirrors `JobDTOSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobDto {
    pub id: String,
    pub project_id: String,
    pub batch_id: Option<String>,
    pub generation_id: String,
    pub camera_id: Option<String>,
    pub provider_id: String,
    pub model_id: String,
    pub label: String,
    pub status: JobStatus,
    pub priority: i64,
    /// Attempts started so far.
    pub attempt: i64,
    pub max_attempts: i64,
    pub next_attempt_at: Option<String>,
    /// Last attempt's error (also set while `retrying`).
    pub error: Option<GenerationErrorDto>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}

/// Mirrors `JobCountsSchema`: one count per job status, always all keys.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JobCounts {
    pub queued: u32,
    pub running: u32,
    pub retrying: u32,
    pub completed: u32,
    pub failed: u32,
    pub cancelled: u32,
    pub interrupted: u32,
}

impl JobCounts {
    pub fn add(&mut self, status: JobStatus) {
        let slot = match status {
            JobStatus::Queued => &mut self.queued,
            JobStatus::Running => &mut self.running,
            JobStatus::Retrying => &mut self.retrying,
            JobStatus::Completed => &mut self.completed,
            JobStatus::Failed => &mut self.failed,
            JobStatus::Cancelled => &mut self.cancelled,
            JobStatus::Interrupted => &mut self.interrupted,
        };
        *slot += 1;
    }
}

/// Mirrors `BatchDTOSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BatchDto {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: GenerationPurpose,
    pub created_at: String,
    /// In item order.
    pub job_ids: Vec<String>,
    pub counts: JobCounts,
}

/// Mirrors `CameraAnchorDTOSchema`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraAnchorDto {
    pub project_id: String,
    pub camera_id: String,
    pub asset_id: String,
    pub approved_at: String,
}

// ------------------------------------------------------------------ Phase 4B: guided workflow

/// Persisted state for one of the five DNA workflow steps.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStepStateDto {
    pub step_id: String,
    pub status: String,
    pub confirmed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDto {
    pub steps: Vec<WorkflowStepStateDto>,
}
