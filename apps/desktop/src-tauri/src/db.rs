//! SQLite bootstrap and forward-only migrations.
//! Each migration runs in its own transaction; a failure aborts startup rather than
//! continuing with a partial schema.

use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::util::now_iso;

/// Ordered list of migrations. Append only; never edit an applied migration.
pub const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../migrations/0001_initial.sql"))];

pub fn open(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io("Cannot create data folder", e))?;
    }
    let conn = Connection::open(path)?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    migrate(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

pub fn migrate(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
         );",
    )?;
    let current: i64 =
        conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))?;
    let latest = MIGRATIONS.last().map(|m| m.0).unwrap_or(0);
    if current > latest {
        return Err(AppError::new(
            ErrorCode::DbError,
            format!(
                "The database was created by a newer version of the app (schema v{current}, this build supports v{latest}). Please update the app."
            ),
        ));
    }
    for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v > current) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql).map_err(|e| {
            AppError::new(ErrorCode::DbError, format!("Migration {version} failed: {e}"))
        })?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            rusqlite::params![version, now_iso()],
        )?;
        tx.commit()?;
    }
    Ok(())
}

pub fn schema_version(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::projects::{self, CreateProjectRequest};
    use crate::services::{dna_validation::test_valid_dna, AppCore};

    fn tables(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn migrations_apply_on_fresh_database() {
        let conn = open_in_memory().unwrap();
        assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.last().unwrap().0);
        assert_eq!(tables(&conn), ["assets", "project_dna", "projects", "schema_migrations", "versions"]);
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn migrate_is_idempotent() {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        migrate(&conn).unwrap();
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, MIGRATIONS.len() as i64);
    }

    #[test]
    fn refuses_database_from_newer_app() {
        let conn = open_in_memory().unwrap();
        conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (999, 'x')", []).unwrap();
        assert!(migrate(&conn).is_err());
    }

    #[test]
    fn reopen_existing_database_recovers_identical_data() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        let (id, dna) = {
            let core = AppCore::open(&root).unwrap();
            let mut dna = test_valid_dna();
            dna["building"]["floors"] = serde_json::json!(2);
            dna["building"]["colorPalette"] = serde_json::json!(["white", "beige"]);
            let p = projects::create(&core, CreateProjectRequest {
                name: "Villa Tropical Test".into(), project_type: "villa".into(),
                subtype: Some("tropical".into()), dna: dna.clone(),
            }).unwrap();
            (p.id, dna)
        }; // core dropped = app closed
        let core = AppCore::open(&root).unwrap();
        let bundle = projects::get(&core, &id).unwrap();
        assert_eq!(bundle.project.name, "Villa Tropical Test");
        assert_eq!(bundle.project.subtype.as_deref(), Some("tropical"));
        assert_eq!(bundle.dna, dna);
    }

    #[test]
    fn database_enforces_single_master_per_project() {
        let conn = open_in_memory().unwrap();
        conn.execute_batch(
            "INSERT INTO projects (id, name, project_type, status, created_at, updated_at)
               VALUES ('PRJ_1', 'p', 'villa', 'draft', 't', 't');
             INSERT INTO assets (id, project_id, source, role, managed_rel_path, created_at, updated_at)
               VALUES ('AST_1', 'PRJ_1', 'external', 'master_architecture', 'a', 't', 't');",
        )
        .unwrap();
        let second = conn.execute(
            "INSERT INTO assets (id, project_id, source, role, managed_rel_path, created_at, updated_at)
               VALUES ('AST_2', 'PRJ_1', 'external', 'master_architecture', 'b', 't', 't')",
            [],
        );
        assert!(second.is_err());
    }
}
