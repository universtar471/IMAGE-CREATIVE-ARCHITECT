//! SQL access and row mapping. No business rules here — services own invariants.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde_json::Value;

use crate::domain::{
    AssetRole, AssetSource, GenerationPurpose, GenerationStatus, JobStatus, ProjectStatus, ProjectType,
};
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
            p.id,
            p.name,
            p.project_type,
            p.subtype,
            p.status,
            p.active_master_asset_id,
            p.master_approved_at,
            p.created_at,
            p.updated_at,
            p.archived_at
        ],
    )?;
    Ok(())
}

pub fn find_project(conn: &Connection, id: &str) -> AppResult<Option<ProjectRow>> {
    Ok(conn.query_row(&format!("SELECT {PROJECT_COLS} FROM projects WHERE id = ?1"), [id], map_project).optional()?)
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
            p.id,
            p.name,
            p.subtype,
            p.status,
            p.active_master_asset_id,
            p.master_approved_at,
            p.updated_at,
            p.archived_at
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
    serde_json::from_str(&text)
        .map_err(|e| AppError::new(ErrorCode::DbError, format!("Stored DNA for '{project_id}' is not valid JSON: {e}")))
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
    Ok(conn.query_row(&format!("SELECT {ASSET_COLS} FROM assets WHERE id = ?1"), [id], map_asset).optional()?)
}

pub fn list_assets(conn: &Connection, project_id: &str) -> AppResult<Vec<AssetRow>> {
    let mut stmt =
        conn.prepare(&format!("SELECT {ASSET_COLS} FROM assets WHERE project_id = ?1 ORDER BY created_at, id"))?;
    let rows = stmt.query_map([project_id], map_asset)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn count_assets(conn: &Connection, project_id: &str) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM assets WHERE project_id = ?1", [project_id], |r| r.get(0))?)
}

pub fn find_asset_by_sha(conn: &Connection, project_id: &str, sha: &str) -> AppResult<Option<AssetRow>> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {ASSET_COLS} FROM assets WHERE project_id = ?1 AND sha256 = ?2 ORDER BY created_at LIMIT 1"
            ),
            params![project_id, sha],
            map_asset,
        )
        .optional()?)
}

pub fn set_asset_role(conn: &Connection, asset_id: &str, role: AssetRole, now: &str) -> AppResult<()> {
    conn.execute("UPDATE assets SET role = ?2, updated_at = ?3 WHERE id = ?1", params![asset_id, role, now])?;
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
    /// Set on versions created by a generation (ADR-015).
    pub generation_id: Option<String>,
    pub created_at: String,
}

pub fn insert_version(conn: &Connection, v: &VersionRow) -> AppResult<()> {
    conn.execute(
        "INSERT INTO versions (id, project_id, asset_id, parent_version_id, label, operation, operation_json,
             generation_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            v.id,
            v.project_id,
            v.asset_id,
            v.parent_version_id,
            v.label,
            v.operation,
            v.operation_json,
            v.generation_id,
            v.created_at
        ],
    )?;
    Ok(())
}

pub fn list_versions(conn: &Connection, project_id: &str) -> AppResult<Vec<VersionRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, asset_id, parent_version_id, label, operation, operation_json, generation_id,
             created_at
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
                generation_id: r.get(7)?,
                created_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Latest version of an asset: the lineage parent for anything derived from it.
