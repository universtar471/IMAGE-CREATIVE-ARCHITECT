//! SQLite bootstrap and forward-only migrations.
//! Each migration runs in its own transaction; a failure aborts startup rather than
//! continuing with a partial schema.

use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::util::now_iso;

/// Ordered list of migrations. Append only; never edit an applied migration.
pub const MIGRATIONS: &[(i64, &str)] = &[
    (1, include_str!("../migrations/0001_initial.sql")),
    (2, include_str!("../migrations/0002_generations.sql")),
    (3, include_str!("../migrations/0003_jobs.sql")),
];

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
    let current: i64 = conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))?;
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
        tx.execute_batch(sql)
            .map_err(|e| AppError::new(ErrorCode::DbError, format!("Migration {version} failed: {e}")))?;
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
    use crate::services::{tests_support::test_valid_dna, AppCore};

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
        assert_eq!(
            tables(&conn),
            [
                "assets",
                "batches",
                "camera_anchors",
                "generation_outputs",
                "generations",
                "jobs",
                "project_dna",
                "projects",
                "schema_migrations",
                "versions"
            ]
        );
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
            let p = projects::create(
                &core,
                CreateProjectRequest {
                    name: "Villa Tropical Test".into(),
                    project_type: "villa".into(),
                    subtype: Some("tropical".into()),
                    dna: dna.clone(),
                },
            )
            .unwrap();
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

    #[test]
    fn upgrades_a_phase_1_database_to_v2_and_can_generate_from_its_master() {
        use crate::domain::GenerationStatus;
        use crate::services::tests_support::{open_test_core, write_png};
        use crate::services::{assets, generations, DB_FILE};

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        std::fs::create_dir_all(&root).unwrap();
        let dna = test_valid_dna();
        {
            // A database exactly as Phase 1 left it: only migration 1 applied.
            let conn = Connection::open(root.join(DB_FILE)).unwrap();
            configure(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
            )
            .unwrap();
            conn.execute_batch(MIGRATIONS[0].1).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (1, 't0')", []).unwrap();
            assert_eq!(schema_version(&conn).unwrap(), 1);
            conn.execute_batch(
                "INSERT INTO projects (id, name, project_type, subtype, status, active_master_asset_id,
                     master_approved_at, created_at, updated_at)
                   VALUES ('PRJ_V1', 'Old villa', 'villa', 'tropical', 'master_approved', 'AST_M',
                     't1', 't1', 't1');
                 INSERT INTO assets (id, project_id, source, role, status, original_name, managed_rel_path,
                     mime_type, width_px, height_px, operation, created_at, updated_at)
                   VALUES ('AST_M', 'PRJ_V1', 'external', 'master_architecture', 'ready', 'master.png',
                     'assets/original/AST_M.png', 'image/png', 40, 30, 'import', 't1', 't1'),
                          ('AST_R', 'PRJ_V1', 'photo', 'material_reference', 'ready', 'stone.png',
                     'assets/original/AST_R.png', 'image/png', 40, 30, 'import', 't1', 't1');
                 INSERT INTO versions (id, project_id, asset_id, parent_version_id, label, operation, created_at)
                   VALUES ('VER_M', 'PRJ_V1', 'AST_M', NULL, 'master.png', 'import', 't1'),
                          ('VER_R', 'PRJ_V1', 'AST_R', NULL, 'stone.png', 'import', 't1');",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO project_dna (project_id, schema_version, dna_json, created_at, updated_at)
                 VALUES ('PRJ_V1', 1, ?1, 't1', 't1')",
                [dna.to_string()],
            )
            .unwrap();
            let originals = root.join("projects/PRJ_V1/assets/original");
            std::fs::create_dir_all(&originals).unwrap();
            write_png(&originals, "AST_M.png", 40, 30, [180, 40, 40]);
            write_png(&originals, "AST_R.png", 40, 30, [90, 90, 90]);
        }

        let (core, _) = open_test_core(&root);
        {
            let conn = core.conn().unwrap();
            assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.last().unwrap().0);
            let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
            assert_eq!(fk, 1);
            let violations: i64 =
                conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
            assert_eq!(violations, 0);
        }
        let bundle = projects::get(&core, "PRJ_V1").unwrap();
        assert_eq!(bundle.project.name, "Old villa");
        assert_eq!(bundle.project.active_master_asset_id.as_deref(), Some("AST_M"));
        assert_eq!(bundle.dna, dna);
        assert_eq!(bundle.assets.len(), 2);
        assert!(bundle.assets.iter().all(|a| a.status == "ready"));
        let versions = assets::list_versions(&core, "PRJ_V1").unwrap();
        assert_eq!(versions.len(), 2);
        assert!(versions.iter().all(|v| v.generation_id.is_none()));
        assert!(generations::list(&core, "PRJ_V1").unwrap().is_empty());

        let g = generations::submit(
            &core,
            serde_json::from_value(serde_json::json!({
                "projectId": "PRJ_V1", "providerId": "local_preview", "modelId": "placeholder-v1", "purpose": "hero",
                "prompt": { "compilerVersion": "1", "positivePrompt": "Old villa at dusk", "negativePrompt": "",
                            "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
                "referenceAssetIds": ["AST_R", "AST_M"],
                "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null }
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(g.status, GenerationStatus::Completed, "{:?}", g.error);
        assert_eq!(g.parent_asset_id.as_deref(), Some("AST_M"));
        let versions = assets::list_versions(&core, "PRJ_V1").unwrap();
        let generated = versions.iter().find(|v| v.generation_id.as_deref() == Some(g.id.as_str())).unwrap();
        assert_eq!(generated.parent_version_id.as_deref(), Some("VER_M"));
    }
}
