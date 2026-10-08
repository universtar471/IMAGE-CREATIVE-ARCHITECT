//! SQL access and row mapping. No business rules here — services own invariants.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;

use crate::domain::{AssetRole, AssetSource, ProjectStatus, ProjectType};
use crate::error::{AppError, AppResult, ErrorCode};

#[derive(Debug, Clone)]
pub struct ProjectRow {
    pub id: String,
    pub name: String,
    pub project_type: ProjectType,
    pub subtype: Option<String>,
    pub status: ProjectStatus,
    pub active_master_asset_id: Option<String>,
    pub master_approved_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
}

const PROJECT_COLS: &str = "id, name, project_type, subtype, status, active_master_asset_id, \
     master_approved_at, created_at, updated_at, archived_at";

fn map_project(r: &Row<'_>) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: r.get(0)?,
        name: r.get(1)?,
        project_type: r.get(2)?,
        subtype: r.get(3)?,
        status: r.get(4)?,
        active_master_asset_id: r.get(5)?,
        master_approved_at: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
        archived_at: r.get(9)?,
    })
}

pub fn insert_project(conn: &Connection, p: &ProjectRow) -> AppResult<()> {
    conn.execute(
        &format!("INSERT INTO projects ({PROJECT_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"),
        params![
            p.id, p.name, p.project_type, p.subtype, p.status, p.active_master_asset_id,
            p.master_approved_at, p.created_at, p.updated_at, p.archived_at
        ],
    )?;
    Ok(())
}

pub fn find_project(conn: &Connection, id: &str) -> AppResult<Option<ProjectRow>> {
    Ok(conn
        .query_row(&format!("SELECT {PROJECT_COLS} FROM projects WHERE id = ?1"), [id], map_project)
        .optional()?)
}

pub fn get_project(conn: &Connection, id: &str) -> AppResult<ProjectRow> {
    find_project(conn, id)?.ok_or_else(|| AppError::not_found("Project", id))
}

pub fn list_projects(conn: &Connection, include_archived: bool) -> AppResult<Vec<ProjectRow>> {
    let sql = format!(
        "SELECT {PROJECT_COLS} FROM projects {} ORDER BY updated_at DESC, id",
        if include_archived { "" } else { "WHERE archived_at IS NULL" }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_project)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn update_project(conn: &Connection, p: &ProjectRow) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE projects SET name = ?2, subtype = ?3, status = ?4, active_master_asset_id = ?5,
             master_approved_at = ?6, updated_at = ?7, archived_at = ?8
         WHERE id = ?1",
        params![
            p.id, p.name, p.subtype, p.status, p.active_master_asset_id, p.master_approved_at,
            p.updated_at, p.archived_at
        ],
    )?;
    if n == 0 {
        return Err(AppError::not_found("Project", &p.id));
    }
    Ok(())
}

// ------------------------------------------------------------------ DNA

pub fn insert_dna(conn: &Connection, project_id: &str, dna: &Value, now: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO project_dna (project_id, schema_version, dna_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![project_id, schema_version_of(dna), dna.to_string(), now],
    )?;
    Ok(())
}

pub fn update_dna(conn: &Connection, project_id: &str, dna: &Value, now: &str) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE project_dna SET schema_version = ?2, dna_json = ?3, updated_at = ?4 WHERE project_id = ?1",
        params![project_id, schema_version_of(dna), dna.to_string(), now],
    )?;
    if n == 0 {
        return Err(AppError::not_found("Project DNA", project_id));
    }
    Ok(())
}

pub fn get_dna(conn: &Connection, project_id: &str) -> AppResult<Value> {
    let text: Option<String> = conn
        .query_row("SELECT dna_json FROM project_dna WHERE project_id = ?1", [project_id], |r| r.get(0))
        .optional()?;
    let text = text.ok_or_else(|| AppError::not_found("Project DNA", project_id))?;
    serde_json::from_str(&text).map_err(|e| {
        AppError::new(ErrorCode::DbError, format!("Stored DNA for '{project_id}' is not valid JSON: {e}"))
    })
}

fn schema_version_of(dna: &Value) -> i64 {
    dna.get("schemaVersion").and_then(Value::as_i64).unwrap_or(1)
}

// ------------------------------------------------------------------ assets