pub fn latest_version_id(conn: &Connection, asset_id: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row(
            "SELECT id FROM versions WHERE asset_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1",
            [asset_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// ------------------------------------------------------------------ generations

#[derive(Debug, Clone)]
pub struct GenerationRow {
    pub id: String,
    pub project_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: GenerationPurpose,
    pub status: GenerationStatus,
    /// Provider-neutral request snapshot; never contains a key.
    pub request_json: String,
    pub parent_asset_id: Option<String>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub error_retryable: Option<bool>,
    /// NOT NULL in the schema (Phase 2). Phase 3 writes the queue time here until the first
    /// attempt starts; the DTO reports `startedAt = null` while nothing has started.
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub camera_id: Option<String>,
    pub batch_id: Option<String>,
    /// Read-only, from the job that runs this generation (`None` for Phase 2 rows).
    pub job_id: Option<String>,
    /// Read-only: when the job's latest attempt started (`None` if it never started).
    pub job_started_at: Option<String>,
}

const GENERATION_COLS: &str = "id, project_id, provider_id, model_id, purpose, status, request_json, \
     parent_asset_id, error_kind, error_message, error_retryable, started_at, finished_at, duration_ms, \
     created_at, updated_at, camera_id, batch_id";

const GENERATION_SELECT: &str = "SELECT g.id, g.project_id, g.provider_id, g.model_id, g.purpose, g.status, \
     g.request_json, g.parent_asset_id, g.error_kind, g.error_message, g.error_retryable, g.started_at, \
     g.finished_at, g.duration_ms, g.created_at, g.updated_at, g.camera_id, g.batch_id, j.id, j.started_at \
     FROM generations g LEFT JOIN jobs j ON j.generation_id = g.id";

fn map_generation(r: &Row<'_>) -> rusqlite::Result<GenerationRow> {
    Ok(GenerationRow {
        id: r.get(0)?,
        project_id: r.get(1)?,
        provider_id: r.get(2)?,
        model_id: r.get(3)?,
        purpose: r.get(4)?,
        status: r.get(5)?,
        request_json: r.get(6)?,
        parent_asset_id: r.get(7)?,
        error_kind: r.get(8)?,
        error_message: r.get(9)?,
        error_retryable: r.get(10)?,
        started_at: r.get(11)?,
        finished_at: r.get(12)?,
        duration_ms: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
        camera_id: r.get(16)?,
        batch_id: r.get(17)?,
        job_id: r.get(18)?,
        job_started_at: r.get(19)?,
    })
}

pub fn insert_generation(conn: &Connection, g: &GenerationRow) -> AppResult<()> {
    conn.execute(
        &format!(
            "INSERT INTO generations ({GENERATION_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
        ),
        params![
            g.id, g.project_id, g.provider_id, g.model_id, g.purpose, g.status, g.request_json, g.parent_asset_id,
            g.error_kind, g.error_message, g.error_retryable, g.started_at, g.finished_at, g.duration_ms,
            g.created_at, g.updated_at, g.camera_id, g.batch_id
        ],
    )?;
    Ok(())
}

/// Error part of a finished generation or of a job's last attempt.
#[derive(Debug, Clone, PartialEq)]
pub struct GenerationErrorRow {
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

/// Move a generation to a final state.
pub fn finish_generation(
    conn: &Connection,
    id: &str,
    status: GenerationStatus,
    error: Option<&GenerationErrorRow>,
    finished_at: &str,
    duration_ms: Option<i64>,
) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE generations SET status = ?2, error_kind = ?3, error_message = ?4, error_retryable = ?5,
             finished_at = ?6, duration_ms = ?7, updated_at = ?6
         WHERE id = ?1",
        params![
            id,
            status,
            error.map(|e| &e.kind),
            error.map(|e| &e.message),
            error.map(|e| e.retryable),
            finished_at,
            duration_ms
        ],
    )?;
    if n == 0 {
        return Err(AppError::not_found("Generation", id));
    }
    Ok(())
}

/// A job attempt started: the generation is `running` from `now`.
pub fn start_generation(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE generations SET status = ?2, started_at = ?3, error_kind = NULL, error_message = NULL,
             error_retryable = NULL, finished_at = NULL, duration_ms = NULL, updated_at = ?3
         WHERE id = ?1",
        params![id, GenerationStatus::Running, now],
    )?;
    Ok(())
}

/// A retryable attempt failed: the generation waits in the queue again.
pub fn requeue_generation(conn: &Connection, id: &str, now: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE generations SET status = ?2, updated_at = ?3 WHERE id = ?1",
        params![id, GenerationStatus::Queued, now],
    )?;
    Ok(())
}

pub fn find_generation(conn: &Connection, id: &str) -> AppResult<Option<GenerationRow>> {
    Ok(conn.query_row(&format!("{GENERATION_SELECT} WHERE g.id = ?1"), [id], map_generation).optional()?)
}

