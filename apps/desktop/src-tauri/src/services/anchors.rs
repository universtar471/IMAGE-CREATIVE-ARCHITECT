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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ProjectStatus;
    use crate::error::ErrorCode;
    use crate::services::tests_support::{
        approve_master_for_generation, core, set_cameras, test_create_villa, test_import, test_request, CAM_A, CAM_B,
        CAM_C, TEST_LOCAL_PROVIDER,
    };
    use crate::services::{assets, generations, projects};

    fn set_req(project_id: &str, camera_id: &str, asset_id: &str) -> AnchorSetRequest {
        AnchorSetRequest { project_id: project_id.into(), camera_id: camera_id.into(), asset_id: asset_id.into() }
    }

    fn clear_req(project_id: &str, camera_id: &str) -> AnchorClearRequest {
        AnchorClearRequest { project_id: project_id.into(), camera_id: camera_id.into() }
    }

    fn status(core: &AppCore, project_id: &str) -> ProjectStatus {
        projects::get(core, project_id).unwrap().project.status
    }

    #[test]
    fn status_moves_through_anchor_generation_to_production() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "Anchored villa");
        test_import(&core, tmp.path(), &p.id, "master.png", "master_architecture");
        projects::approve_master(&core, &p.id, true).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::MasterApproved);

        set_cameras(&core, &p.id, &[(CAM_A, "Front", true), (CAM_B, "Rear", true), (CAM_C, "Detail", false)]);
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration, "camera added to the DNA");

        let a = test_import(&core, tmp.path(), &p.id, "a.png", "regular_image");
        let b = test_import(&core, tmp.path(), &p.id, "bb.png", "regular_image");
        let anchors = set(&core, set_req(&p.id, CAM_A, &a.id)).unwrap();
        assert_eq!(anchors.len(), 1);
        assert_eq!((anchors[0].camera_id.as_str(), anchors[0].asset_id.as_str()), (CAM_A, a.id.as_str()));
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration);
        set(&core, set_req(&p.id, CAM_B, &b.id)).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::Production, "every anchor view anchored");

        // Replacing an anchor keeps one row per camera.
        let anchors = set(&core, set_req(&p.id, CAM_B, &a.id)).unwrap();
        assert_eq!(anchors.len(), 2);
        assert_eq!(list(&core, &p.id).unwrap(), anchors);

        clear(&core, clear_req(&p.id, CAM_B)).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration, "anchor cleared");
        set(&core, set_req(&p.id, CAM_B, &b.id)).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::Production);

        projects::approve_master(&core, &p.id, false).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::MasterPending, "master approval withdrawn");
        projects::approve_master(&core, &p.id, true).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::Production);

        // The DNA camera B stops being an anchor view: A alone is anchored -> still production;
        // the row is kept so re-flagging restores it.
        set_cameras(&core, &p.id, &[(CAM_A, "Front", true), (CAM_B, "Rear", false), (CAM_C, "Detail", true)]);
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration, "C is a new anchor view without anchor");
        assert_eq!(list(&core, &p.id).unwrap().len(), 2);
    }

    #[test]
    fn removing_a_dna_camera_drops_its_anchor() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        test_import(&core, tmp.path(), &p.id, "master.png", "master_architecture");
        projects::approve_master(&core, &p.id, true).unwrap();
        set_cameras(&core, &p.id, &[(CAM_A, "Front", true), (CAM_B, "Rear", true)]);
        let a = test_import(&core, tmp.path(), &p.id, "a.png", "regular_image");
        set(&core, set_req(&p.id, CAM_B, &a.id)).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration);

        set_cameras(&core, &p.id, &[(CAM_A, "Front", true)]);
        assert!(list(&core, &p.id).unwrap().is_empty(), "anchor of the removed camera is gone");
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration);

        // Removing the unanchored camera instead leaves every anchor view anchored.
        set_cameras(&core, &p.id, &[(CAM_A, "Front", true), (CAM_B, "Rear", true)]);
        set(&core, set_req(&p.id, CAM_B, &a.id)).unwrap();
        set_cameras(&core, &p.id, &[(CAM_B, "Rear", true)]);
        assert_eq!(status(&core, &p.id), ProjectStatus::Production);
    }

    #[test]
    fn removing_the_asset_cascades_to_its_anchor() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        test_import(&core, tmp.path(), &p.id, "master.png", "master_architecture");
        projects::approve_master(&core, &p.id, true).unwrap();
        set_cameras(&core, &p.id, &[(CAM_A, "Front", true)]);
        let a = test_import(&core, tmp.path(), &p.id, "a.png", "regular_image");
        set(&core, set_req(&p.id, CAM_A, &a.id)).unwrap();
        assert_eq!(status(&core, &p.id), ProjectStatus::Production);

        assets::remove(&core, &p.id, &a.id).unwrap();
        assert!(list(&core, &p.id).unwrap().is_empty());
        assert_eq!(status(&core, &p.id), ProjectStatus::AnchorGeneration, "status recomputed on removal");
    }

    #[test]
    fn set_validates_camera_and_asset() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let other = test_create_villa(&core, "B");
        set_cameras(&core, &p.id, &[(CAM_A, "Front", true), (CAM_B, "Rear", false)]);
        let mine = test_import(&core, tmp.path(), &p.id, "a.png", "regular_image");
        let foreign = test_import(&core, tmp.path(), &other.id, "f.png", "regular_image");
        let gone = test_import(&core, tmp.path(), &p.id, "gone.png", "regular_image");
        std::fs::remove_file(&gone.absolute_path).unwrap();

        use ErrorCode::*;
        let cases = [
            ("unknown camera", set_req(&p.id, CAM_C, &mine.id), NotFound),
            ("not an anchor view", set_req(&p.id, CAM_B, &mine.id), ValidationError),
            ("unknown asset", set_req(&p.id, CAM_A, "AST_nope"), NotFound),
            ("asset of another project", set_req(&p.id, CAM_A, &foreign.id), ValidationError),
            ("asset file missing", set_req(&p.id, CAM_A, &gone.id), InvalidState),
            ("unknown project", set_req("PRJ_nope", CAM_A, &mine.id), NotFound),
        ];
        for (what, req, code) in cases {
            let err = set(&core, req).expect_err(what);
            assert_eq!(err.code, code, "{what}: {}", err.message);
        }
        assert!(list(&core, &p.id).unwrap().is_empty());
        assert!(clear(&core, clear_req(&p.id, CAM_A)).unwrap().is_empty(), "clearing nothing is fine");

        projects::set_archived(&core, &p.id, true).unwrap();
        assert_eq!(set(&core, set_req(&p.id, CAM_A, &mine.id)).unwrap_err().code, InvalidState);
        assert_eq!(clear(&core, clear_req(&p.id, CAM_A)).unwrap_err().code, InvalidState);
    }

    #[test]
    fn submit_checks_the_camera_and_labels_the_job_with_it() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "A");
        approve_master_for_generation(&core, &p.id);
        set_cameras(&core, &p.id, &[(CAM_A, "Front corner", true)]);
        let err =
            generations::submit(&core, test_request(&p.id, TEST_LOCAL_PROVIDER, "full", &[], Some(CAM_B))).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert_eq!(err.details.unwrap()["cameraId"], serde_json::json!(CAM_B));

        let mut req = test_request(&p.id, TEST_LOCAL_PROVIDER, "full", &[], Some(CAM_A));
        req.purpose = "anchor".into();
        let g = generations::submit(&core, req).unwrap();
        assert_eq!(g.camera_id.as_deref(), Some(CAM_A));
        let job = crate::services::queue::get(&core, g.job_id.as_deref().unwrap()).unwrap();
        assert_eq!(job.label, "Front corner — anchor");
        assert_eq!(job.camera_id.as_deref(), Some(CAM_A));
    }

    #[test]
    fn anchor_dto_json_keys_match_zod_schema() {
        let dto = CameraAnchorDto {
            project_id: "p".into(),
            camera_id: "c".into(),
            asset_id: "a".into(),
            approved_at: "t".into(),
        };
        let value = serde_json::to_value(dto).unwrap();
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["approvedAt", "assetId", "cameraId", "projectId"]);
    }
}
