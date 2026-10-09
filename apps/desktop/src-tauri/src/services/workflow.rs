//! Guided workflow state (ADR-022, API contract section 13).

use rusqlite::Connection;

use crate::domain::GenerationPurpose;
use crate::dto::{WorkflowDto, WorkflowStepStateDto};
use crate::error::{AppError, AppResult};
use crate::repositories::{self as repo, ProjectRow};
use crate::services::{ensure_not_archived, status, AppCore};

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
    if step > 0 && current.steps[step - 1].status != "confirmed" {
        return Err(AppError::validation(format!(
            "Finish the step '{}' ({}) before confirming '{}'.",
            label(DNA_STEP_IDS[step - 1]),
            DNA_STEP_IDS[step - 1],
            label(step_id)
        )));
    }
    if current.steps[step].status == "confirmed" {
        return Err(AppError::validation(format!("The step '{}' ({step_id}) is already confirmed.", label(step_id))));
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
    for later in DNA_STEP_IDS.iter().skip(step + 1) {
        tx.execute(
            "UPDATE workflow_steps SET status = 'needs_review' WHERE project_id = ?1 AND step_id = ?2 AND status = 'confirmed'",
            rusqlite::params![project_id, later],
        )?;
    }
    let result = get_in(&tx, project_id)?;
    tx.commit()?;
    Ok(result)
}

/// Enforce the generation prerequisites while the caller still holds its transaction/connection.
pub(crate) fn ensure_generation_allowed(
    conn: &Connection,
    project: &ProjectRow,
    purpose: GenerationPurpose,
) -> AppResult<()> {
    if matches!(purpose, GenerationPurpose::Variation) {
        if project.master_approved_at.is_none() {
            return Err(gate_error("generate.master", "Master"));
        }
        return Ok(());
    }

    let workflow = get_in(conn, &project.id)?;
    for (i, step) in workflow.steps.iter().enumerate() {
        if step.status != "confirmed" {
            return Err(gate_error(DNA_STEP_IDS[i], label(DNA_STEP_IDS[i])));
        }
    }
    if matches!(purpose, GenerationPurpose::Anchor | GenerationPurpose::Production)
        && project.master_approved_at.is_none()
    {
        return Err(gate_error("generate.master", "Master"));
    }
    if purpose == GenerationPurpose::Production {
        let dna = repo::get_dna(conn, &project.id)?;
        let anchor_views = status::anchor_view_ids(&dna);
        let approved: std::collections::HashSet<String> =
            repo::list_anchors(conn, &project.id)?.into_iter().map(|anchor| anchor.camera_id).collect();
        if anchor_views.iter().any(|camera_id| !approved.contains(camera_id)) {
            return Err(gate_error("generate.anchors", "Anchors"));
        }
    }
    Ok(())
}

fn gate_error(step_id: &str, step_label: &str) -> AppError {
    AppError::validation(format!("Finish the step '{step_label}' ({step_id}) before generating."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorCode;
    use crate::services::projects;
    use crate::services::tests_support::{core, test_create_villa_unconfirmed};

    #[test]
    fn new_projects_have_open_steps_and_confirming_unlocks_in_order() {
        let (_tmp, app) = core();
        let project = test_create_villa_unconfirmed(&app, "Workflow");
        assert_eq!(get(&app, &project.id).unwrap().steps.len(), 5);
        assert_eq!(get(&app, &project.id).unwrap().steps[0].status, "open");
        let err = confirm(&app, &project.id, "dna.context").unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert!(err.message.contains("dna.building"));
        let first = confirm(&app, &project.id, "dna.building").unwrap();
        assert_eq!(first.steps[0].status, "confirmed");
        assert_eq!(confirm(&app, &project.id, "dna.context").unwrap().steps[1].status, "confirmed");
    }

    #[test]
    fn reopen_marks_later_confirmed_steps_needs_review_in_one_transaction() {
        let (_tmp, app) = core();
        let project = test_create_villa_unconfirmed(&app, "Workflow");
        for id in DNA_STEP_IDS {
            confirm(&app, &project.id, id).unwrap();
        }
        let reopened = reopen(&app, &project.id, "dna.context").unwrap();
        assert_eq!(reopened.steps[0].status, "confirmed");
        assert_eq!(reopened.steps[1].status, "open");
        assert!(reopened.steps[2..].iter().all(|step| step.status == "needs_review"));
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
