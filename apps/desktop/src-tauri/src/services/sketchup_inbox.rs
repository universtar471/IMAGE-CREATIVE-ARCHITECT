//! SketchUp inbox (M2, ADR-040): views sent by the SketchUp extension
//! (`tools/sketchup/arch_studio_bridge`) land as `<name>.png` plus an optional `<name>.json`
//! sidecar in `<data-root>/inbox/sketchup/`. Nothing is imported until the user picks a view:
//! [`import`] copies it through the normal asset import (source `sketchup`, role
//! `structure_sketch`) and then moves the pair to `imported/`. Sending the same view twice
//! never creates a second asset: the existing one is returned. No model runs here.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::dto::AssetDto;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::repositories as repo;
use crate::services::assets::{self, asset_dto, ImportRequest};
use crate::services::AppCore;

pub const INBOX_DIR: &str = "inbox/sketchup";
pub const IMPORTED_DIR: &str = "imported";
/// Most views one import request may name.
pub const MAX_IMPORT_FILES: usize = 50;

/// What the extension writes next to each PNG. Every field is optional: a missing or broken
/// sidecar only hides the scene details.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Sidecar {
    model: Option<String>,
    scene: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    captured_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxEntry {
    pub file_name: String,
    pub absolute_path: String,
    pub size_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scene: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captured_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxListing {
    /// The folder the extension writes to (shown so the user can check the setup).
    pub path: String,
    pub entries: Vec<InboxEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxImportRequest {
    pub project_id: String,
    pub file_names: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxImportResult {
    /// One asset per requested view, in request order (an existing asset for a duplicate).
    pub assets: Vec<AssetDto>,
    /// How many of them already existed in the project.
    pub duplicates: usize,
}

pub fn inbox_dir(core: &AppCore) -> PathBuf {
    core.storage.root().join(INBOX_DIR)
}

fn is_png(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png"))
}

fn sidecar(png: &Path) -> Sidecar {
    fs::read_to_string(png.with_extension("json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Lists the waiting views, newest first. A missing folder is created (the extension may run
/// before the app ever did).
pub fn list(core: &AppCore) -> AppResult<InboxListing> {
    let dir = inbox_dir(core);
    fs::create_dir_all(&dir).map_err(|e| AppError::io("Cannot create the SketchUp inbox folder", e))?;
    let mut entries: Vec<(std::time::SystemTime, InboxEntry)> = Vec::new();
    for item in fs::read_dir(&dir).map_err(|e| AppError::io("Cannot read the SketchUp inbox folder", e))? {
        let Ok(item) = item else { continue };
        let path = item.path();
        let Ok(meta) = item.metadata() else { continue };
        if !meta.is_file() || !is_png(&path) {
            continue;
        }
        let side = sidecar(&path);
        entries.push((
            meta.modified().unwrap_or(std::time::UNIX_EPOCH),
            InboxEntry {
                file_name: item.file_name().to_string_lossy().into_owned(),
                absolute_path: path.to_string_lossy().into_owned(),
                size_bytes: meta.len(),
                scene: side.scene.filter(|s| !s.trim().is_empty()),
                model: side.model.filter(|s| !s.trim().is_empty()),
                width: side.width,
                height: side.height,
                captured_at: side.captured_at,
            },
        ));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.file_name.cmp(&b.1.file_name)));
    Ok(InboxListing { path: dir.to_string_lossy().into_owned(), entries: entries.into_iter().map(|e| e.1).collect() })
}

/// A plain PNG file name inside the inbox: no folders, no traversal.
fn checked_name(name: &str) -> AppResult<&str> {
    let plain = !name.is_empty()
        && !name.contains(['/', '\\'])
        && name != "."
        && name != ".."
        && !name.contains("..")
        && is_png(Path::new(name));
    if plain {
        Ok(name)
    } else {
        Err(AppError::validation(format!("'{name}' is not a view in the SketchUp inbox.")))
    }
}

/// Moves `from` into `dir`, adding ` (2)`, ` (3)`… when the name is taken. Never overwrites.
fn move_into(from: &Path, dir: &Path) -> AppResult<()> {
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s.to_string(), format!(".{e}")),
        None => (name.clone(), String::new()),
    };
    let mut target = dir.join(&name);
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    fs::rename(from, &target).map_err(|e| AppError::io("Cannot move the imported view", e))
}

pub fn import(core: &AppCore, request: InboxImportRequest) -> AppResult<InboxImportResult> {
    if request.file_names.is_empty() {
        return Err(AppError::validation("Pick at least one view to import."));
    }
    if request.file_names.len() > MAX_IMPORT_FILES {
        return Err(AppError::validation(format!("Import at most {MAX_IMPORT_FILES} views at a time.")));
    }
    let dir = inbox_dir(core);
    let names = request.file_names.iter().map(|n| checked_name(n)).collect::<AppResult<Vec<_>>>()?;
    for name in &names {
        if !dir.join(name).is_file() {
            return Err(AppError::not_found("SketchUp view", name));
        }
    }

    let done_dir = dir.join(IMPORTED_DIR);
    fs::create_dir_all(&done_dir).map_err(|e| AppError::io("Cannot create the imported views folder", e))?;
    let mut result = InboxImportResult { assets: Vec::new(), duplicates: 0 };
    for name in names {
        let png = dir.join(name);
        let imported = assets::import(
            core,
            ImportRequest {
                project_id: request.project_id.clone(),
                source_path: png.to_string_lossy().into_owned(),
                source: "sketchup".into(),
                role: "structure_sketch".into(),
                allow_duplicate: false,
            },
        );
        let asset = match imported {
            Ok(asset) => asset,
            Err(err) if err.code == ErrorCode::DuplicateAsset => {
                let existing_id = err
                    .details
                    .as_ref()
                    .and_then(|d| d.get("existingAssetId"))
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .ok_or_else(|| err.clone())?;
                let conn = core.conn()?;
                let row =
                    repo::find_asset(&conn, &existing_id)?.ok_or_else(|| AppError::not_found("Asset", &existing_id))?;
                result.duplicates += 1;
                asset_dto(&core.storage, &row)?
            }
            Err(err) => return Err(err),
        };
        move_into(&png, &done_dir)?;
        let side = png.with_extension("json");
        if side.is_file() {
            move_into(&side, &done_dir)?;
        }
        result.assets.push(asset);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AssetRole, AssetSource};
    use crate::services::tests_support::{core, test_create_villa_unconfirmed, write_png};

    fn request(project_id: &str, names: &[&str]) -> InboxImportRequest {
        InboxImportRequest { project_id: project_id.into(), file_names: names.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn lists_views_with_their_sidecar_and_tolerates_a_broken_one() {
        let (_tmp, core) = core();
        assert!(list(&core).unwrap().entries.is_empty());
        let dir = inbox_dir(&core);
        write_png(&dir, "front.png", 8, 6, [10, 20, 30]);
        fs::write(
            dir.join("front.json"),
            r#"{"version":1,"model":"C:/p/nha.skp","scene":"Front","width":8,"height":6,"capturedAt":"2026-10-20T08:00:00Z"}"#,
        )
        .unwrap();
        write_png(&dir, "side.png", 8, 6, [40, 20, 30]);
        fs::write(dir.join("side.json"), "{ not json").unwrap();
        fs::write(dir.join("notes.txt"), "ignored").unwrap();

        let listing = list(&core).unwrap();
        assert!(listing.path.ends_with("sketchup"));
        assert_eq!(listing.entries.len(), 2);
        let front = listing.entries.iter().find(|e| e.file_name == "front.png").unwrap();
        assert_eq!(front.scene.as_deref(), Some("Front"));
        assert_eq!((front.width, front.height), (Some(8), Some(6)));
        let side = listing.entries.iter().find(|e| e.file_name == "side.png").unwrap();
        assert_eq!(side.scene, None);
    }

    #[test]
    fn imports_as_structure_sketch_moves_the_pair_and_never_duplicates() {
        let (_tmp, core) = core();
        let project = test_create_villa_unconfirmed(&core, "Inbox");
        let dir = inbox_dir(&core);
        fs::create_dir_all(&dir).unwrap();
        write_png(&dir, "view.png", 8, 6, [10, 90, 30]);
        fs::write(dir.join("view.json"), r#"{"scene":"Street"}"#).unwrap();

        let first = import(&core, request(&project.id, &["view.png"])).unwrap();
        assert_eq!(first.duplicates, 0);
        let asset = &first.assets[0];
        assert_eq!(asset.role, AssetRole::StructureSketch);
        assert_eq!(asset.source, AssetSource::Sketchup);
        assert!(!dir.join("view.png").exists());
        assert!(dir.join(IMPORTED_DIR).join("view.png").is_file());
        assert!(dir.join(IMPORTED_DIR).join("view.json").is_file());
        assert!(list(&core).unwrap().entries.is_empty());

        // The same view sent again: the existing asset comes back, nothing new is stored.
        write_png(&dir, "view.png", 8, 6, [10, 90, 30]);
        let again = import(&core, request(&project.id, &["view.png"])).unwrap();
        assert_eq!(again.duplicates, 1);
        assert_eq!(again.assets[0].id, asset.id);
        assert!(dir.join(IMPORTED_DIR).join("view (2).png").is_file());
        let count: i64 = core
            .conn()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM assets WHERE project_id = ?1", [&project.id], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn refuses_paths_unknown_files_and_empty_requests() {
        let (_tmp, core) = core();
        let project = test_create_villa_unconfirmed(&core, "Inbox");
        for bad in ["../secret.png", "sub/view.png", "a\\b.png", "view.jpg", ""] {
            assert_eq!(
                import(&core, request(&project.id, &[bad])).unwrap_err().code,
                ErrorCode::ValidationError,
                "{bad}"
            );
        }
        assert_eq!(import(&core, request(&project.id, &["gone.png"])).unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(import(&core, request(&project.id, &[])).unwrap_err().code, ErrorCode::ValidationError);
    }
}