#[derive(Debug, Clone)]
pub struct AssetRow {
    pub id: String,
    pub project_id: String,
    pub source: AssetSource,
    pub role: AssetRole,
    pub status: String,
    pub original_name: Option<String>,
    pub managed_rel_path: String,
    pub thumbnail_rel_path: Option<String>,
    pub mime_type: Option<String>,
    pub file_size_bytes: Option<i64>,
    pub width_px: Option<i64>,
    pub height_px: Option<i64>,
    pub sha256: Option<String>,
    pub parent_asset_id: Option<String>,
    pub operation: Option<String>,
    pub operation_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

const ASSET_COLS: &str = "id, project_id, source, role, status, original_name, managed_rel_path, \
     thumbnail_rel_path, mime_type, file_size_bytes, width_px, height_px, sha256, parent_asset_id, \
     operation, operation_json, created_at, updated_at";

fn map_asset(r: &Row<'_>) -> rusqlite::Result<AssetRow> {
    Ok(AssetRow {
        id: r.get(0)?,
        project_id: r.get(1)?,
        source: r.get(2)?,
        role: r.get(3)?,
        status: r.get(4)?,
        original_name: r.get(5)?,
        managed_rel_path: r.get(6)?,
        thumbnail_rel_path: r.get(7)?,
        mime_type: r.get(8)?,
        file_size_bytes: r.get(9)?,
        width_px: r.get(10)?,
        height_px: r.get(11)?,
        sha256: r.get(12)?,
        parent_asset_id: r.get(13)?,
        operation: r.get(14)?,
        operation_json: r.get(15)?,
        created_at: r.get(16)?,
        updated_at: r.get(17)?,
    })
}

pub fn insert_asset(conn: &Connection, a: &AssetRow) -> AppResult<()> {
    conn.execute(
        &format!(
            "INSERT INTO assets ({ASSET_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
        ),
        params![
            a.id, a.project_id, a.source, a.role, a.status, a.original_name, a.managed_rel_path,
            a.thumbnail_rel_path, a.mime_type, a.file_size_bytes, a.width_px, a.height_px, a.sha256,
            a.parent_asset_id, a.operation, a.operation_json, a.created_at, a.updated_at
        ],
    )?;
    Ok(())
}

pub fn find_asset(conn: &Connection, id: &str) -> AppResult<Option<AssetRow>> {
    Ok(conn
        .query_row(&format!("SELECT {ASSET_COLS} FROM assets WHERE id = ?1"), [id], map_asset)
        .optional()?)
}

pub fn list_assets(conn: &Connection, project_id: &str) -> AppResult<Vec<AssetRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {ASSET_COLS} FROM assets WHERE project_id = ?1 ORDER BY created_at, id"
    ))?;
    let rows = stmt.query_map([project_id], map_asset)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn count_assets(conn: &Connection, project_id: &str) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM assets WHERE project_id = ?1", [project_id], |r| r.get(0))?)
}

pub fn find_asset_by_sha(conn: &Connection, project_id: &str, sha: &str) -> AppResult<Option<AssetRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {ASSET_COLS} FROM assets WHERE project_id = ?1 AND sha256 = ?2 ORDER BY created_at LIMIT 1"),
            params![project_id, sha],
            map_asset,
        )
        .optional()?)
}

pub fn set_asset_role(conn: &Connection, asset_id: &str, role: AssetRole, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE assets SET role = ?2, updated_at = ?3 WHERE id = ?1",
        params![asset_id, role, now],
    )?;
    Ok(())
}

/// Demote any current master of the project to architecture reference.
pub fn demote_masters(conn: &Connection, project_id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE assets SET role = ?2, updated_at = ?3 WHERE project_id = ?1 AND role = ?4",
        params![project_id, AssetRole::ArchitectureReference, now, AssetRole::MasterArchitecture],
    )?;
    Ok(())
}

pub fn delete_asset(conn: &Connection, asset_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM assets WHERE id = ?1", [asset_id])?;
    Ok(())
}

// ------------------------------------------------------------------ versions

#[derive(Debug, Clone)]
pub struct VersionRow {
    pub id: String,
    pub project_id: String,
    pub asset_id: String,
    pub parent_version_id: Option<String>,
    pub label: Option<String>,
    pub operation: String,
    pub operation_json: Option<String>,
    pub created_at: String,
}

pub fn insert_version(conn: &Connection, v: &VersionRow) -> AppResult<()> {
    conn.execute(
        "INSERT INTO versions (id, project_id, asset_id, parent_version_id, label, operation, operation_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![v.id, v.project_id, v.asset_id, v.parent_version_id, v.label, v.operation, v.operation_json, v.created_at],
    )?;
    Ok(())
}

pub fn list_versions(conn: &Connection, project_id: &str) -> AppResult<Vec<VersionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, asset_id, parent_version_id, label, operation, operation_json, created_at
         FROM versions WHERE project_id = ?1 ORDER BY created_at, id",
    )?;
    let rows = stmt
        .query_map([project_id], |r| {
            Ok(VersionRow {
                id: r.get(0)?,
                project_id: r.get(1)?,
                asset_id: r.get(2)?,
                parent_version_id: r.get(3)?,
                label: r.get(4)?,
                operation: r.get(5)?,
                operation_json: r.get(6)?,
                created_at: r.get(7)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}
