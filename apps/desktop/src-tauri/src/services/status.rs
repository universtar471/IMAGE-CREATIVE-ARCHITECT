//! Project status rules for Phase 1.
//!
//! Reachable states: draft -> dna_ready -> master_pending -> master_approved, plus archived.
//! Status is *derived* from persisted facts (DNA readiness, master asset, approval, archive),
//! so it can never drift into an impossible combination.

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

pub fn derive(p: &ProjectRow, dna_ready: bool) -> ProjectStatus {
    if p.archived_at.is_some() {
        ProjectStatus::Archived
    } else if p.active_master_asset_id.is_some() && p.master_approved_at.is_some() {
        ProjectStatus::MasterApproved
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
    p.status = derive(&p, dna_is_ready(&dna, p.project_type));
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
        let ready = json!({"building": {"architecturalStyle": "Modern", "floors": 2}, "context": {"macroContext": "suburb"}});
        assert!(dna_is_ready(&ready, ProjectType::Villa));
        let no_floors = json!({"building": {"architecturalStyle": "Modern"}, "context": {"macroContext": "suburb"}});
        assert!(!dna_is_ready(&no_floors, ProjectType::Villa));
        assert!(dna_is_ready(&no_floors, ProjectType::Interior), "interiors do not need floors");
        let blank_style = json!({"building": {"architecturalStyle": " ", "floors": 1}, "context": {"macroContext": "x"}});
        assert!(!dna_is_ready(&blank_style, ProjectType::Villa));
    }

    #[test]
    fn derive_covers_phase1_states() {
        let mut p = row();
        assert_eq!(derive(&p, false), ProjectStatus::Draft);
        assert_eq!(derive(&p, true), ProjectStatus::DnaReady);
        p.active_master_asset_id = Some("AST_1".into());
        assert_eq!(derive(&p, false), ProjectStatus::MasterPending);
        p.master_approved_at = Some("t".into());
        assert_eq!(derive(&p, false), ProjectStatus::MasterApproved);
        p.archived_at = Some("t".into());
        assert_eq!(derive(&p, true), ProjectStatus::Archived);
    }

    #[test]
    fn approval_without_master_is_not_approved() {
        let mut p = row();
        p.master_approved_at = Some("t".into());
        assert_eq!(derive(&p, true), ProjectStatus::DnaReady);
    }
}
