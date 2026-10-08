//! Shapes returned to the UI. Mirrors `packages/domain/src/schemas/dto.ts` (camelCase).

use serde::Serialize;
use serde_json::Value;

use crate::domain::{AssetRole, AssetSource, ProjectStatus, ProjectType};

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
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRemoveResult {
    pub asset_id: String,
    /// Set when the DB record was removed but a managed file could not be deleted.
    pub file_cleanup_warning: Option<String>,
}