/// Newest first (by queue time).
pub fn list_generations(conn: &Connection, project_id: &str) -> AppResult<Vec<GenerationRow>> {
    let mut stmt =
        conn.prepare(&format!("{GENERATION_SELECT} WHERE g.project_id = ?1 ORDER BY g.created_at DESC, g.id DESC"))?;
    let rows = stmt.query_map([project_id], map_generation)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn insert_generation_output(conn: &Connection, generation_id: &str, index: u32, asset_id: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO generation_outputs (generation_id, output_index, asset_id) VALUES (?1, ?2, ?3)",
        params![generation_id, index, asset_id],
    )?;
    Ok(())
}

/// Output asset IDs still present, in output order (rows cascade away with their asset).
pub fn list_generation_outputs(conn: &Connection, generation_id: &str) -> AppResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT asset_id FROM generation_outputs WHERE generation_id = ?1 ORDER BY output_index")?;
    let rows = stmt.query_map([generation_id], |r| r.get(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Startup recovery: rows still `running` belong to a provider call that died with the app.
pub fn interrupt_running_generations(conn: &Connection, message: &str, now: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE generations SET status = ?1, error_kind = 'interrupted', error_message = ?2, error_retryable = 1,
             updated_at = ?3
         WHERE status = ?4",
        params![GenerationStatus::Interrupted, message, now, GenerationStatus::Running],
    )?)
}

// ------------------------------------------------------------------ jobs

#[derive(Debug, Clone)]
pub struct JobRow {
    pub id: String,
    pub project_id: String,
    pub batch_id: Option<String>,
    pub generation_id: String,
    pub provider_id: String,
    pub label: String,
    pub status: JobStatus,
    pub priority: i64,
    pub attempt: i64,
    pub max_attempts: i64,
    pub next_attempt_at: Option<String>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
    pub error_retryable: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    /// Read-only, from the generation.
    pub model_id: String,
    /// Read-only, from the generation.
    pub camera_id: Option<String>,
}

const JOB_COLS: &str = "id, project_id, batch_id, generation_id, provider_id, label, status, priority, attempt, \
     max_attempts, next_attempt_at, error_kind, error_message, error_retryable, created_at, updated_at, \
     started_at, finished_at";

const JOB_SELECT: &str = "SELECT j.id, j.project_id, j.batch_id, j.generation_id, j.provider_id, j.label, j.status, \
     j.priority, j.attempt, j.max_attempts, j.next_attempt_at, j.error_kind, j.error_message, j.error_retryable, \
     j.created_at, j.updated_at, j.started_at, j.finished_at, g.model_id, g.camera_id \
     FROM jobs j JOIN generations g ON g.id = j.generation_id";

fn map_job(r: &Row<'_>) -> rusqlite::Result<JobRow> {
    Ok(JobRow {
        id: r.get(0)?,
        project_id: r.get(1)?,
        batch_id: r.get(2)?,
        generation_id: r.get(3)?,
        provider_id: r.get(4)?,
        label: r.get(5)?,
        status: r.get(6)?,
        priority: r.get(7)?,
        attempt: r.get(8)?,
        max_attempts: r.get(9)?,
        next_attempt_at: r.get(10)?,
        error_kind: r.get(11)?,
        error_message: r.get(12)?,
        error_retryable: r.get(13)?,
        created_at: r.get(14)?,
        updated_at: r.get(15)?,
        started_at: r.get(16)?,
        finished_at: r.get(17)?,
        model_id: r.get(18)?,
        camera_id: r.get(19)?,
    })
}

pub fn insert_job(conn: &Connection, j: &JobRow) -> AppResult<()> {
    conn.execute(
        &format!(
            "INSERT INTO jobs ({JOB_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
        ),
        params![
            j.id, j.project_id, j.batch_id, j.generation_id, j.provider_id, j.label, j.status, j.priority, j.attempt,
            j.max_attempts, j.next_attempt_at, j.error_kind, j.error_message, j.error_retryable, j.created_at,
            j.updated_at, j.started_at, j.finished_at
        ],
    )?;
    Ok(())
}

