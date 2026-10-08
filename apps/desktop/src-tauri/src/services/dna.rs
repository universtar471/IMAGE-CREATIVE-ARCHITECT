use serde_json::Value;

use crate::dto::ProjectDto;
use crate::error::AppResult;
use crate::repositories as repo;
use crate::services::dna_validation::validate_dna;
use crate::services::projects::to_dto;
use crate::services::{ensure_not_archived, status, AppCore};
use crate::util::now_iso;

pub fn get(core: &AppCore, project_id: &str) -> AppResult<Value> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    repo::get_dna(&conn, project_id)
}

/// Replace the whole DNA aggregate after validation; atomically bumps project timestamp/status.
pub fn update(core: &AppCore, project_id: &str, dna: Value) -> AppResult<ProjectDto> {
    validate_dna(&dna)?;
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repo::get_project(&tx, project_id)?;
    ensure_not_archived(&project)?;
    let now = now_iso();
    repo::update_dna(&tx, project_id, &dna, &now)?;
    let project = status::save_with_status(&tx, project, &now)?;
    tx.commit()?;
    Ok(to_dto(&project))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ProjectStatus;
    use crate::error::ErrorCode;
    use crate::services::projects::set_archived;
    use crate::services::tests_support::test_create_villa;
    use crate::services::tests_support::core;
    use serde_json::json;

    #[test]
    fn update_validates_and_derives_dna_ready() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let mut dna = get(&core, &p.id).unwrap();
        dna["building"]["architecturalStyle"] = json!("Modern tropical");
        dna["building"]["floors"] = json!(2);
        dna["context"]["macroContext"] = json!("villa compound");
        let updated = update(&core, &p.id, dna.clone()).unwrap();
        assert_eq!(updated.status, ProjectStatus::DnaReady);
        assert_eq!(get(&core, &p.id).unwrap(), dna);
    }

    #[test]
    fn invalid_dna_never_persists() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let before = get(&core, &p.id).unwrap();
        let mut bad = before.clone();
        bad["building"]["dimensions"]["depthM"] = json!(-1);
        let err = update(&core, &p.id, bad).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert_eq!(get(&core, &p.id).unwrap(), before);
    }

    #[test]
    fn archived_project_rejects_dna_updates() {
        let (_tmp, core) = core();
        let p = test_create_villa(&core, "A");
        set_archived(&core, &p.id, true).unwrap();
        let dna = get(&core, &p.id).unwrap();
        assert_eq!(update(&core, &p.id, dna).unwrap_err().code, ErrorCode::InvalidState);
    }
}
