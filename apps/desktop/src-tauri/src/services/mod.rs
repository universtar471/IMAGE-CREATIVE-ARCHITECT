//! Application use cases. Each function is small and owns one invariant set;
//! Tauri commands are thin wrappers around these.

pub mod assets;
pub mod dna;
pub mod dna_validation;
pub mod projects;
pub mod status;

use std::path::Path;
use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;

use crate::db;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::repositories::ProjectRow;
use crate::storage::Storage;

pub const DB_FILE: &str = "studio.db";

/// Process-wide application state: one SQLite connection + managed storage.
pub struct AppCore {
    db: Mutex<Connection>,
    pub storage: Storage,
}

impl AppCore {
    pub fn open(data_root: &Path) -> AppResult<Self> {
        let conn = db::open(&data_root.join(DB_FILE))?;
        Ok(Self { db: Mutex::new(conn), storage: Storage::new(data_root) })
    }

    pub fn conn(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.db
            .lock()
            .map_err(|_| AppError::new(ErrorCode::DbError, "Database lock was poisoned; please restart the app."))
    }
}

pub(crate) fn ensure_not_archived(p: &ProjectRow) -> AppResult<()> {
    if p.archived_at.is_some() {
        return Err(AppError::invalid_state(format!(
            "'{}' is archived and read-only. Restore it from the Project Hub before making changes.",
            p.name
        )));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests_support {
    use std::path::{Path, PathBuf};

    use super::AppCore;

    /// Fresh data root + core per test. Keep the TempDir alive for the test's duration.
    pub fn core() -> (tempfile::TempDir, AppCore) {
        let tmp = tempfile::tempdir().unwrap();
        let core = AppCore::open(&tmp.path().join("data")).unwrap();
        (tmp, core)
    }

    pub(crate) use crate::services::dna_validation::tests::minimal as test_valid_dna;
    pub(crate) use crate::services::projects::tests::create_villa as test_create_villa;

    pub fn write_png(dir: &Path, name: &str, w: u32, h: u32, rgb: [u8; 3]) -> PathBuf {
        let path = dir.join(name);
        image::RgbImage::from_pixel(w, h, image::Rgb(rgb)).save(&path).unwrap();
        path
    }
}
