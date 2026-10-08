//! Camera anchors (ADR-016): the approved image of one anchor-view camera.
//!
//! Cameras live in the DNA; anchors are backend facts in `camera_anchors` (one per camera,
//! FK cascade on the asset). Setting or clearing an anchor recomputes the project status.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::dto::CameraAnchorDto;
use crate::error::{AppError, AppResult};
use crate::repositories::{self as repo, AnchorRow};
use crate::services::{ensure_not_archived, status, AppCore};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorSetRequest {
    pub project_id: String,
    pub camera_id: String,
    pub asset_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorClearRequest {
    pub project_id: String,
    pub camera_id: String,
}

fn to_dto(a: AnchorRow) -> CameraAnchorDto {
    CameraAnchorDto {
        project_id: a.project_id,
        camera_id: a.camera_id,
        asset_id: a.asset_id,
        approved_at: a.approved_at,
    }
}

fn list_in(conn: &rusqlite::Connection, project_id: &str) -> AppResult<Vec<CameraAnchorDto>> {
    Ok(repo::list_anchors(conn, project_id)?.into_iter().map(to_dto).collect())
}

pub fn list(core: &AppCore, project_id: &str) -> AppResult<Vec<CameraAnchorDto>> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    list_in(&conn, project_id)
}

/// Approve `asset_id` as the anchor of `camera_id` (replacing any previous anchor).
/// The camera must be an anchor view in the DNA; the asset must be a ready image of the
/// same project.
pub fn set(core: &AppCore, req: AnchorSetRequest) -> AppResult<Vec<CameraAnchorDto>> {
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repo::get_project(&tx, &req.project_id)?;
    ensure_not_archived(&project)?;
    let dna = repo::get_dna(&tx, &project.id)?;
    check_anchor_view(&dna, &req.camera_id)?;

    let asset = repo::find_asset(&tx, &req.asset_id)?.ok_or_else(|| AppError::not_found("Asset", &req.asset_id))?;
    if asset.project_id != project.id {
        return Err(AppError::validation("That asset belongs to a different project."));
    }
    let file = core.storage.resolve(&asset.project_id, &asset.managed_rel_path)?;
    if asset.status != "ready" || !file.is_file() {
        let name = asset.original_name.as_deref().unwrap_or(&asset.id);
        return Err(AppError::invalid_state(format!(
            "'{name}' has no image file in project storage, so it cannot be an anchor."
        ))
        .with_details(json!({ "assetId": asset.id })));
    }

    let now = core.now_iso();
    repo::upsert_anchor(
        &tx,
        &AnchorRow {
            project_id: project.id.clone(),
            camera_id: req.camera_id.clone(),
            asset_id: asset.id,
            approved_at: now.clone(),
        },
    )?;
    status::save_with_status(&tx, project, &now)?;
    let anchors = list_in(&tx, &req.project_id)?;
    tx.commit()?;
    Ok(anchors)
}

/// Remove the anchor of a camera (a camera without one is not an error).
pub fn clear(core: &AppCore, req: AnchorClearRequest) -> AppResult<Vec<CameraAnchorDto>> {
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repo::get_project(&tx, &req.project_id)?;
    ensure_not_archived(&project)?;
    repo::delete_anchor(&tx, &project.id, &req.camera_id)?;
    status::save_with_status(&tx, project, &core.now_iso())?;
    let anchors = list_in(&tx, &req.project_id)?;
    tx.commit()?;
    Ok(anchors)
}

fn check_anchor_view(dna: &Value, camera_id: &str) -> AppResult<()> {
    if !status::camera_ids(dna).iter().any(|id| id == camera_id) {
        return Err(AppError::not_found("Camera", camera_id));
    }
    if !status::anchor_view_ids(dna).iter().any(|id| id == camera_id) {
        return Err(AppError::validation(
            "Only anchor-view cameras can have an anchor. Mark the camera as an anchor view first.",
        )
        .with_details(json!({ "cameraId": camera_id })));
    }
    Ok(())
}

/// Called by `dna_update` inside its transaction: anchors of cameras that no longer exist
/// are dropped (ADR-016). Anchors of cameras that are no longer anchor views are kept, so
/// re-flagging a camera restores its anchor; status derivation ignores them meanwhile.
pub(crate) fn drop_removed_cameras(conn: &rusqlite::Connection, project_id: &str, dna: &Value) -> AppResult<usize> {
    let cameras = status::camera_ids(dna);
    let mut dropped = 0;
    for anchor in repo::list_anchors(conn, project_id)? {
        if !cameras.contains(&anchor.camera_id) {
            repo::delete_anchor(conn, project_id, &anchor.camera_id)?;
            dropped += 1;
        }
    }
    Ok(dropped)
}
