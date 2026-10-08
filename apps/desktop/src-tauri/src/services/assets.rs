//! Asset import, roles, master selection and safe removal.
//!
//! Import is transactional at application level: validate -> hash -> copy to managed
//! storage -> verify copy -> DB write. If the DB write fails the managed copy is removed.
//! The user's source file is only ever read.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;

use crate::domain::{AssetRole, AssetSource};
use crate::dto::{AssetDto, AssetRemoveResult, VersionDto};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::imaging::{self, MAX_IMPORT_BYTES};
use crate::repositories::{self as repo, AssetRow, ProjectRow, VersionRow};
use crate::services::{ensure_not_archived, status, AppCore};
use crate::storage::{self, Storage, ORIGINALS_DIR, PREVIEWS_DIR};
use crate::util::{new_id, now_iso, prefix};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub project_id: String,
    pub source_path: String,
    pub source: String,
    pub role: String,
    /// Keep a second logical asset even if the same binary already exists in the project.
    #[serde(default)]
    pub allow_duplicate: bool,
}

pub fn parse_role(s: &str) -> AppResult<AssetRole> {
    AssetRole::parse(s).ok_or_else(|| AppError::validation(format!("Unknown asset role '{s}'.")))
}

pub fn parse_source(s: &str) -> AppResult<AssetSource> {
    AssetSource::parse(s).ok_or_else(|| AppError::validation(format!("Unknown asset source '{s}'.")))
}

pub(crate) fn asset_dto(storage: &Storage, a: &AssetRow) -> AppResult<AssetDto> {
    let abs = storage.resolve(&a.project_id, &a.managed_rel_path)?;
    let thumb =
        a.thumbnail_rel_path.as_deref().and_then(|rel| storage.resolve(&a.project_id, rel).ok()).filter(|p| p.exists());
    Ok(AssetDto {
        id: a.id.clone(),
        project_id: a.project_id.clone(),
        source: a.source,
        role: a.role,
        // Missing files surface as a recovery state; the DB record is never auto-deleted.
        status: if abs.exists() { a.status.clone() } else { "missing_file".to_string() },
        original_name: a.original_name.clone(),
        managed_rel_path: a.managed_rel_path.clone(),
        absolute_path: abs.to_string_lossy().into_owned(),
        thumbnail_path: thumb.map(|p| p.to_string_lossy().into_owned()),
        mime_type: a.mime_type.clone(),
        file_size_bytes: a.file_size_bytes,
        width_px: a.width_px,
        height_px: a.height_px,
        sha256: a.sha256.clone(),
        parent_asset_id: a.parent_asset_id.clone(),
        operation: a.operation.clone(),
        created_at: a.created_at.clone(),
        updated_at: a.updated_at.clone(),
    })
}

