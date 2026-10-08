//! Project status rules (Phase 1 + ADR-016).
//!
//! Reachable states: draft -> dna_ready -> master_pending -> master_approved ->
//! anchor_generation -> production, plus archived. Status is *derived* from persisted facts
//! (DNA readiness, master asset, approval, anchor-view cameras, camera anchors, archive), so
//! it can never drift into an impossible combination. Every write that changes one of those
//! facts goes through [`save_with_status`].

use rusqlite::Connection;
use serde_json::Value;

use crate::domain::{ProjectStatus, ProjectType};
use crate::error::AppResult;
use crate::repositories::{self as repo, ProjectRow};

/// Minimum DNA for `dna_ready`. Mirrors `dnaReadiness` in
/// `packages/domain/src/invariants/dna.ts`; keep both in sync.
pub fn dna_is_ready(dna: &Value, project_type: ProjectType) -> bool {
    let has_text = |v: Option<&Value>| v.and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty());
    let building = dna.get("building");
    let style = has_text(building.and_then(|b| b.get("architecturalStyle")));
    let floors = project_type == ProjectType::Interior
        || building.and_then(|b| b.get("floors")).and_then(Value::as_i64).is_some();
    let macro_context = has_text(dna.get("context").and_then(|c| c.get("macroContext")));
    style && floors && macro_context
}

/// Anchor views of the DNA and how many of them have an approved anchor.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AnchorProgress {
    pub views: usize,
    pub anchored: usize,
}

/// IDs of the DNA cameras flagged `isAnchorView`, in DNA order.
pub fn anchor_view_ids(dna: &Value) -> Vec<String> {
    dna.get("cameras")
        .and_then(Value::as_array)
        .map(|cams| {
            cams.iter()
                .filter(|c| c.get("isAnchorView").and_then(Value::as_bool) == Some(true))
                .filter_map(|c| c.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// IDs of every DNA camera.
pub fn camera_ids(dna: &Value) -> Vec<String> {
    dna.get("cameras")
        .and_then(Value::as_array)
        .map(|cams| cams.iter().filter_map(|c| c.get("id").and_then(Value::as_str).map(str::to_string)).collect())
        .unwrap_or_default()
}

pub fn anchor_progress(conn: &Connection, project_id: &str, dna: &Value) -> AppResult<AnchorProgress> {
    let views = anchor_view_ids(dna);
    let anchors = repo::list_anchors(conn, project_id)?;
    let anchored = views.iter().filter(|v| anchors.iter().any(|a| &a.camera_id == *v)).count();
    Ok(AnchorProgress { views: views.len(), anchored })
}

pub fn derive(p: &ProjectRow, dna_ready: bool, anchors: AnchorProgress) -> ProjectStatus {
    if p.archived_at.is_some() {
        ProjectStatus::Archived
    } else if p.active_master_asset_id.is_some() && p.master_approved_at.is_some() {
        if anchors.views == 0 {
            ProjectStatus::MasterApproved
        } else if anchors.anchored >= anchors.views {
            ProjectStatus::Production
        } else {
            ProjectStatus::AnchorGeneration
        }
    } else if p.active_master_asset_id.is_some() {
        ProjectStatus::MasterPending
    } else if dna_ready {
        ProjectStatus::DnaReady
    } else {
        ProjectStatus::Draft
    }
}

/// Recompute and persist status for the given (already modified) project row.
pub fn save_with_status(conn: &Connection, mut p: ProjectRow, now: &str) -> AppResult<ProjectRow> {
    let dna = repo::get_dna(conn, &p.id)?;
    let anchors = anchor_progress(conn, &p.id, &dna)?;
    p.status = derive(&p, dna_is_ready(&dna, p.project_type), anchors);
    p.updated_at = now.to_string();
    repo::update_project(conn, &p)?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row() -> ProjectRow {
        ProjectRow {
            id: "PRJ_1".into(),
            name: "x".into(),
            project_type: ProjectType::Villa,
            subtype: None,
            status: ProjectStatus::Draft,
            active_master_asset_id: None,
            master_approved_at: None,
            created_at: String::new(),
            updated_at: String::new(),
            archived_at: None,
        }
    }

    #[test]
    fn readiness_requires_style_floors_and_macro_context() {
        let ready =
            json!({"building": {"architecturalStyle": "Modern", "floors": 2}, "context": {"macroContext": "suburb"}});
        assert!(dna_is_ready(&ready, ProjectType::Villa));
        let no_floors = json!({"building": {"architecturalStyle": "Modern"}, "context": {"macroContext": "suburb"}});
        assert!(!dna_is_ready(&no_floors, ProjectType::Villa));
        assert!(dna_is_ready(&no_floors, ProjectType::Interior), "interiors do not need floors");
        let blank_style =
            json!({"building": {"architecturalStyle": " ", "floors": 1}, "context": {"macroContext": "x"}});
        assert!(!dna_is_ready(&blank_style, ProjectType::Villa));
    }

    const NONE: AnchorProgress = AnchorProgress { views: 0, anchored: 0 };

    #[test]
    fn derive_covers_phase1_states() {
        let none = NONE;
        let mut p = row();
        assert_eq!(derive(&p, false, none), ProjectStatus::Draft);
        assert_eq!(derive(&p, true, none), ProjectStatus::DnaReady);
        p.active_master_asset_id = Some("AST_1".into());
        assert_eq!(derive(&p, false, none), ProjectStatus::MasterPending);
        p.master_approved_at = Some("t".into());
        assert_eq!(derive(&p, false, none), ProjectStatus::MasterApproved);
        p.archived_at = Some("t".into());
        assert_eq!(derive(&p, true, none), ProjectStatus::Archived);
    }

    #[test]
    fn approval_without_master_is_not_approved() {
        let none = NONE;
        let mut p = row();
        p.master_approved_at = Some("t".into());
        assert_eq!(derive(&p, true, none), ProjectStatus::DnaReady);
    }

    #[test]
    fn anchor_views_drive_anchor_generation_and_production() {
        let mut p = row();
        p.active_master_asset_id = Some("AST_1".into());
        let some = |views, anchored| AnchorProgress { views, anchored };
        assert_eq!(derive(&p, true, some(2, 0)), ProjectStatus::MasterPending, "needs approval first");
        p.master_approved_at = Some("t".into());
        assert_eq!(derive(&p, true, NONE), ProjectStatus::MasterApproved, "no anchor view");
        assert_eq!(derive(&p, true, some(2, 0)), ProjectStatus::AnchorGeneration);
        assert_eq!(derive(&p, true, some(2, 1)), ProjectStatus::AnchorGeneration);
        assert_eq!(derive(&p, true, some(2, 2)), ProjectStatus::Production);
        p.archived_at = Some("t".into());
        assert_eq!(derive(&p, true, some(2, 2)), ProjectStatus::Archived);
    }

    #[test]
    fn anchor_view_ids_read_the_dna_flag() {
        let dna = json!({ "cameras": [
            { "id": "CAM_A", "isAnchorView": true },
            { "id": "CAM_B", "isAnchorView": false },
            { "id": "CAM_C" },
            { "id": "CAM_D", "isAnchorView": true }
        ]});
        assert_eq!(anchor_view_ids(&dna), ["CAM_A", "CAM_D"]);
        assert_eq!(camera_ids(&dna), ["CAM_A", "CAM_B", "CAM_C", "CAM_D"]);
        assert!(anchor_view_ids(&json!({})).is_empty());
    }
}