pub fn find_job(conn: &Connection, id: &str) -> AppResult<Option<JobRow>> {
    Ok(conn.query_row(&format!("{JOB_SELECT} WHERE j.id = ?1"), [id], map_job).optional()?)
}

pub fn get_job(conn: &Connection, id: &str) -> AppResult<JobRow> {
    find_job(conn, id)?.ok_or_else(|| AppError::not_found("Job", id))
}

/// Every non-terminal job plus the `terminal_limit` most recently updated terminal ones,
/// newest first. `project_id = None` lists all projects.
pub fn list_jobs(conn: &Connection, project_id: Option<&str>, terminal_limit: i64) -> AppResult<Vec<JobRow>> {
    let mut stmt = conn.prepare(&format!(
        "{JOB_SELECT}
         WHERE (?1 IS NULL OR j.project_id = ?1)
           AND (j.status IN ('queued', 'running', 'retrying')
                OR j.id IN (SELECT id FROM jobs
                            WHERE (?1 IS NULL OR project_id = ?1)
                              AND status NOT IN ('queued', 'running', 'retrying')
                            ORDER BY updated_at DESC, id DESC LIMIT ?2))
         ORDER BY j.created_at DESC, j.id DESC"
    ))?;
    let rows = stmt.query_map(params![project_id, terminal_limit], map_job)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Jobs that may start at `now`, in pick order: highest priority, then oldest.
pub fn runnable_jobs(conn: &Connection, now: &str) -> AppResult<Vec<JobRow>> {
    let mut stmt = conn.prepare(&format!(
        "{JOB_SELECT}
         WHERE j.status = 'queued' OR (j.status = 'retrying' AND j.next_attempt_at <= ?1)
         ORDER BY j.priority DESC, j.created_at, j.id"
    ))?;
    let rows = stmt.query_map([now], map_job)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Earliest `next_attempt_at` of a waiting retry that is still later than `after` (the
/// worker sleeps until then). Retries already due at `after` are waiting for a slot.
pub fn next_retry_after(conn: &Connection, after: &str) -> AppResult<Option<String>> {
    Ok(conn.query_row(
        "SELECT MIN(next_attempt_at) FROM jobs WHERE status = 'retrying' AND next_attempt_at > ?1",
        [after],
        |r| r.get(0),
    )?)
}

/// Claim a runnable job: `running`, one more attempt. False if it is no longer runnable.
pub fn start_job(conn: &Connection, id: &str, now: &str) -> AppResult<bool> {
    Ok(conn.execute(
        "UPDATE jobs SET status = 'running', attempt = attempt + 1, next_attempt_at = NULL, started_at = ?2,
             finished_at = NULL, updated_at = ?2
         WHERE id = ?1 AND status IN ('queued', 'retrying')",
        params![id, now],
    )? == 1)
}

/// Final state of a running job. False if it is no longer running (e.g. cancelled).
pub fn finish_running_job(
    conn: &Connection,
    id: &str,
    status: JobStatus,
    error: Option<&GenerationErrorRow>,
    now: &str,
) -> AppResult<bool> {
    Ok(conn.execute(
        "UPDATE jobs SET status = ?2, error_kind = ?3, error_message = ?4, error_retryable = ?5, finished_at = ?6,
             updated_at = ?6
         WHERE id = ?1 AND status = 'running'",
        params![id, status, error.map(|e| &e.kind), error.map(|e| &e.message), error.map(|e| e.retryable), now],
    )? == 1)
}

/// A running job's attempt failed with a retryable error. False if it is no longer running.
pub fn retry_running_job(
    conn: &Connection,
    id: &str,
    error: &GenerationErrorRow,
    next_attempt_at: &str,
    now: &str,
) -> AppResult<bool> {
    Ok(conn.execute(
        "UPDATE jobs SET status = 'retrying', next_attempt_at = ?2, error_kind = ?3, error_message = ?4,
             error_retryable = ?5, updated_at = ?6
         WHERE id = ?1 AND status = 'running'",
        params![id, next_attempt_at, error.kind, error.message, error.retryable, now],
    )? == 1)
}

/// Cancel a non-terminal job. False if it already ended.
pub fn cancel_job(conn: &Connection, id: &str, now: &str) -> AppResult<bool> {
    Ok(conn.execute(
        "UPDATE jobs SET status = 'cancelled', next_attempt_at = NULL, finished_at = ?2, updated_at = ?2
         WHERE id = ?1 AND status IN ('queued', 'running', 'retrying')",
        params![id, now],
    )? == 1)
}

/// Startup recovery: jobs still `running` died with the app.
pub fn interrupt_running_jobs(conn: &Connection, message: &str, now: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE jobs SET status = 'interrupted', error_kind = 'interrupted', error_message = ?1, error_retryable = 1,
             finished_at = ?2, updated_at = ?2
         WHERE status = 'running'",
        params![message, now],
    )?)
}

// ------------------------------------------------------------------ batches

#[derive(Debug, Clone)]
pub struct BatchRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub provider_id: String,
    pub model_id: String,
    pub purpose: GenerationPurpose,
    pub created_at: String,
}

