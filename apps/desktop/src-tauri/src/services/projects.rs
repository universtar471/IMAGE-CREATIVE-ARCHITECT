use serde::Deserialize;
use serde_json::Value;

use crate::domain::{ProjectStatus, ProjectType};
use crate::dto::{ProjectBundleDto, ProjectDto, ProjectSummaryDto};
use crate::error::{AppError, AppResult};
use crate::repositories::{self as repo, ProjectRow};
use crate::services::assets::asset_dto;
use crate::services::dna_validation::validate_dna;
use crate::services::{ensure_not_archived, status, AppCore};
use crate::util::{new_id, now_iso, prefix};

pub const MAX_NAME_LEN: usize = 120;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub project_type: String,
    pub subtype: Option<String>,
    /// Resolved DNA built by the UI from Knowledge Pack defaults + wizard input.
    pub dna: Value,
}

pub fn to_dto(p: &ProjectRow) -> ProjectDto {
    ProjectDto {
        id: p.id.clone(),
        name: p.name.clone(),
        project_type: p.project_type,
        subtype: p.subtype.clone(),
        status: p.status,
        active_master_asset_id: p.active_master_asset_id.clone(),
        created_at: p.created_at.clone(),
        updated_at: p.updated_at.clone(),
        archived_at: p.archived_at.clone(),
    }
}

pub(crate) fn clean_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::validation("Project name cannot be empty."));
    }
    if name.chars().count() > MAX_NAME_LEN {
        return Err(AppError::validation(format!("Project name must be at most {MAX_NAME_LEN} characters.")));
    }
    Ok(name.to_string())
}

