//! Guided workflow state (ADR-022, API contract section 13).

use rusqlite::Connection;

use crate::dto::{WorkflowDto, WorkflowStepStateDto};
use crate::error::{AppError, AppResult};
use crate::repositories as repo;
use crate::services::{ensure_not_archived, AppCore};

pub const DNA_STEP_IDS: &[&str] = &["dna.building", "dna.context", "dna.references", "dna.camera", "dna.lighting"];

const DNA_STEP_LABELS: &[(&str, &str)] = &[
    ("dna.building", "Building"),
    ("dna.context", "Context"),
    ("dna.references", "References"),
    ("dna.camera", "Camera"),
    ("dna.lighting", "Lighting"),
];

fn index(step_id: &str) -> AppResult<usize> {
    DNA_STEP_IDS
        .iter()
        .position(|id| *id == step_id)
        .ok_or_else(|| AppError::validation(format!("Unknown workflow step '{step_id}'.")))
}

fn label(step_id: &str) -> &'static str {
    DNA_STEP_LABELS.iter().find(|(id, _)| *id == step_id).map_or("Unknown", |(_, label)| label)
}

fn get_in(conn: &Connection, project_id: &str) -> AppResult<WorkflowDto> {
    let mut states = vec![None; DNA_STEP_IDS.len()];
    let mut stmt = conn.prepare("SELECT step_id, status, confirmed_at FROM workflow_steps WHERE project_id = ?1")?;
    let rows = stmt.query_map([project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
    })?;
    for row in rows {
        let (step_id, status, confirmed_at) = row?;
        if let Some(i) = DNA_STEP_IDS.iter().position(|id| *id == step_id) {
            states[i] = Some(WorkflowStepStateDto { step_id, status, confirmed_at });
        }
    }
    Ok(WorkflowDto {
        steps: DNA_STEP_IDS
            .iter()
            .enumerate()
            .map(|(i, id)| {
                states[i].clone().unwrap_or_else(|| WorkflowStepStateDto {
                    step_id: (*id).to_string(),
                    status: "open".into(),
                    confirmed_at: None,
                })
            })
            .collect(),
    })
}

pub fn get(core: &AppCore, project_id: &str) -> AppResult<WorkflowDto> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    get_in(&conn, project_id)
}

pub fn confirm(core: &AppCore, project_id: &str, step_id: &str) -> AppResult<WorkflowDto> {
    let step = index(step_id)?;
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repo::get_project(&tx, project_id)?;
    ensure_not_archived(&project)?;
    let current = get_in(&tx, project_id)?;
    if current.steps[step].status != "open" {
        return Err(AppError::validation(format!("The step '{}' is not available for confirmation.", label(step_id))));
    }
    let now = core.now_iso();
    tx.execute(
        "INSERT INTO workflow_steps (project_id, step_id, status, confirmed_at) VALUES (?1, ?2, 'confirmed', ?3)
         ON CONFLICT(project_id, step_id) DO UPDATE SET status = excluded.status, confirmed_at = excluded.confirmed_at",
        rusqlite::params![project_id, step_id, now],
    )?;
    let result = get_in(&tx, project_id)?;
    tx.commit()?;
    Ok(result)
}

pub fn reopen(core: &AppCore, project_id: &str, step_id: &str) -> AppResult<WorkflowDto> {
    let step = index(step_id)?;
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let project = repo::get_project(&tx, project_id)?;
    ensure_not_archived(&project)?;
    let current = get_in(&tx, project_id)?;
    if !matches!(current.steps[step].status.as_str(), "confirmed" | "needs_review") {
        return Err(AppError::validation(format!(
            "The step '{}' ({step_id}) is not confirmed and cannot be reopened.",
            label(step_id)
        )));
    }
    tx.execute(
        "INSERT INTO workflow_steps (project_id, step_id, status, confirmed_at) VALUES (?1, ?2, 'open', NULL)
         ON CONFLICT(project_id, step_id) DO UPDATE SET status = 'open', confirmed_at = NULL",
        rusqlite::params![project_id, step_id],
    )?;
    let result = get_in(&tx, project_id)?;
    tx.commit()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::services::projects;
    use crate::services::tests_support::{core, test_create_villa_unconfirmed};

    #[test]
    fn dna_can_be_confirmed_in_any_order() {
        let (_tmp, app) = core();
        let project = test_create_villa_unconfirmed(&app, "Workflow");
        assert_eq!(get(&app, &project.id).unwrap().steps.len(), 5);
        let last = confirm(&app, &project.id, "dna.lighting").unwrap();
        assert_eq!(last.steps[4].status, "confirmed");
        assert!(last.steps[..4].iter().all(|step| step.status == "open"));
        confirm(&app, &project.id, "dna.context").unwrap();
    }

    #[test]
    fn reopen_preserves_later_confirmed_steps() {
        let (_tmp, app) = core();
        let project = test_create_villa_unconfirmed(&app, "Workflow");
        for id in DNA_STEP_IDS {
            confirm(&app, &project.id, id).unwrap();
        }
        let reopened = reopen(&app, &project.id, "dna.context").unwrap();
        assert_eq!(reopened.steps[0].status, "confirmed");
        assert_eq!(reopened.steps[1].status, "open");
        assert!(reopened.steps[2..].iter().all(|step| step.status == "confirmed"));
        confirm(&app, &project.id, "dna.context").unwrap();
        let err = confirm(&app, &project.id, "dna.references").unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
    }

    #[test]
    fn archived_project_uses_existing_archived_error() {
        let (_tmp, app) = core();
        let project = test_create_villa_unconfirmed(&app, "Workflow");
        projects::set_archived(&app, &project.id, true).unwrap();
        let err = confirm(&app, &project.id, "dna.building").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidState);
        assert!(err.message.contains("archived"));
    }
}