pub fn import(core: &AppCore, req: ImportRequest) -> AppResult<AssetDto> {
    let role = parse_role(&req.role)?;
    let source = parse_source(&req.source)?;

    // 1. project exists and is writable
    {
        let conn = core.conn()?;
        ensure_not_archived(&repo::get_project(&conn, &req.project_id)?)?;
    }

    // 2. validate + inspect the source file (read-only)
    let source_path = PathBuf::from(&req.source_path);
    let display_name =
        source_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| req.source_path.clone());
    let meta = fs::metadata(&source_path).map_err(|e| AppError::io(&format!("Cannot read '{display_name}'"), e))?;
    if !meta.is_file() {
        return Err(AppError::new(ErrorCode::UnsupportedFile, format!("'{display_name}' is not a file.")));
    }
    if meta.len() > MAX_IMPORT_BYTES {
        return Err(AppError::new(
            ErrorCode::UnsupportedFile,
            format!("'{display_name}' is larger than {} MB.", MAX_IMPORT_BYTES / 1024 / 1024),
        ));
    }
    let bytes = fs::read(&source_path).map_err(|e| AppError::io(&format!("Cannot read '{display_name}'"), e))?;
    let info = imaging::inspect(&bytes, &display_name)?;

    // 3. duplicate check (same binary in this project)
    if !req.allow_duplicate {
        let conn = core.conn()?;
        if let Some(existing) = repo::find_asset_by_sha(&conn, &req.project_id, &info.sha256)? {
            return Err(AppError::new(
                ErrorCode::DuplicateAsset,
                format!(
                    "'{display_name}' is identical to '{}' already in this project.",
                    existing.original_name.as_deref().unwrap_or(&existing.id)
                ),
            )
            .with_details(json!({ "existingAssetId": existing.id, "fileName": display_name })));
        }
    }

    // 4. copy to managed storage with a collision-safe name, then verify
    core.storage.ensure_project_dirs(&req.project_id)?;
    let asset_id = new_id(prefix::ASSET);
    let managed_rel = storage::rel(&[ORIGINALS_DIR, &format!("{asset_id}.{}", info.format.extension())]);
    let managed_abs = core.storage.resolve(&req.project_id, &managed_rel)?;
    write_new_file(&managed_abs, &bytes)?;

    // 5. thumbnail (non-fatal)
    let thumb_rel = storage::rel(&[PREVIEWS_DIR, &format!("{asset_id}_thumb.jpg")]);
    let thumb_abs = core.storage.resolve(&req.project_id, &thumb_rel)?;
    let thumbnail_rel_path = match imaging::write_thumbnail(&bytes, info.format, &thumb_abs) {
        Ok(()) => Some(thumb_rel),
        Err(e) => {
            eprintln!("[assets] thumbnail failed for {asset_id}: {e}");
            None
        }
    };

    // 6. DB write (asset + root version + optional master), cleaning up files on failure
    let now = now_iso();
    let row = AssetRow {
        id: asset_id.clone(),
        project_id: req.project_id.clone(),
        source,
        role: AssetRole::RegularImage, // master is applied through the shared invariant below
        status: "ready".into(),
        original_name: Some(display_name.clone()),
        managed_rel_path: managed_rel,
        thumbnail_rel_path,
        mime_type: Some(info.format.mime().into()),
        file_size_bytes: Some(info.size_bytes as i64),
        width_px: Some(info.width as i64),
        height_px: Some(info.height as i64),
        sha256: Some(info.sha256),
        parent_asset_id: None,
        operation: Some("import".into()),
        operation_json: Some(json!({ "sourceFileName": display_name }).to_string()),
        created_at: now.clone(),
        updated_at: now.clone(),
    };
    let db_result = (|| -> AppResult<AssetRow> {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let project = repo::get_project(&tx, &req.project_id)?;
        ensure_not_archived(&project)?;
        let mut row = row.clone();
        row.role = if role == AssetRole::MasterArchitecture { AssetRole::RegularImage } else { role };
        repo::insert_asset(&tx, &row)?;
        repo::insert_version(
            &tx,
            &VersionRow {
                id: new_id(prefix::VERSION),
                project_id: row.project_id.clone(),
                asset_id: row.id.clone(),
                parent_version_id: None,
                label: Some(display_name.clone()),
                operation: "import".into(),
                operation_json: None,
                created_at: now.clone(),
            },
        )?;
        if role == AssetRole::MasterArchitecture {
            apply_master(&tx, project, Some(&row.id), &now)?;
            row.role = AssetRole::MasterArchitecture;
        }
        tx.commit()?;
        Ok(row)
    })();

    match db_result {
        Ok(row) => asset_dto(&core.storage, &row),
        Err(err) => {
            let _ = fs::remove_file(&managed_abs);
            let _ = fs::remove_file(&thumb_abs);
            Err(err)
        }
    }
}

/// Write to `<target>.part`, fsync, verify size, then rename into place.
fn write_new_file(target: &Path, bytes: &[u8]) -> AppResult<()> {
    if target.exists() {
        return Err(AppError::new(ErrorCode::Conflict, "A managed file with this ID already exists."));
    }
    let part = target.with_extension("part");
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&part)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        if fs::metadata(&part)?.len() != bytes.len() as u64 {
            return Err(std::io::Error::other("copied size does not match source"));
        }
        fs::rename(&part, target)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&part);
        AppError::io("Could not copy the image into project storage", e)
    })
}

