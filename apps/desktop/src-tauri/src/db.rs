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
    (4, include_str!("../migrations/0004_workflow.sql")),
    (5, include_str!("../migrations/0005_qc.sql")),
    (6, include_str!("../migrations/0006_regions.sql")),
    (7, include_str!("../migrations/0007_luts.sql")),
    (8, include_str!("../migrations/0008_enhance_check.sql")),
    (9, include_str!("../migrations/0009_publications.sql")),
    (10, include_str!("../migrations/0010_user_presets.sql")),
    (11, include_str!("../migrations/0011_canvas_layouts.sql")),
    (12, include_str!("../migrations/0012_video_tasks.sql")),
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
                "canvas_layouts",
                "generation_outputs",
                "generations",
                "jobs",
                "lut_sources",
                "luts",
                "project_dna",
                "projects",
                "publications",
                "qc_reports",
                "qc_settings",
                "regions",
                "schema_migrations",
                "user_presets",
                "versions",
                "video_tasks",
                "workflow_steps"
            ]
        );
        let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn migration_0005_creates_qc_storage_and_cascades() {
        let conn = open_in_memory().unwrap();
        let reports: i64 = conn.query_row("SELECT COUNT(*) FROM qc_reports", [], |r| r.get(0)).unwrap();
        let settings: i64 = conn.query_row("SELECT COUNT(*) FROM qc_settings", [], |r| r.get(0)).unwrap();
        assert_eq!((reports, settings), (0, 0));
        let index: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_qc_reports_project_asset_created'",
            [], |r| r.get(0)).unwrap();
        assert_eq!(index, 1);
    }

    /// ADR-033: the QC feature was removed but its tables stay. A database written while QC
    /// existed (reports, settings and a repair generation) must still open and list everything.
    #[test]
    fn database_with_legacy_qc_rows_still_opens() {
        use crate::services::tests_support::{open_test_core, test_create_villa, test_import};
        use crate::services::{assets, generations};

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        let (project_id, asset_id) = {
            let (core, _) = open_test_core(&root);
            let p = test_create_villa(&core, "Legacy QC");
            let asset = test_import(&core, tmp.path(), &p.id, "render.png", "regular_image");
            let conn = core.conn().unwrap();
            conn.execute(
                "INSERT INTO qc_reports (id, project_id, asset_id, report_json, result, created_at)
                 VALUES ('QC_01ARZ3NDEKTSV4RRFFQ69G5FAV', ?1, ?2, '{\"result\":\"fail\"}', 'fail', 't')",
                rusqlite::params![p.id, asset.id],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO qc_settings (project_id, settings_json, updated_at) VALUES (?1, '{\"autoQc\":\"after_generation\"}', 't')",
                [&p.id],
            )
            .unwrap();
            let request = serde_json::json!({
                "prompt": { "compilerVersion": "qc-domain", "positivePrompt": "Repair", "negativePrompt": "",
                            "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
                "referenceAssetIds": [asset.id, asset.id],
                "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null,
                            "repair": { "qcReportId": "QC_01ARZ3NDEKTSV4RRFFQ69G5FAV" } }
            });
            conn.execute(
                "INSERT INTO generations (id, project_id, provider_id, model_id, purpose, status, request_json,
                   parent_asset_id, started_at, finished_at, duration_ms, created_at, updated_at)
                 VALUES ('GEN_01ARZ3NDEKTSV4RRFFQ69G5FAV', ?1, 'test_remote', 'full', 'repair', 'completed', ?2,
                   ?3, 't', 't', 5, 't', 't')",
                rusqlite::params![p.id, request.to_string(), asset.id],
            )
            .unwrap();
            (p.id, asset.id)
        }; // core dropped = app closed

        let (core, _) = open_test_core(&root);
        let listed = assets::list(&core, &project_id).unwrap();
        assert_eq!(listed.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), [asset_id.as_str()]);
        let history = generations::list(&core, &project_id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].purpose.as_str(), "repair");
        assert_eq!(
            history[0].params.repair,
            Some(serde_json::json!({ "qcReportId": "QC_01ARZ3NDEKTSV4RRFFQ69G5FAV" }))
        );
        let conn = core.conn().unwrap();
        let kept: (i64, i64) = conn
            .query_row("SELECT (SELECT COUNT(*) FROM qc_reports), (SELECT COUNT(*) FROM qc_settings)", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(kept, (1, 1), "user data in the QC tables is never deleted");
    }

    #[test]
    fn migration_0006_regions_cascade_when_asset_is_deleted() {
        let conn = open_in_memory().unwrap();
        conn.execute("INSERT INTO projects (id,name,project_type,status,created_at,updated_at) VALUES ('PRJ_R','R','villa','draft','t','t')", []).unwrap();
        conn.execute("INSERT INTO project_dna (project_id,schema_version,dna_json,created_at,updated_at) VALUES ('PRJ_R',1,'{}','t','t')", []).unwrap();
        conn.execute("INSERT INTO assets (id,project_id,source,role,status,managed_rel_path,created_at,updated_at) VALUES ('AST_R','PRJ_R','external','regular_image','ready','x','t','t')", []).unwrap();
        conn.execute("INSERT INTO regions (id,project_id,asset_id,label,kind,shape_json,created_at,updated_at) VALUES ('RGN_R','PRJ_R','AST_R','wall','object','{}','t','t')", []).unwrap();
        conn.execute("DELETE FROM assets WHERE id='AST_R'", []).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM regions WHERE id='RGN_R'", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn migration_0009_adds_publications_to_a_v8_database() {
        use crate::services::publications::{self, SaveRequest, TEST_VECTOR};
        use crate::services::tests_support::open_test_core;
        use crate::services::DB_FILE;

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        std::fs::create_dir_all(&root).unwrap();
        {
            // A database as SRS P3 left it: migrations 1–8, one project with history.
            let conn = Connection::open(root.join(DB_FILE)).unwrap();
            configure(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
            )
            .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 8) {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 't0')", [version])
                    .unwrap();
            }
            conn.execute_batch(
                "INSERT INTO projects (id, name, project_type, status, created_at, updated_at)
                   VALUES ('PRJ_V8', 'P3 villa', 'villa', 'draft', 't1', 't1');
                 INSERT INTO project_dna (project_id, schema_version, dna_json, created_at, updated_at)
                   VALUES ('PRJ_V8', 1, '{}', 't1', 't1');",
            )
            .unwrap();
            assert!(!tables(&conn).contains(&"publications".to_string()));
        }

        let (core, _) = open_test_core(&root);
        {
            let conn = core.conn().unwrap();
            assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.last().unwrap().0);
            assert!(tables(&conn).contains(&"publications".to_string()));
            let name: String =
                conn.query_row("SELECT name FROM projects WHERE id = 'PRJ_V8'", [], |r| r.get(0)).unwrap();
            assert_eq!(name, "P3 villa");
        }
        assert!(publications::list(&core, "PRJ_V8").unwrap().is_empty());
        let document: serde_json::Value = serde_json::from_str(TEST_VECTOR).unwrap();
        let saved = publications::save(
            &core,
            SaveRequest {
                project_id: "PRJ_V8".into(),
                publication_id: None,
                publication: document["publication"].clone(),
                facts: document["facts"].clone(),
            },
        )
        .unwrap();
        assert_eq!(publications::list(&core, "PRJ_V8").unwrap()[0].id, saved.id);
    }

    #[test]
    fn migration_0010_adds_user_presets_to_a_v9_database() {
        use crate::services::tests_support::open_test_core;
        use crate::services::{user_presets, DB_FILE};

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        std::fs::create_dir_all(&root).unwrap();
        {
            // A database as ADR-038 left it: migrations 1–9 and one project.
            let conn = Connection::open(root.join(DB_FILE)).unwrap();
            configure(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
            )
            .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 9) {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 't0')", [version])
                    .unwrap();
            }
            conn.execute_batch(
                "INSERT INTO projects (id, name, project_type, status, created_at, updated_at)
                   VALUES ('PRJ_V9', 'P5 villa', 'villa', 'draft', 't1', 't1');",
            )
            .unwrap();
            assert!(!tables(&conn).contains(&"user_presets".to_string()));
        }

        let (core, _) = open_test_core(&root);
        {
            let conn = core.conn().unwrap();
            assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.last().unwrap().0);
            let name: String =
                conn.query_row("SELECT name FROM projects WHERE id = 'PRJ_V9'", [], |r| r.get(0)).unwrap();
            assert_eq!(name, "P5 villa");
        }
        let saved = user_presets::save(
            &core,
            user_presets::SaveRequest { id: None, name: "Night".into(), preset_ids: vec!["time.night".into()] },
        )
        .unwrap();
        assert_eq!(user_presets::list(&core).unwrap(), vec![saved]);
    }

    #[test]
    fn migration_0011_adds_canvas_layouts_to_a_v10_database() {
        use crate::services::tests_support::open_test_core;
        use crate::services::{canvas_layouts, DB_FILE};

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        std::fs::create_dir_all(&root).unwrap();
        {
            // A database as ADR-040 left it: migrations 1–10 and one project.
            let conn = Connection::open(root.join(DB_FILE)).unwrap();
            configure(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
            )
            .unwrap();
            for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 10) {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 't0')", [version])
                    .unwrap();
            }
            conn.execute_batch(
                "INSERT INTO projects (id, name, project_type, status, created_at, updated_at)
                   VALUES ('PRJ_V10', 'M2 villa', 'villa', 'draft', 't1', 't1');",
            )
            .unwrap();
            assert!(!tables(&conn).contains(&"canvas_layouts".to_string()));
        }

        let (core, _) = open_test_core(&root);
        assert_eq!(schema_version(&core.conn().unwrap()).unwrap(), MIGRATIONS.last().unwrap().0);
        let layout = serde_json::json!({ "version": 1, "positions": { "asset:AST_A": { "x": 1, "y": 2 } } });
        canvas_layouts::save(
            &core,
            canvas_layouts::SaveRequest { project_id: "PRJ_V10".into(), layout: layout.clone() },
        )
        .unwrap();
        assert_eq!(canvas_layouts::get(&core, "PRJ_V10").unwrap().layout, layout);
    }

    #[test]
    fn migration_0012_adds_video_tasks_to_an_m4_database() {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")
            .unwrap();
        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= 11) {
            conn.execute_batch(sql).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 't0')", [version]).unwrap();
        }
        assert!(!tables(&conn).contains(&"video_tasks".to_string()));
        migrate(&conn).unwrap();
        assert_eq!(schema_version(&conn).unwrap(), 12);
        assert!(tables(&conn).contains(&"video_tasks".to_string()));
        // A task cannot point at a missing generation.
        let orphan = conn.execute(
            "INSERT INTO video_tasks (generation_id, provider_id, task_json, submitted_at) VALUES ('GEN_X', 'kling', '{}', 't')",
            [],
        );
        assert!(orphan.is_err());
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
    fn migration_0004_backfills_only_projects_with_approved_masters() {
        let conn = Connection::open_in_memory().unwrap();
        configure(&conn).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")
            .unwrap();
        for (version, sql) in MIGRATIONS.iter() {
            if *version <= 3 {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 't0')", [version])
                    .unwrap();
            }
        }
        conn.execute_batch(
            "INSERT INTO projects (id, name, project_type, status, active_master_asset_id, master_approved_at, created_at, updated_at)
               VALUES ('PRJ_APPROVED', 'Approved', 'villa', 'master_approved', 'AST_A', '2026-10-01T00:00:00Z', 't', 't'),
                      ('PRJ_OPEN', 'Open', 'villa', 'draft', NULL, NULL, 't', 't');
             INSERT INTO project_dna (project_id, schema_version, dna_json, created_at, updated_at)
               VALUES ('PRJ_APPROVED', 1, '{}', 't', 't'), ('PRJ_OPEN', 1, '{}', 't', 't');",
        ).unwrap();

        migrate(&conn).unwrap();
        let approved: i64 = conn
            .query_row("SELECT COUNT(*) FROM workflow_steps WHERE project_id = 'PRJ_APPROVED'", [], |r| r.get(0))
            .unwrap();
        let open: i64 = conn
            .query_row("SELECT COUNT(*) FROM workflow_steps WHERE project_id = 'PRJ_OPEN'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(approved, 5);
        assert_eq!(open, 0);
        let status: String = conn
            .query_row(
                "SELECT status FROM workflow_steps WHERE project_id = 'PRJ_APPROVED' AND step_id = 'dna.lighting'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(status, "confirmed");
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
        use crate::services::tests_support::{open_test_core, submit_and_run, write_png};
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

        let g = submit_and_run(
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

    #[test]
    fn upgrades_a_phase_2_database_to_v3_keeping_history_and_queueing_new_work() {
        use crate::domain::GenerationStatus;
        use crate::services::tests_support::{open_test_core, run_queue};
        use crate::services::{generations, queue, DB_FILE};

        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join("data");
        std::fs::create_dir_all(&root).unwrap();
        let dna = test_valid_dna();
        {
            // A database exactly as Phase 2 left it: migrations 1 and 2 applied, one finished
            // generation and one that was running when the app closed.
            let conn = Connection::open(root.join(DB_FILE)).unwrap();
            configure(&conn).unwrap();
            conn.execute_batch(
                "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
            )
            .unwrap();
            for (version, sql) in &MIGRATIONS[..2] {
                conn.execute_batch(sql).unwrap();
                conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 't0')", [version])
                    .unwrap();
            }
            conn.execute_batch(
                "INSERT INTO projects (id, name, project_type, status, active_master_asset_id, master_approved_at, created_at, updated_at)
                   VALUES ('PRJ_V2', 'Phase 2 villa', 'villa', 'master_approved', 'AST_M', 't1', 't1', 't1');
                 INSERT INTO generations (id, project_id, provider_id, model_id, purpose, status, request_json,
                     started_at, finished_at, duration_ms, created_at, updated_at)
                   VALUES ('GEN_OLD', 'PRJ_V2', 'local_preview', 'placeholder-v1', 'hero', 'completed',
                     '{\"prompt\":{\"compilerVersion\":\"1\",\"positivePrompt\":\"p\",\"negativePrompt\":\"\",\"referenceInstructions\":\"\",\"preservationInstructions\":\"\",\"metadata\":{}},\"referenceAssetIds\":[],\"params\":{\"aspectRatio\":null,\"imageSize\":null,\"outputCount\":1,\"seed\":null}}',
                     '2026-05-01T10:00:00.000Z', '2026-05-01T10:00:02.000Z', 2000,
                     '2026-05-01T10:00:00.000Z', '2026-05-01T10:00:02.000Z'),
                          ('GEN_RUN', 'PRJ_V2', 'local_preview', 'placeholder-v1', 'variation', 'running',
                     '{\"prompt\":{\"compilerVersion\":\"1\",\"positivePrompt\":\"p\",\"negativePrompt\":\"\",\"referenceInstructions\":\"\",\"preservationInstructions\":\"\",\"metadata\":{}},\"referenceAssetIds\":[],\"params\":{\"aspectRatio\":null,\"imageSize\":null,\"outputCount\":1,\"seed\":null}}',
                     '2026-05-02T10:00:00.000Z', NULL, NULL, '2026-05-02T10:00:00.000Z', '2026-05-02T10:00:00.000Z');",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO project_dna (project_id, schema_version, dna_json, created_at, updated_at)
                 VALUES ('PRJ_V2', 1, ?1, 't1', 't1')",
                [dna.to_string()],
            )
            .unwrap();
        }

        let (core, _) = open_test_core(&root);
        {
            let conn = core.conn().unwrap();
            assert_eq!(schema_version(&conn).unwrap(), MIGRATIONS.last().unwrap().0);
            let violations: i64 =
                conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
            assert_eq!(violations, 0);
        }
        let history = generations::list(&core, "PRJ_V2").unwrap();
        assert_eq!(history.len(), 2);
        let running = &history[0];
        assert_eq!((running.id.as_str(), running.status), ("GEN_RUN", GenerationStatus::Interrupted));
        let old = &history[1];
        assert_eq!((old.id.as_str(), old.status), ("GEN_OLD", GenerationStatus::Completed));
        assert_eq!(old.started_at.as_deref(), Some("2026-05-01T10:00:00.000Z"), "Phase 2 rows keep their start");
        assert_eq!(old.created_at, "2026-05-01T10:00:00.000Z");
        assert!(old.job_id.is_none() && old.camera_id.is_none() && old.batch_id.is_none());
        assert!(queue::list(&core, None).unwrap().is_empty(), "history rows get no jobs");

        let g = generations::submit(
            &core,
            serde_json::from_value(serde_json::json!({
                "projectId": "PRJ_V2", "providerId": "local_preview", "modelId": "placeholder-v1", "purpose": "hero",
                "prompt": { "compilerVersion": "1", "positivePrompt": "After the upgrade", "negativePrompt": "",
                            "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
                "referenceAssetIds": [],
                "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null }
            }))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(g.status, GenerationStatus::Queued);
        assert!(g.job_id.is_some() && g.started_at.is_none());
        run_queue(&core);
        let done = generations::get(&core, "PRJ_V2", &g.id).unwrap();
        assert_eq!(done.status, GenerationStatus::Completed, "{:?}", done.error);
    }
}
