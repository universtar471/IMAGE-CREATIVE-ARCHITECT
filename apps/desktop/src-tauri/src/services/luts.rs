//! Local, read-only LUT indexing and bounded previews.

use std::collections::HashSet;
use std::fs;
use std::io::Cursor;
use std::path::{Component, Path, PathBuf};

use image::{DynamicImage, ImageFormat};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::grade::{self, ColorGrade};
use super::grade_engine::{self, CubeLut};
use super::AppCore;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::repositories;
use crate::util::new_id;

const MAX_FILES: usize = 5000;
const MAX_BYTES: u64 = 64 * 1024 * 1024;
const EXCLUDE: &[&str] = &[
    "food",
    "wedding",
    "portrait",
    "nude",
    "boho",
    "insta",
    "men",
    "rose gold",
    "peach",
    "royal",
    "majestic",
    "bright wedding",
    "rover",
];
const PREFER: &[&str] = &[
    "aerial",
    "drone",
    "urban",
    "city",
    "landscape",
    "scenery",
    "natural",
    "earthy",
    "gray",
    "kodak",
    "film",
    "japan",
    "night",
    "cinematic",
    "moody",
    "teal",
    "travel",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LutSource {
    pub id: String,
    pub path: String,
    pub added_at: String,
    pub last_scan_at: String,
    pub lut_count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LutItem {
    pub id: String,
    pub source_id: String,
    pub rel_path: String,
    pub pack: String,
    pub category: String,
    pub name: String,
    pub size: i64,
    pub is_log: bool,
    pub favorite: bool,
    pub status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub source: LutSource,
    pub added: usize,
    pub invalid: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRequest {
    pub query: Option<String>,
    pub source_id: Option<String>,
    pub pack: Option<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub arch_only: bool,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Serialize)]
pub struct ListResult {
    pub items: Vec<LutItem>,
    pub total: usize,
}

fn strip_prefix(value: &str) -> String {
    let mut value = value.trim();
    while value.starts_with('[') {
        let Some(end) = value.find(']') else { break };
        let inside = &value[1..end];
        if !inside.contains('.') || inside.chars().any(char::is_whitespace) {
            break;
        }
        value = value[end + 1..].trim_start_matches([' ', '-', '_']);
    }
    value.to_string()
}

fn source(core: &AppCore, id: &str) -> AppResult<LutSource> {
    core.conn()?
        .query_row("SELECT id, path, added_at, last_scan_at, lut_count FROM lut_sources WHERE id = ?1", [id], |row| {
            Ok(LutSource {
                id: row.get(0)?,
                path: row.get(1)?,
                added_at: row.get(2)?,
                last_scan_at: row.get(3)?,
                lut_count: row.get(4)?,
            })
        })
        .optional()?
        .ok_or_else(|| AppError::not_found("LUT source", id))
}

/// Every indexed source, oldest first, for the UI source manager.
pub fn list_sources(core: &AppCore) -> AppResult<Vec<LutSource>> {
    let conn = core.conn()?;
    let mut stmt =
        conn.prepare("SELECT id, path, added_at, last_scan_at, lut_count FROM lut_sources ORDER BY added_at, id")?;
    let rows = stmt.query_map([], |row| {
        Ok(LutSource {
            id: row.get(0)?,
            path: row.get(1)?,
            added_at: row.get(2)?,
            last_scan_at: row.get(3)?,
            lut_count: row.get(4)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn safe_file(root: &Path, relative: &str) -> AppResult<PathBuf> {
    if fs::symlink_metadata(root)
        .map_err(|err| AppError::io("Cannot inspect LUT source", err))?
        .file_type()
        .is_symlink()
    {
        return Err(AppError::validation("LUT source symlinks are not allowed."));
    }
    let relative = Path::new(relative);
    if !relative.components().all(|part| matches!(part, Component::Normal(_))) {
        return Err(AppError::validation("Unsafe LUT path."));
    }
    let mut path = root.to_path_buf();
    for part in relative.components() {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(AppError::validation("LUT symlinks are not allowed."))
            }
            Ok(_) => (),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Err(AppError::not_found("LUT file", relative.to_str().unwrap_or("")))
            }
            Err(err) => return Err(AppError::io("Cannot inspect LUT", err)),
        }
    }
    Ok(path)
}

type ScannedLut = (String, String, String, String, i64, bool, String);

fn collect(root: &Path) -> AppResult<Vec<ScannedLut>> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(dir) = pending.pop() {
        for entry in fs::read_dir(&dir).map_err(|err| AppError::io("Cannot scan LUT folder", err))? {
            let entry = entry.map_err(|err| AppError::io("Cannot scan LUT folder", err))?;
            let kind = entry.file_type().map_err(|err| AppError::io("Cannot inspect LUT entry", err))?;
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                pending.push(entry.path());
                continue;
            }
            if !kind.is_file() || !entry.path().extension().is_some_and(|ext| ext.eq_ignore_ascii_case("cube")) {
                continue;
            }
            if files.len() >= MAX_FILES {
                return Err(AppError::validation("LUT folder exceeds 5000 .cube files."));
            }
            let entry_path = entry.path();
            let relative = entry_path.strip_prefix(root).map_err(|_| AppError::validation("Unsafe LUT path."))?;
            let parts: Vec<_> =
                relative.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect();
            let filename = parts.last().expect("file has a name");
            let name = strip_prefix(&filename[..filename.len() - 5]);
            let pack = if parts.len() > 1 { strip_prefix(&parts[0]) } else { String::new() };
            let category = if parts.len() > 1 { strip_prefix(&parts[parts.len() - 2]) } else { String::new() };
            let meta = entry.metadata().map_err(|err| AppError::io("Cannot inspect LUT", err))?;
            let parsed = if meta.len() > MAX_BYTES {
                None
            } else {
                fs::read_to_string(entry.path()).ok().and_then(|text| CubeLut::parse(&text).ok())
            };
            let size = parsed.as_ref().map_or(0, CubeLut::size) as i64;
            let lower = name.to_ascii_lowercase();
            let is_log = lower
                .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '-')
                .any(|word| matches!(word, "log" | "d-log" | "s-log" | "v-log" | "dlog" | "slog" | "vlog"));
            files.push((
                relative.to_string_lossy().replace('\\', "/"),
                pack,
                category,
                name,
                size,
                is_log,
                if parsed.is_some() { "ok" } else { "invalid" }.into(),
            ));
        }
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(files)
}

pub fn add(core: &AppCore, path: &str) -> AppResult<ScanResult> {
    if fs::symlink_metadata(path)
        .map_err(|err| AppError::io("LUT folder does not exist", err))?
        .file_type()
        .is_symlink()
    {
        return Err(AppError::validation("LUT source symlinks are not allowed."));
    }
    let root = fs::canonicalize(path).map_err(|err| AppError::io("LUT folder does not exist", err))?;
    if !root.is_dir() {
        return Err(AppError::validation("LUT source must be a directory."));
    }
    let path = root.to_string_lossy().into_owned();
    if core
        .conn()?
        .query_row("SELECT id FROM lut_sources WHERE path = ?1", [&path], |row| row.get::<_, String>(0))
        .optional()?
        .is_some()
    {
        return Err(AppError::new(ErrorCode::Conflict, "LUT source already exists."));
    }
    let id = new_id("LUTSRC");
    let now = core.now_iso();
    core.conn()?.execute(
        "INSERT INTO lut_sources (id, path, added_at, last_scan_at, lut_count) VALUES (?1, ?2, ?3, ?3, 0)",
        params![id, path, now],
    )?;
    match rescan(core, &id) {
        Ok(result) => Ok(result),
        Err(err) => {
            core.conn()?.execute("DELETE FROM lut_sources WHERE id=?1", [&id])?;
            Err(err)
        }
    }
}

pub fn rescan(core: &AppCore, id: &str) -> AppResult<ScanResult> {
    let original = source(core, id)?;
    let root = Path::new(&original.path);
    if !root.is_dir() {
        return Err(AppError::not_found("LUT source folder", id));
    }
    if fs::symlink_metadata(root)
        .map_err(|err| AppError::io("Cannot inspect LUT source", err))?
        .file_type()
        .is_symlink()
    {
        return Err(AppError::validation("LUT source symlinks are not allowed."));
    }
    let files = collect(root)?;
    let mut conn = core.conn()?;
    let tx = conn.transaction()?;
    let mut seen = HashSet::new();
    let mut added = 0;
    let mut invalid = 0;
    for (relative, pack, category, name, size, is_log, status) in files {
        if status == "invalid" {
            invalid += 1;
        }
        seen.insert(relative.clone());
        let existing: Option<String> = tx
            .query_row("SELECT id FROM luts WHERE source_id = ?1 AND rel_path = ?2", params![id, relative], |row| {
                row.get(0)
            })
            .optional()?;
        if let Some(existing) = existing {
            tx.execute(
                "UPDATE luts SET pack=?2, category=?3, name=?4, size=?5, is_log=?6, status=?7 WHERE id=?1",
                params![existing, pack, category, name, size, is_log, status],
            )?;
        } else {
            tx.execute("INSERT INTO luts (id, source_id, rel_path, pack, category, name, size, is_log, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)", params![new_id("LUT"), id, relative, pack, category, name, size, is_log, status])?;
            added += 1;
        }
    }
    let mut stmt = tx.prepare("SELECT id, rel_path FROM luts WHERE source_id = ?1")?;
    let known: Vec<(String, String)> =
        stmt.query_map([id], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
    drop(stmt);
    for (lut_id, relative) in known {
        if !seen.contains(&relative) {
            tx.execute("UPDATE luts SET status = 'missing' WHERE id = ?1", [lut_id])?;
        }
    }
    let count: i64 = tx.query_row("SELECT COUNT(*) FROM luts WHERE source_id=?1", [id], |row| row.get(0))?;
    tx.execute("UPDATE lut_sources SET last_scan_at=?2, lut_count=?3 WHERE id=?1", params![id, core.now_iso(), count])?;
    tx.commit()?;
    drop(conn);
    Ok(ScanResult { source: source(core, id)?, added, invalid })
}

pub fn remove(core: &AppCore, id: &str) -> AppResult<()> {
    source(core, id)?;
    let ids: Vec<String> = {
        let conn = core.conn()?;
        let mut stmt = conn.prepare("SELECT id FROM luts WHERE source_id=?1")?;
        let rows = stmt.query_map([id], |row| row.get(0))?.collect::<Result<_, _>>()?;
        rows
    };
    core.conn()?.execute("DELETE FROM lut_sources WHERE id=?1", [id])?;
    let cache = core.storage.root().join("cache/lut_previews");
    if cache.exists() {
        for asset in fs::read_dir(cache).map_err(|err| AppError::io("Cannot inspect preview cache", err))? {
            let asset = asset.map_err(|err| AppError::io("Cannot inspect preview cache", err))?;
            if !asset.file_type().map_err(|err| AppError::io("Cannot inspect preview cache", err))?.is_dir() {
                continue;
            }
            for lut_id in &ids {
                for preview in
                    fs::read_dir(asset.path()).map_err(|err| AppError::io("Cannot inspect preview cache", err))?
                {
                    let preview = preview.map_err(|err| AppError::io("Cannot inspect preview cache", err))?;
                    if preview.file_name().to_string_lossy().starts_with(&format!("{lut_id}_"))
                        && preview
                            .file_type()
                            .map_err(|err| AppError::io("Cannot inspect preview cache", err))?
                            .is_file()
                    {
                        fs::remove_file(preview.path()).map_err(|err| AppError::io("Cannot remove preview", err))?;
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn list(core: &AppCore, request: ListRequest) -> AppResult<ListResult> {
    if !(1..=5000).contains(&request.limit) || request.offset < 0 {
        return Err(AppError::validation("Invalid LUT pagination."));
    }
    let conn = core.conn()?;
    let mut stmt = conn.prepare("SELECT id, source_id, rel_path, pack, category, name, size, is_log, favorite, status FROM luts ORDER BY name COLLATE NOCASE, id")?;
    let rows = stmt.query_map([], |row| {
        Ok(LutItem {
            id: row.get(0)?,
            source_id: row.get(1)?,
            rel_path: row.get(2)?,
            pack: row.get(3)?,
            category: row.get(4)?,
            name: row.get(5)?,
            size: row.get(6)?,
            is_log: row.get(7)?,
            favorite: row.get(8)?,
            status: row.get(9)?,
        })
    })?;
    let query = request.query.unwrap_or_default().to_lowercase();
    let mut items: Vec<LutItem> = rows
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .filter(|item| {
            (query.is_empty() || item.name.to_lowercase().contains(&query))
                && request.source_id.as_ref().is_none_or(|value| &item.source_id == value)
                && request.pack.as_ref().is_none_or(|value| &item.pack == value)
                && request.category.as_ref().is_none_or(|value| &item.category == value)
                && (!request.favorites_only || item.favorite)
                && (!request.arch_only || {
                    let category = item.category.to_lowercase();
                    !EXCLUDE.iter().any(|word| category.contains(word))
                })
        })
        .collect();
    if request.arch_only {
        items.sort_by_key(|item| !PREFER.iter().any(|word| item.category.to_lowercase().contains(word)));
    }
    let total = items.len();
    Ok(ListResult {
        items: items.into_iter().skip(request.offset as usize).take(request.limit as usize).collect(),
        total,
    })
}

pub fn set_favorite(core: &AppCore, id: &str, favorite: bool) -> AppResult<()> {
    if core.conn()?.execute("UPDATE luts SET favorite=?2 WHERE id=?1", params![id, favorite])? == 0 {
        return Err(AppError::not_found("LUT", id));
    }
    Ok(())
}

pub fn load(core: &AppCore, id: &str) -> AppResult<CubeLut> {
    let path = resolve_path(core, id)?;
    if fs::metadata(&path).map_err(|err| AppError::io("Cannot inspect LUT", err))?.len() > MAX_BYTES {
        return Err(AppError::validation("LUT file exceeds 64 MB."));
    }
    let text = fs::read_to_string(path).map_err(|err| AppError::io("Cannot read LUT", err))?;
    CubeLut::parse(&text).map_err(AppError::validation)
}

fn resolve_path(core: &AppCore, id: &str) -> AppResult<PathBuf> {
    let (root, relative): (String, String) = core
        .conn()?
        .query_row(
            "SELECT s.path, l.rel_path FROM luts l JOIN lut_sources s ON s.id=l.source_id WHERE l.id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::not_found("LUT", id))?;
    match safe_file(Path::new(&root), &relative) {
        Ok(path) => Ok(path),
        Err(err) => {
            if err.code == ErrorCode::NotFound {
                core.conn()?.execute("UPDATE luts SET status='missing' WHERE id=?1", [id])?;
            }
            Err(err)
        }
    }
}

fn asset_image(core: &AppCore, asset_id: &str, size: u32) -> AppResult<(DynamicImage, String)> {
    let asset =
        repositories::find_asset(&*core.conn()?, asset_id)?.ok_or_else(|| AppError::not_found("Asset", asset_id))?;
    if asset.status != "ready" || !asset.mime_type.as_deref().is_some_and(|mime| mime.starts_with("image/")) {
        return Err(AppError::validation("Asset must be a ready image."));
    }
    let path = core.storage.resolve(&asset.project_id, &asset.managed_rel_path)?;
    let image =
        image::open(path).map_err(|err| AppError::new(ErrorCode::IoError, format!("Cannot open asset: {err}")))?;
    let hash = asset.sha256.ok_or_else(|| AppError::validation("Asset is missing SHA-256."))?;
    if hash.is_empty() || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return Err(AppError::validation("Invalid asset SHA-256."));
    }
    let longest = image.width().max(image.height());
    let scaled = image.resize(
        (image.width() as f64 * size as f64 / longest as f64).round().max(1.0) as u32,
        (image.height() as f64 * size as f64 / longest as f64).round().max(1.0) as u32,
        image::imageops::FilterType::Lanczos3,
    );
    Ok((scaled, hash))
}

fn jpeg(image: image::RgbaImage) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    DynamicImage::ImageRgba8(image)
        .to_rgb8()
        .write_to(&mut Cursor::new(&mut bytes), ImageFormat::Jpeg)
        .map_err(|err| AppError::new(ErrorCode::IoError, format!("Cannot encode JPEG: {err}")))?;
    Ok(bytes)
}

pub fn preview(core: &AppCore, lut_id: &str, asset_id: &str, size: Option<u32>) -> AppResult<Vec<u8>> {
    let size = size.unwrap_or(256);
    if !(1..=512).contains(&size) {
        return Err(AppError::validation("LUT preview size must be 1..512."));
    }
    let path = resolve_path(core, lut_id)?;
    let (image, hash) = asset_image(core, asset_id, size)?;
    let cache = core.storage.root().join("cache/lut_previews").join(hash).join(format!("{lut_id}_{size}.jpg"));
    if cache.exists() {
        return fs::read(cache).map_err(|err| AppError::io("Cannot read preview", err));
    }
    if fs::metadata(&path).map_err(|err| AppError::io("Cannot inspect LUT", err))?.len() > MAX_BYTES {
        return Err(AppError::validation("LUT file exceeds 64 MB."));
    }
    let text = fs::read_to_string(path).map_err(|err| AppError::io("Cannot read LUT", err))?;
    let lut = match CubeLut::parse(&text) {
        Ok(lut) => lut,
        Err(err) => {
            core.conn()?.execute("UPDATE luts SET status='invalid' WHERE id=?1", [lut_id])?;
            return Err(AppError::validation(err));
        }
    };
    let grade: ColorGrade = serde_json::from_value(serde_json::json!({"schemaVersion": 1}))
        .map_err(|err| AppError::validation(err.to_string()))?;
    let bytes = jpeg(grade_engine::render_with_lut(&image, &grade, Some(&lut)))?;
    fs::create_dir_all(cache.parent().expect("cache has parent"))
        .map_err(|err| AppError::io("Cannot create preview cache", err))?;
    fs::write(cache, &bytes).map_err(|err| AppError::io("Cannot cache preview", err))?;
    Ok(bytes)
}

pub fn grade_preview(
    core: &AppCore,
    project_id: &str,
    asset_id: &str,
    grade: &ColorGrade,
    size: Option<u32>,
) -> AppResult<Vec<u8>> {
    grade::validate_grade(grade)?;
    let size = size.unwrap_or(640);
    if !(1..=640).contains(&size) {
        return Err(AppError::validation("Grade preview size must be 1..640."));
    }
    let asset =
        repositories::find_asset(&*core.conn()?, asset_id)?.ok_or_else(|| AppError::not_found("Asset", asset_id))?;
    if asset.project_id != project_id {
        return Err(AppError::not_found("Asset", asset_id));
    }
    let (image, _) = asset_image(core, asset_id, size)?;
    let lut = grade.lut.as_ref().map(|item| load(core, &item.lut_id)).transpose()?;
    jpeg(grade_engine::render_with_lut(&image, grade, lut.as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::assets::{self, ImportRequest};
    use crate::services::tests_support::{open_test_core, test_create_villa, write_png};

    fn cube() -> String {
        let mut text = "TITLE identity\nLUT_3D_SIZE 2\n".to_string();
        for blue in 0..2 {
            for green in 0..2 {
                for red in 0..2 {
                    text.push_str(&format!("{red} {green} {blue}\n"));
                }
            }
        }
        text
    }

    fn request() -> ListRequest {
        ListRequest {
            query: None,
            source_id: None,
            pack: None,
            category: None,
            favorites_only: false,
            arch_only: false,
            limit: 10,
            offset: 0,
        }
    }

    #[test]
    fn indexes_nested_packs_filters_pages_and_keeps_user_files() {
        let temp = tempfile::tempdir().unwrap();
        let (core, _) = open_test_core(temp.path());
        let root = temp.path().join("user_luts");
        let urban = root.join("[site.com] Urban").join("[site.com] aerial");
        let food = root.join("Food").join("wedding");
        fs::create_dir_all(&urban).unwrap();
        fs::create_dir_all(&food).unwrap();
        fs::write(urban.join("[site.com] Sky.cube"), cube()).unwrap();
        fs::write(food.join("Dinner.cube"), cube()).unwrap();
        fs::write(root.join("bad.cube"), "LUT_3D_SIZE 2\n0 0 0").unwrap();
        fs::write(root.join("ignore.txt"), cube()).unwrap();
        let scanned = add(&core, root.to_str().unwrap()).unwrap();
        assert_eq!((scanned.added, scanned.invalid), (3, 1));
        let sources = list_sources(&core).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].id, scanned.source.id);
        let mut all = list(&core, request()).unwrap();
        assert_eq!(all.total, 3);
        assert_eq!(all.items.iter().find(|item| item.name == "Sky").unwrap().pack, "Urban");
        assert_eq!(all.items.iter().find(|item| item.name == "Sky").unwrap().category, "aerial");
        assert_eq!(all.items.iter().find(|item| item.name == "bad").unwrap().status, "invalid");
        let mut filtered = request();
        filtered.arch_only = true;
        assert_eq!(list(&core, filtered).unwrap().total, 2);
        let sky = all.items.iter().find(|item| item.name == "Sky").unwrap().id.clone();
        set_favorite(&core, &sky, true).unwrap();
        let mut page = request();
        page.favorites_only = true;
        page.limit = 1;
        assert_eq!(list(&core, page).unwrap().total, 1);
        let mut page = request();
        page.limit = 1;
        page.offset = 1;
        assert_eq!(list(&core, page).unwrap().items.len(), 1);
        assert_eq!(rescan(&core, &scanned.source.id).unwrap().added, 0);
        assert!(load(&core, "../../outside.cube").is_err());
        fs::remove_file(urban.join("[site.com] Sky.cube")).unwrap();
        assert_eq!(load(&core, &sky).unwrap_err().code, ErrorCode::NotFound);
        all = list(&core, request()).unwrap();
        assert_eq!(all.items.iter().find(|item| item.id == sky).unwrap().status, "missing");
        remove(&core, &scanned.source.id).unwrap();
        assert!(list_sources(&core).unwrap().is_empty());
        assert!(food.join("Dinner.cube").exists());
        assert!(root.join("bad.cube").exists());
        assert_eq!(list(&core, request()).unwrap().total, 0);
    }

    #[test]
    fn preview_cache_hit_and_missing_file() {
        let temp = tempfile::tempdir().unwrap();
        let (core, _) = open_test_core(temp.path());
        let project = test_create_villa(&core, "LUT preview");
        let asset = assets::import(
            &core,
            ImportRequest {
                project_id: project.id.clone(),
                source_path: write_png(temp.path(), "image.png", 16, 8, [20, 40, 80]).to_string_lossy().into_owned(),
                source: "external".into(),
                role: "regular_image".into(),
                allow_duplicate: true,
            },
        )
        .unwrap();
        let root = temp.path().join("luts");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("identity.cube");
        fs::write(&path, cube()).unwrap();
        let scanned = add(&core, root.to_str().unwrap()).unwrap();
        let id = list(&core, request()).unwrap().items.remove(0).id;
        let first = preview(&core, &id, &asset.id, None).unwrap();
        assert!(first.starts_with(&[0xff, 0xd8]));
        let grade: ColorGrade = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1, "lut": {"lutId": "../../identity.cube", "strength": 100}
        }))
        .unwrap();
        assert_eq!(grade_preview(&core, &project.id, &asset.id, &grade, None).unwrap_err().code, ErrorCode::NotFound);
        fs::write(&path, "LUT_3D_SIZE 2\ninvalid").unwrap();
        assert_eq!(first, preview(&core, &id, &asset.id, None).unwrap());
        fs::remove_file(path).unwrap();
        assert_eq!(preview(&core, &id, &asset.id, None).unwrap_err().code, ErrorCode::NotFound);
        remove(&core, &scanned.source.id).unwrap();
    }
}
