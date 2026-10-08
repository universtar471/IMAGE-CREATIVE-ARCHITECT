//! Managed local file storage: `<data-root>/projects/<project_id>/...`.
//! The database stores paths relative to the project folder; this module resolves them.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const ORIGINALS_DIR: &str = "assets/original";
pub const DERIVED_DIR: &str = "assets/derived";
pub const PREVIEWS_DIR: &str = "previews";
pub const EXPORTS_DIR: &str = "exports";

#[derive(Debug, Clone)]
pub struct Storage {
    root: PathBuf,
}

impl Storage {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn projects_root(&self) -> PathBuf {
        self.root.join("projects")
    }

    pub fn project_dir(&self, project_id: &str) -> PathBuf {
        self.projects_root().join(project_id)
    }

    pub fn ensure_projects_root(&self) -> AppResult<()> {
        std::fs::create_dir_all(self.projects_root())
            .map_err(|e| AppError::io("Cannot create the projects folder", e))
    }

    /// Create the managed folder layout. Returns true if the project folder was newly created.
    pub fn ensure_project_dirs(&self, project_id: &str) -> AppResult<bool> {
        let dir = self.project_dir(project_id);
        let created = !dir.exists();
        for sub in [ORIGINALS_DIR, DERIVED_DIR, PREVIEWS_DIR, EXPORTS_DIR] {
            std::fs::create_dir_all(dir.join(sub))
                .map_err(|e| AppError::io("Cannot create project folder", e))?;
        }
        Ok(created)
    }

    /// Resolve a stored relative path. Rejects absolute paths and `..` traversal so a
    /// tampered DB row can never point outside the managed project folder.
    pub fn resolve(&self, project_id: &str, rel: &str) -> AppResult<PathBuf> {
        let rel_path = Path::new(rel);
        let safe = rel_path.components().all(|c| matches!(c, Component::Normal(_)));
        if !safe {
            return Err(AppError::validation(format!("Unsafe managed path '{rel}'.")));
        }
        Ok(self.project_dir(project_id).join(rel_path))
    }

    /// True if `path` lies inside this project's managed folder (used before deleting files).
    pub fn is_managed(&self, project_id: &str, path: &Path) -> bool {
        path.starts_with(self.project_dir(project_id))
    }
}

/// Forward-slash relative path for storage in the DB regardless of OS.
pub fn rel(parts: &[&str]) -> String {
    parts.join("/")
}