fn clean_subtype(subtype: Option<String>) -> Option<String> {
    subtype.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

pub fn parse_project_type(s: &str) -> AppResult<ProjectType> {
    ProjectType::parse(s).ok_or_else(|| {
        let known: Vec<&str> = ProjectType::ALL.iter().map(|t| t.as_str()).collect();
        AppError::validation(format!("Unknown project type '{s}'. Use one of: {}.", known.join(", ")))
    })
}

/// Create project + DNA atomically, with its managed folder.
pub fn create(core: &AppCore, req: CreateProjectRequest) -> AppResult<ProjectDto> {
    let name = clean_name(&req.name)?;
    let project_type = parse_project_type(&req.project_type)?;
    validate_dna(&req.dna)?;

    let now = now_iso();
    let mut row = ProjectRow {
        id: new_id(prefix::PROJECT),
        name,
        project_type,
        subtype: clean_subtype(req.subtype),
        status: ProjectStatus::Draft,
        active_master_asset_id: None,
        master_approved_at: None,
        created_at: now.clone(),
        updated_at: now.clone(),
        archived_at: None,
    };
    row.status = status::derive(&row, status::dna_is_ready(&req.dna, project_type), Default::default());

    core.storage.ensure_project_dirs(&row.id)?;
    let result = (|| {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        repo::insert_project(&tx, &row)?;
        repo::insert_dna(&tx, &row.id, &req.dna, &now)?;
        tx.commit()?;
        Ok(())
    })();
    if let Err(err) = result {
        // Nothing was committed; remove the (empty) folder we just created.
        let _ = std::fs::remove_dir_all(core.storage.project_dir(&row.id));
        return Err(err);
    }
    Ok(to_dto(&row))
}

pub fn list(core: &AppCore, include_archived: bool) -> AppResult<Vec<ProjectSummaryDto>> {
    let conn = core.conn()?;
    let rows = repo::list_projects(&conn, include_archived)?;
    rows.iter()
        .map(|p| {
            let thumbnail_path = match &p.active_master_asset_id {
                Some(id) => repo::find_asset(&conn, id)?
                    .and_then(|a| a.thumbnail_rel_path)
                    .and_then(|rel| core.storage.resolve(&p.id, &rel).ok())
                    .filter(|path| path.exists())
                    .map(|path| path.to_string_lossy().into_owned()),
                None => None,
            };
            Ok(ProjectSummaryDto { project: to_dto(p), asset_count: repo::count_assets(&conn, &p.id)?, thumbnail_path })
        })
        .collect()
}

pub fn get(core: &AppCore, project_id: &str) -> AppResult<ProjectBundleDto> {
    let conn = core.conn()?;
    let project = repo::get_project(&conn, project_id)?;
    let dna = repo::get_dna(&conn, project_id)?;
    let assets = repo::list_assets(&conn, project_id)?
        .iter()
        .map(|a| asset_dto(&core.storage, a))
        .collect::<AppResult<Vec<_>>>()?;
    Ok(ProjectBundleDto { project: to_dto(&project), dna, assets })
}

pub fn update_metadata(
    core: &AppCore,
    project_id: &str,
    name: Option<String>,
    subtype: Option<String>,
) -> AppResult<ProjectDto> {
    let conn = core.conn()?;
    let mut p = repo::get_project(&conn, project_id)?;
    ensure_not_archived(&p)?;
    if let Some(name) = name {
        p.name = clean_name(&name)?;
    }
    if let Some(subtype) = subtype {
        p.subtype = clean_subtype(Some(subtype));
    }
    p.updated_at = now_iso();
    repo::update_project(&conn, &p)?;
    Ok(to_dto(&p))
}

/// Archive or restore. Archived projects keep all data and remain listable/openable.
pub fn set_archived(core: &AppCore, project_id: &str, archived: bool) -> AppResult<ProjectDto> {
    let conn = core.conn()?;
    let mut p = repo::get_project(&conn, project_id)?;
    let now = now_iso();
    match (archived, p.archived_at.is_some()) {
        (true, true) | (false, false) => return Ok(to_dto(&p)),
        (true, false) => p.archived_at = Some(now.clone()),
        (false, true) => p.archived_at = None,
    }
    let p = status::save_with_status(&conn, p, &now)?;
    Ok(to_dto(&p))
}

/// Approve (or withdraw approval of) the current master image.
pub fn approve_master(core: &AppCore, project_id: &str, approved: bool) -> AppResult<ProjectDto> {
    let conn = core.conn()?;
    let mut p = repo::get_project(&conn, project_id)?;
    ensure_not_archived(&p)?;
    if approved && p.active_master_asset_id.is_none() {
        return Err(AppError::invalid_state("Choose a master architecture image before approving it."));
    }
    let now = now_iso();
    p.master_approved_at = approved.then(|| now.clone());
    let p = status::save_with_status(&conn, p, &now)?;
    Ok(to_dto(&p))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::services::tests_support::core;
    use crate::services::tests_support::test_valid_dna;

    pub(crate) fn create_villa(core: &AppCore, name: &str) -> ProjectDto {
        create(
            core,
            CreateProjectRequest {
                name: name.into(),
                project_type: "villa".into(),
                subtype: Some("tropical".into()),
                dna: test_valid_dna(),
            },
        )
        .unwrap()
    }

    #[test]
    fn create_persists_project_dna_and_folders() {
        let (_tmp, core) = core();
        let p = create_villa(&core, "  Villa Tropical Test ");
        assert!(p.id.starts_with("PRJ_") && p.id.len() == 4 + 26);
        assert_eq!(p.name, "Villa Tropical Test");
        assert_eq!(p.status, ProjectStatus::Draft);
        assert!(core.storage.project_dir(&p.id).join("assets/original").is_dir());
        let bundle = get(&core, &p.id).unwrap();
        assert_eq!(bundle.dna, test_valid_dna());
    }

    #[test]
    fn create_rejects_invalid_input_without_side_effects() {
        let (_tmp, core) = core();
        let bad_type = create(
            &core,
            CreateProjectRequest {
                name: "x".into(),
                project_type: "castle".into(),
                subtype: None,
                dna: test_valid_dna(),
            },
        );
        assert_eq!(bad_type.unwrap_err().code, crate::error::ErrorCode::ValidationError);
        let empty_name = create(
            &core,
            CreateProjectRequest {
                name: "   ".into(),
                project_type: "villa".into(),
                subtype: None,
                dna: test_valid_dna(),
            },
        );
        assert!(empty_name.is_err());
        let mut dna = test_valid_dna();
        dna["building"]["floors"] = serde_json::json!(-1);
        let bad_dna =
            create(&core, CreateProjectRequest { name: "x".into(), project_type: "villa".into(), subtype: None, dna });
        assert!(bad_dna.is_err());
        assert!(list(&core, true).unwrap().is_empty());
        let leftover = std::fs::read_dir(core.storage.projects_root()).map(|d| d.count()).unwrap_or(0);
        assert_eq!(leftover, 0);
    }

    #[test]
    fn archive_and_restore_keep_data_and_block_edits() {
        let (_tmp, core) = core();
        let p = create_villa(&core, "A");
        let archived = set_archived(&core, &p.id, true).unwrap();
        assert_eq!(archived.status, ProjectStatus::Archived);
        assert!(archived.archived_at.is_some());
        assert!(list(&core, false).unwrap().is_empty());
        assert_eq!(list(&core, true).unwrap().len(), 1);
        let err = update_metadata(&core, &p.id, Some("B".into()), None).unwrap_err();
        assert_eq!(err.code, crate::error::ErrorCode::InvalidState);
        let restored = set_archived(&core, &p.id, false).unwrap();
        assert_eq!(restored.status, ProjectStatus::Draft);
        assert_eq!(get(&core, &p.id).unwrap().dna, test_valid_dna());
    }

    #[test]
    fn approve_requires_master() {
        let (_tmp, core) = core();
        let p = create_villa(&core, "A");
        assert!(approve_master(&core, &p.id, true).is_err());
    }
}