pub fn list(core: &AppCore, project_id: &str) -> AppResult<Vec<AssetDto>> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    repo::list_assets(&conn, project_id)?.iter().map(|a| asset_dto(&core.storage, a)).collect()
}

fn get_owned_asset(conn: &Connection, project_id: &str, asset_id: &str) -> AppResult<AssetRow> {
    let asset = repo::find_asset(conn, asset_id)?.ok_or_else(|| AppError::not_found("Asset", asset_id))?;
    if asset.project_id != project_id {
        return Err(AppError::validation("That asset belongs to a different project."));
    }
    Ok(asset)
}

/// Single place that changes the master. Guarantees at most one master per project:
/// the previous master becomes an architecture reference; approval is reset when the
/// master actually changes.
fn apply_master(
    conn: &Connection,
    mut project: ProjectRow,
    asset_id: Option<&str>,
    now: &str,
) -> AppResult<ProjectRow> {
    if project.active_master_asset_id.as_deref() == asset_id {
        if let Some(id) = asset_id {
            repo::set_asset_role(conn, id, AssetRole::MasterArchitecture, now)?;
        }
        return status::save_with_status(conn, project, now);
    }
    repo::demote_masters(conn, &project.id, now)?;
    if let Some(id) = asset_id {
        get_owned_asset(conn, &project.id, id)?;
        repo::set_asset_role(conn, id, AssetRole::MasterArchitecture, now)?;
    }
    project.active_master_asset_id = asset_id.map(str::to_string);
    project.master_approved_at = None;
    status::save_with_status(conn, project, now)
}

pub fn set_master(core: &AppCore, project_id: &str, asset_id: Option<&str>) -> AppResult<Vec<AssetDto>> {
    {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let project = repo::get_project(&tx, project_id)?;
        ensure_not_archived(&project)?;
        apply_master(&tx, project, asset_id, &now_iso())?;
        tx.commit()?;
    }
    list(core, project_id)
}

/// Change an asset's role. Becoming master routes through `apply_master`; leaving the
/// master role clears the project's master.
pub fn update_role(core: &AppCore, project_id: &str, asset_id: &str, role: &str) -> AppResult<Vec<AssetDto>> {
    let role = parse_role(role)?;
    {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let project = repo::get_project(&tx, project_id)?;
        ensure_not_archived(&project)?;
        let asset = get_owned_asset(&tx, project_id, asset_id)?;
        let now = now_iso();
        if role == AssetRole::MasterArchitecture {
            apply_master(&tx, project, Some(asset_id), &now)?;
        } else {
            if asset.role == AssetRole::MasterArchitecture {
                apply_master(&tx, project, None, &now)?;
            }
            repo::set_asset_role(&tx, asset_id, role, &now)?;
        }
        tx.commit()?;
    }
    list(core, project_id)
}

/// Remove an asset record and its app-owned managed files. Never touches files
/// outside the project's managed folder (e.g. the user's original source file).
pub fn remove(core: &AppCore, project_id: &str, asset_id: &str) -> AppResult<AssetRemoveResult> {
    let asset = {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let project = repo::get_project(&tx, project_id)?;
        ensure_not_archived(&project)?;
        let asset = get_owned_asset(&tx, project_id, asset_id)?;
        let now = now_iso();
        if project.active_master_asset_id.as_deref() == Some(asset_id) {
            apply_master(&tx, project, None, &now)?;
        }
        repo::delete_asset(&tx, asset_id)?;
        tx.commit()?;
        asset
    };

    let mut warnings = Vec::new();
    let rels = std::iter::once(asset.managed_rel_path.as_str()).chain(asset.thumbnail_rel_path.as_deref());
    for rel in rels {
        let Ok(path) = core.storage.resolve(project_id, rel) else { continue };
        if !core.storage.is_managed(project_id, &path) || !path.exists() {
            continue;
        }
        if let Err(e) = fs::remove_file(&path) {
            warnings.push(format!("{}: {e}", path.display()));
        }
    }
    Ok(AssetRemoveResult {
        asset_id: asset_id.to_string(),
        file_cleanup_warning: (!warnings.is_empty())
            .then(|| format!("The asset was removed, but some files could not be deleted: {}", warnings.join("; "))),
    })
}