pub fn insert_batch(conn: &Connection, b: &BatchRow) -> AppResult<()> {
    conn.execute(
        "INSERT INTO batches (id, project_id, name, provider_id, model_id, purpose, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![b.id, b.project_id, b.name, b.provider_id, b.model_id, b.purpose, b.created_at],
    )?;
    Ok(())
}

fn map_batch(r: &Row<'_>) -> rusqlite::Result<BatchRow> {
    Ok(BatchRow {
        id: r.get(0)?,
        project_id: r.get(1)?,
        name: r.get(2)?,
        provider_id: r.get(3)?,
        model_id: r.get(4)?,
        purpose: r.get(5)?,
        created_at: r.get(6)?,
    })
}

/// Newest first.
pub fn list_batches(conn: &Connection, project_id: &str) -> AppResult<Vec<BatchRow>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, name, provider_id, model_id, purpose, created_at FROM batches
         WHERE project_id = ?1 ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([project_id], map_batch)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn find_batch(conn: &Connection, id: &str) -> AppResult<Option<BatchRow>> {
    Ok(conn
        .query_row(
            "SELECT id, project_id, name, provider_id, model_id, purpose, created_at FROM batches WHERE id = ?1",
            [id],
            map_batch,
        )
        .optional()?)
}

/// `(job id, status)` of a batch, in item order (job retries come after the items).
pub fn list_batch_jobs(conn: &Connection, batch_id: &str) -> AppResult<Vec<(String, JobStatus)>> {
    let mut stmt = conn.prepare("SELECT id, status FROM jobs WHERE batch_id = ?1 ORDER BY created_at, id")?;
    let rows = stmt.query_map([batch_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ------------------------------------------------------------------ camera anchors

#[derive(Debug, Clone, PartialEq)]
pub struct AnchorRow {
    pub project_id: String,
    pub camera_id: String,
    pub asset_id: String,
    pub approved_at: String,
}

pub fn list_anchors(conn: &Connection, project_id: &str) -> AppResult<Vec<AnchorRow>> {
    let mut stmt = conn.prepare(
        "SELECT project_id, camera_id, asset_id, approved_at FROM camera_anchors
         WHERE project_id = ?1 ORDER BY approved_at, camera_id",
    )?;
    let rows = stmt
        .query_map([project_id], |r| {
            Ok(AnchorRow { project_id: r.get(0)?, camera_id: r.get(1)?, asset_id: r.get(2)?, approved_at: r.get(3)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Insert or replace the anchor of one camera.
pub fn upsert_anchor(conn: &Connection, a: &AnchorRow) -> AppResult<()> {
    conn.execute(
        "INSERT INTO camera_anchors (project_id, camera_id, asset_id, approved_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (project_id, camera_id) DO UPDATE SET asset_id = excluded.asset_id,
             approved_at = excluded.approved_at",
        params![a.project_id, a.camera_id, a.asset_id, a.approved_at],
    )?;
    Ok(())
}

pub fn delete_anchor(conn: &Connection, project_id: &str, camera_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM camera_anchors WHERE project_id = ?1 AND camera_id = ?2", [project_id, camera_id])?;
    Ok(())
}