pub fn list_versions(core: &AppCore, project_id: &str) -> AppResult<Vec<VersionDto>> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    Ok(repo::list_versions(&conn, project_id)?
        .into_iter()
        .map(|v| VersionDto {
            id: v.id,
            project_id: v.project_id,
            asset_id: v.asset_id,
            parent_version_id: v.parent_version_id,
            label: v.label,
            operation: v.operation,
            created_at: v.created_at,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ProjectStatus;
    use crate::services::projects;
    use crate::services::tests_support::test_create_villa;
    use crate::services::tests_support::{core, write_png};

    fn import_file(core: &AppCore, project_id: &str, path: &Path, role: &str) -> AppResult<AssetDto> {
        import(
            core,
            ImportRequest {
                project_id: project_id.into(),
                source_path: path.to_string_lossy().into_owned(),
                source: "external".into(),
                role: role.into(),
                allow_duplicate: false,
            },
        )
    }

    #[test]
    fn imports_png_with_metadata_copy_thumbnail_and_version() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let src = write_png(tmp.path(), "facade.png", 64, 40, [10, 20, 30]);
        let source_bytes = fs::read(&src).unwrap();

        let a = import_file(&core, &p.id, &src, "material_reference").unwrap();
        assert!(a.id.starts_with("AST_"));
        assert_eq!(a.role, AssetRole::MaterialReference);
        assert_eq!((a.width_px, a.height_px), (Some(64), Some(40)));
        assert_eq!(a.mime_type.as_deref(), Some("image/png"));
        assert_eq!(a.original_name.as_deref(), Some("facade.png"));
        assert_eq!(a.sha256.as_ref().unwrap().len(), 64);
        assert!(a.managed_rel_path.starts_with("assets/original/AST_"));
        assert!(Path::new(&a.absolute_path).exists());
        assert!(a.thumbnail_path.is_some());
        // source untouched
        assert_eq!(fs::read(&src).unwrap(), source_bytes);
        assert_eq!(list_versions(&core, &p.id).unwrap().len(), 1);
    }

    #[test]
    fn rejects_unsupported_and_corrupt_files() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let txt = tmp.path().join("notes.txt");
        fs::write(&txt, b"hello").unwrap();
        assert_eq!(import_file(&core, &p.id, &txt, "regular_image").unwrap_err().code, ErrorCode::UnsupportedFile);
        let fake = tmp.path().join("fake.png");
        fs::write(&fake, [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3]).unwrap();
        assert_eq!(import_file(&core, &p.id, &fake, "regular_image").unwrap_err().code, ErrorCode::UnsupportedFile);
        assert!(list(&core, &p.id).unwrap().is_empty());
    }

    #[test]
    fn duplicate_binary_is_rejected_unless_allowed() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let src = write_png(tmp.path(), "a.png", 8, 8, [1, 1, 1]);
        let first = import_file(&core, &p.id, &src, "regular_image").unwrap();
        let err = import_file(&core, &p.id, &src, "regular_image").unwrap_err();
        assert_eq!(err.code, ErrorCode::DuplicateAsset);
        assert_eq!(err.details.unwrap()["existingAssetId"], json!(first.id));
        let again = import(
            &core,
            ImportRequest {
                project_id: p.id.clone(),
                source_path: src.to_string_lossy().into_owned(),
                source: "external".into(),
                role: "regular_image".into(),
                allow_duplicate: true,
            },
        );
        assert!(again.is_ok());
        assert_eq!(list(&core, &p.id).unwrap().len(), 2);
    }

    #[test]
    fn at_most_one_master_and_old_master_is_demoted() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let a =
            import_file(&core, &p.id, &write_png(tmp.path(), "a.png", 8, 8, [1, 0, 0]), "master_architecture").unwrap();
        assert_eq!(a.role, AssetRole::MasterArchitecture);
        let b = import_file(&core, &p.id, &write_png(tmp.path(), "b.png", 8, 8, [0, 1, 0]), "mood_reference").unwrap();

        let bundle = projects::get(&core, &p.id).unwrap();
        assert_eq!(bundle.project.active_master_asset_id.as_deref(), Some(a.id.as_str()));
        assert_eq!(bundle.project.status, ProjectStatus::MasterPending);

        let assets = set_master(&core, &p.id, Some(&b.id)).unwrap();
        let role_of = |id: &str| assets.iter().find(|x| x.id == id).unwrap().role;
        assert_eq!(role_of(&a.id), AssetRole::ArchitectureReference);
        assert_eq!(role_of(&b.id), AssetRole::MasterArchitecture);
        assert_eq!(assets.iter().filter(|x| x.role == AssetRole::MasterArchitecture).count(), 1);

        // role update to master routes through the same invariant
        let assets = update_role(&core, &p.id, &a.id, "master_architecture").unwrap();
        assert_eq!(assets.iter().filter(|x| x.role == AssetRole::MasterArchitecture).count(), 1);
        assert_eq!(projects::get(&core, &p.id).unwrap().project.active_master_asset_id, Some(a.id.clone()));

        // leaving the master role clears the project master
        update_role(&core, &p.id, &a.id, "material_reference").unwrap();
        assert_eq!(projects::get(&core, &p.id).unwrap().project.active_master_asset_id, None);
    }

    #[test]
    fn master_approval_resets_when_master_changes() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let a =
            import_file(&core, &p.id, &write_png(tmp.path(), "a.png", 8, 8, [1, 0, 0]), "master_architecture").unwrap();
        let b = import_file(&core, &p.id, &write_png(tmp.path(), "b.png", 8, 8, [0, 1, 0]), "regular_image").unwrap();
        assert_eq!(projects::approve_master(&core, &p.id, true).unwrap().status, ProjectStatus::MasterApproved);
        set_master(&core, &p.id, Some(&a.id)).unwrap();
        assert_eq!(projects::get(&core, &p.id).unwrap().project.status, ProjectStatus::MasterApproved);
        set_master(&core, &p.id, Some(&b.id)).unwrap();
        assert_eq!(projects::get(&core, &p.id).unwrap().project.status, ProjectStatus::MasterPending);
    }

    #[test]
    fn master_must_belong_to_project() {
        let (tmp, core) = core();
        let p1 = test_create_villa(&core, "A");
        let p2 = test_create_villa(&core, "B");
        let a = import_file(&core, &p1.id, &write_png(tmp.path(), "a.png", 8, 8, [1, 0, 0]), "regular_image").unwrap();
        assert!(set_master(&core, &p2.id, Some(&a.id)).is_err());
        assert_eq!(projects::get(&core, &p2.id).unwrap().project.active_master_asset_id, None);
    }

    #[test]
    fn remove_deletes_managed_copy_only_and_clears_master() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let src = write_png(tmp.path(), "a.png", 8, 8, [1, 0, 0]);
        let a = import_file(&core, &p.id, &src, "master_architecture").unwrap();
        let res = remove(&core, &p.id, &a.id).unwrap();
        assert!(res.file_cleanup_warning.is_none());
        assert!(!Path::new(&a.absolute_path).exists());
        assert!(src.exists(), "user source file must never be deleted");
        let bundle = projects::get(&core, &p.id).unwrap();
        assert!(bundle.assets.is_empty());
        assert_eq!(bundle.project.active_master_asset_id, None);
    }

    #[test]
    fn missing_managed_file_shows_recovery_state_without_deleting_record() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        let a = import_file(&core, &p.id, &write_png(tmp.path(), "a.png", 8, 8, [1, 0, 0]), "regular_image").unwrap();
        fs::remove_file(&a.absolute_path).unwrap();
        let assets = list(&core, &p.id).unwrap();
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].status, "missing_file");
    }

    #[test]
    fn archived_project_rejects_import() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "A");
        projects::set_archived(&core, &p.id, true).unwrap();
        let err =
            import_file(&core, &p.id, &write_png(tmp.path(), "a.png", 8, 8, [1, 0, 0]), "regular_image").unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidState);
    }
}
