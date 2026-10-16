//! Diagram Studio exports (ADR-037).
//!
//! - `save_image`: a sheet or frame rasterized in the webview becomes a new asset derived
//!   from the source render (`parent_asset_id`), written through the same managed-storage
//!   path as imports (verified copy, thumbnail, asset + version rows in one transaction).
//! - `export_video`: approved step frames → MP4 with FFmpeg found on PATH (pan, zoom and
//!   appear). FFmpeg is never bundled; when it is missing the command fails with a clear
//!   `INVALID_STATE` whose details carry `reason: "ffmpeg_missing"`.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::domain::AssetRole;
use crate::dto::AssetDto;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::imaging::{self, SupportedFormat, MAX_IMPORT_BYTES};
use crate::repositories::{self as repo, AssetRow, VersionRow};
use crate::services::assets::{asset_dto, store_managed_image, Thumbnail};
use crate::services::{ensure_not_archived, AppCore};
use crate::storage::EXPORTS_DIR;
use crate::util::{new_id, prefix};

/// The program looked up on PATH.
pub const FFMPEG_PROGRAM: &str = "ffmpeg";
pub const MAX_VIDEO_FRAMES: usize = 12;

// ---------------------------------------------------------------- image save

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSaveRequest {
    pub project_id: String,
    pub parent_asset_id: String,
    /// PNG bytes, base64 (no `data:` prefix).
    pub png_base64: String,
    pub label: String,
    /// `sheet` | `frame`.
    pub kind: String,
    #[serde(default)]
    pub meta: Map<String, Value>,
}

pub fn save_image(core: &AppCore, request: ImageSaveRequest) -> AppResult<AssetDto> {
    let operation = match request.kind.as_str() {
        "sheet" => "diagram_sheet",
        "frame" => "diagram_frame",
        other => return Err(AppError::validation(format!("Unknown diagram image kind '{other}'."))),
    };
    let label = request.label.trim();
    if label.is_empty() || label.chars().count() > 200 {
        return Err(AppError::validation("A diagram image needs a label of at most 200 characters."));
    }
    // Base64 is 4/3 of the bytes: refuse oversized payloads before decoding them.
    if request.png_base64.len() as u64 > MAX_IMPORT_BYTES / 3 * 4 + 4 {
        return Err(AppError::new(ErrorCode::UnsupportedFile, "The diagram image is too large."));
    }
    let bytes = B64
        .decode(request.png_base64.trim())
        .map_err(|e| AppError::validation(format!("The diagram image is not valid base64: {e}")))?;
    let info = imaging::inspect(&bytes, "diagram image")?;
    if info.format != SupportedFormat::Png {
        return Err(AppError::new(ErrorCode::UnsupportedFile, "A diagram image must be a PNG."));
    }
    let decoded = imaging::decode(&bytes, info.format)
        .map_err(|e| AppError::new(ErrorCode::UnsupportedFile, format!("The diagram image cannot be decoded: {e}")))?;

    // The parent must be a ready asset of this project (lineage never crosses projects).
    let parent = {
        let conn = core.conn()?;
        ensure_not_archived(&repo::get_project(&conn, &request.project_id)?)?;
        let parent = repo::find_asset(&conn, &request.parent_asset_id)?
            .filter(|a| a.project_id == request.project_id)
            .ok_or_else(|| AppError::not_found("Asset", &request.parent_asset_id))?;
        if parent.status != "ready" {
            return Err(AppError::invalid_state("The source render is not ready."));
        }
        parent
    };

    let asset_id = new_id(prefix::ASSET);
    let stored = store_managed_image(
        &core.storage,
        &request.project_id,
        &asset_id,
        &bytes,
        &info,
        Thumbnail::Required(&decoded),
    )?;
    let mut meta = request.meta;
    meta.insert("kind".into(), json!(request.kind));
    let operation_json = Value::Object(meta).to_string();
    let now = core.now_iso();
    let result = (|| -> AppResult<AssetRow> {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        ensure_not_archived(&repo::get_project(&tx, &request.project_id)?)?;
        let parent_version_id = repo::latest_version_id(&tx, &parent.id)?;
        let row = AssetRow {
            id: asset_id.clone(),
            project_id: request.project_id.clone(),
            source: parent.source,
            role: AssetRole::RegularImage,
            status: "ready".into(),
            original_name: Some(label.to_string()),
            managed_rel_path: stored.managed_rel.clone(),
            thumbnail_rel_path: stored.thumbnail_rel.clone(),
            mime_type: Some(info.format.mime().into()),
            file_size_bytes: Some(info.size_bytes as i64),
            width_px: Some(info.width as i64),
            height_px: Some(info.height as i64),
            sha256: Some(info.sha256.clone()),
            parent_asset_id: Some(parent.id.clone()),
            operation: Some(operation.into()),
            operation_json: Some(operation_json.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        repo::insert_asset(&tx, &row)?;
        repo::insert_version(
            &tx,
            &VersionRow {
                id: new_id(prefix::VERSION),
                project_id: request.project_id.clone(),
                asset_id: asset_id.clone(),
                parent_version_id,
                label: Some(label.to_string()),
                operation: operation.into(),
                operation_json: Some(operation_json),
                generation_id: None,
                created_at: now,
            },
        )?;
        tx.commit()?;
        Ok(row)
    })();
    match result {
        Ok(row) => asset_dto(&core.storage, &row),
        Err(err) => {
            stored.remove_files();
            Err(err)
        }
    }
}

// ---------------------------------------------------------------- FFmpeg

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    pub version: Option<String>,
}

fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: no console flashes up from the desktop app.
        cmd.creation_flags(0x0800_0000);
    }
    cmd
}

/// `ffmpeg -version` on PATH (or `program`); never fails, missing = `available: false`.
pub fn ffmpeg_status_of(program: &str) -> FfmpegStatus {
    match command(program).arg("-version").output() {
        Ok(out) if out.status.success() => FfmpegStatus {
            available: true,
            version: String::from_utf8_lossy(&out.stdout).lines().next().map(|l| l.trim().to_string()),
        },
        _ => FfmpegStatus { available: false, version: None },
    }
}

pub fn ffmpeg_status() -> FfmpegStatus {
    ffmpeg_status_of(FFMPEG_PROGRAM)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Motion {
    Appear,
    Zoom,
    Pan,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFrame {
    pub path: String,
    pub duration_ms: u32,
    pub motion: Motion,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoExportRequest {
    pub project_id: String,
    pub frames: Vec<VideoFrame>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoExportResult {
    pub path: String,
    pub duration_ms: u64,
    pub frame_count: usize,
}

/// Frames of output for one step (at least one).
fn frame_count(duration_ms: u32, fps: u32) -> u64 {
    ((duration_ms as u64 * fps as u64 + 500) / 1000).max(1)
}

/// The zoompan + fade chain of one input, scaled and padded to the output size first.
/// The input is upscaled 2× before zoompan so slow moves do not jitter.
fn motion_filter(index: usize, frame: &VideoFrame, width: u32, height: u32, fps: u32) -> String {
    let n = frame_count(frame.duration_ms, fps);
    let (w2, h2) = (width * 2, height * 2);
    let fit = format!(
        "scale={w2}:{h2}:force_original_aspect_ratio=decrease,pad={w2}:{h2}:(ow-iw)/2:(oh-ih)/2:color=0xF6F5F1,setsar=1"
    );
    let span = n.saturating_sub(1).max(1);
    let zoompan = match frame.motion {
        Motion::Appear => format!("zoompan=z=1:d={n}:s={width}x{height}:fps={fps}"),
        Motion::Zoom => format!(
            "zoompan=z='1+0.08*on/{span}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={width}x{height}:fps={fps}"
        ),
        Motion::Pan => {
            format!("zoompan=z=1.08:x='(iw-iw/zoom)*on/{span}':y='ih/2-(ih/zoom/2)':d={n}:s={width}x{height}:fps={fps}")
        }
    };
    let fade = if frame.motion == Motion::Appear { ",fade=t=in:st=0:d=0.6" } else { "" };
    format!("[{index}:v]{fit},{zoompan}{fade},format=yuv420p[v{index}]")
}

/// Arguments of the FFmpeg run (no shell; each element is one argv entry).
pub fn build_ffmpeg_args(frames: &[VideoFrame], width: u32, height: u32, fps: u32, output: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-hide_banner", "-loglevel", "error", "-y"].iter().map(|s| s.to_string()).collect();
    for frame in frames {
        args.push("-i".into());
        args.push(frame.path.clone());
    }
    let mut graph: Vec<String> =
        frames.iter().enumerate().map(|(i, f)| motion_filter(i, f, width, height, fps)).collect();
    let inputs: String = (0..frames.len()).map(|i| format!("[v{i}]")).collect();
    graph.push(format!("{inputs}concat=n={}:v=1:a=0[out]", frames.len()));
    args.extend([
        "-filter_complex".to_string(),
        graph.join(";"),
        "-map".into(),
        "[out]".into(),
        "-c:v".into(),
        "libx264".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        "-r".into(),
        fps.to_string(),
        "-movflags".into(),
        "+faststart".into(),
        output.to_string_lossy().into_owned(),
    ]);
    args
}

fn validate_video(core: &AppCore, request: &VideoExportRequest) -> AppResult<Vec<PathBuf>> {
    if request.frames.is_empty() || request.frames.len() > MAX_VIDEO_FRAMES {
        return Err(AppError::validation(format!("A diagram video needs 1 to {MAX_VIDEO_FRAMES} frames.")));
    }
    if !(320..=3840).contains(&request.width) || !(240..=2160).contains(&request.height) {
        return Err(AppError::validation("The video size must be between 320×240 and 3840×2160."));
    }
    if !request.width.is_multiple_of(2) || !request.height.is_multiple_of(2) {
        return Err(AppError::validation("The video width and height must be even."));
    }
    if !(12..=60).contains(&request.fps) {
        return Err(AppError::validation("The frame rate must be between 12 and 60."));
    }
    {
        let conn = core.conn()?;
        ensure_not_archived(&repo::get_project(&conn, &request.project_id)?)?;
    }
    request
        .frames
        .iter()
        .map(|frame| {
            if !(500..=20_000).contains(&frame.duration_ms) {
                return Err(AppError::validation("Each frame lasts between 0.5 and 20 seconds."));
            }
            let path = PathBuf::from(&frame.path);
            let traversal = path.components().any(|c| matches!(c, Component::ParentDir));
            if traversal || !core.storage.is_managed(&request.project_id, &path) {
                return Err(AppError::validation("Video frames must be files of this project."));
            }
            if !path.is_file() {
                return Err(AppError::invalid_state(format!("The frame '{}' is missing.", frame.path)));
            }
            Ok(path)
        })
        .collect()
}

fn ffmpeg_missing() -> AppError {
    AppError::invalid_state("FFmpeg is not installed or not on PATH. Install FFmpeg to export the video.")
        .with_details(json!({ "reason": "ffmpeg_missing" }))
}

/// Build the MP4 into the project's `exports/` folder with `program` (FFmpeg on PATH).
pub fn export_video_with(core: &AppCore, request: VideoExportRequest, program: &str) -> AppResult<VideoExportResult> {
    validate_video(core, &request)?;
    if !ffmpeg_status_of(program).available {
        return Err(ffmpeg_missing());
    }
    core.storage.ensure_project_dirs(&request.project_id)?;
    let file_name = format!("diagram_{}.mp4", new_id("DGV"));
    let output = core.storage.project_dir(&request.project_id).join(EXPORTS_DIR).join(file_name);
    let args = build_ffmpeg_args(&request.frames, request.width, request.height, request.fps, &output);
    let run = command(program).args(&args).output();
    let out = match run {
        Ok(out) => out,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(ffmpeg_missing()),
        Err(e) => return Err(AppError::io("Could not start FFmpeg", e)),
    };
    if !out.status.success() || !output.is_file() {
        let _ = fs::remove_file(&output);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(AppError::new(ErrorCode::IoError, "FFmpeg could not build the video.")
            .with_details(json!({ "reason": "ffmpeg_failed", "stderr": tail.join("\n") })));
    }
    let duration_ms = request.frames.iter().map(|f| f.duration_ms as u64).sum();
    Ok(VideoExportResult {
        path: output.to_string_lossy().into_owned(),
        duration_ms,
        frame_count: request.frames.len(),
    })
}

pub fn export_video(core: &AppCore, request: VideoExportRequest) -> AppResult<VideoExportResult> {
    export_video_with(core, request, FFMPEG_PROGRAM)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::services::tests_support::{core, test_create_villa, test_import};
    use std::io::Cursor;

    pub(crate) const MISSING_PROGRAM: &str = "arch-studio-no-such-ffmpeg";

    pub(crate) fn png_base64(w: u32, h: u32, rgb: [u8; 3]) -> String {
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(w, h, image::Rgb(rgb)))
            .write_to(&mut Cursor::new(&mut bytes), image::ImageFormat::Png)
            .unwrap();
        B64.encode(bytes)
    }

    pub(crate) fn save_request(project_id: &str, parent: &str, kind: &str, rgb: [u8; 3]) -> ImageSaveRequest {
        ImageSaveRequest {
            project_id: project_id.into(),
            parent_asset_id: parent.into(),
            png_base64: png_base64(64, 36, rgb),
            label: format!("Diagram {kind}"),
            kind: kind.into(),
            meta: serde_json::from_value(json!({ "type": "concept_evolution", "layout": "2x3", "lang": "vi" }))
                .unwrap(),
        }
    }

    fn frame(path: &str, motion: Motion) -> VideoFrame {
        VideoFrame { path: path.into(), duration_ms: 1000, motion }
    }

    #[test]
    fn saved_sheet_keeps_lineage_and_a_version() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "Diagram");
        let source = test_import(&core, tmp.path(), &p.id, "render.png", "master_architecture");
        let sheet = save_image(&core, save_request(&p.id, &source.id, "sheet", [10, 20, 30])).unwrap();
        assert_eq!(sheet.parent_asset_id.as_deref(), Some(source.id.as_str()));
        assert_eq!(sheet.operation.as_deref(), Some("diagram_sheet"));
        assert_eq!((sheet.width_px, sheet.height_px), (Some(64), Some(36)));
        assert!(Path::new(&sheet.absolute_path).is_file());
        let versions = crate::services::assets::list_versions(&core, &p.id).unwrap();
        let v = versions.iter().find(|v| v.asset_id == sheet.id).unwrap();
        assert_eq!(v.operation, "diagram_sheet");
        assert!(v.parent_version_id.is_some());
    }

    #[test]
    fn save_refuses_bad_payloads_and_foreign_parents() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "Diagram");
        let other = test_create_villa(&core, "Other");
        let source = test_import(&core, tmp.path(), &p.id, "render.png", "regular_image");
        let mut bad = save_request(&p.id, &source.id, "poster", [1, 2, 3]);
        assert_eq!(save_image(&core, bad).unwrap_err().code, ErrorCode::ValidationError);
        bad = save_request(&p.id, &source.id, "sheet", [1, 2, 3]);
        bad.png_base64 = "not base64!".into();
        assert_eq!(save_image(&core, bad).unwrap_err().code, ErrorCode::ValidationError);
        bad = save_request(&p.id, &source.id, "sheet", [1, 2, 3]);
        bad.png_base64 = B64.encode(b"<svg/>");
        assert_eq!(save_image(&core, bad).unwrap_err().code, ErrorCode::UnsupportedFile);
        let foreign = save_request(&other.id, &source.id, "sheet", [1, 2, 3]);
        assert_eq!(save_image(&core, foreign).unwrap_err().code, ErrorCode::NotFound);
    }

    #[test]
    fn builds_one_input_and_one_motion_chain_per_frame() {
        let frames = [frame("a.png", Motion::Appear), frame("b.png", Motion::Zoom), frame("c.png", Motion::Pan)];
        let args = build_ffmpeg_args(&frames, 1920, 1080, 30, Path::new("out.mp4"));
        let inputs: Vec<&String> = args.iter().skip_while(|a| *a != "-i").step_by(2).take(3).collect();
        assert_eq!(inputs.len(), 3);
        assert_eq!(args.iter().filter(|a| *a == "-i").count(), 3);
        let graph = &args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(graph.contains("[0:v]") && graph.contains("[1:v]") && graph.contains("[2:v]"));
        assert!(graph.contains("fade=t=in"));
        assert!(graph.contains("zoompan=z='1+0.08*on/29'"));
        assert!(graph.contains("x='(iw-iw/zoom)*on/29'"));
        assert!(graph.contains("d=30:s=1920x1080:fps=30"));
        assert!(graph.ends_with("[v0][v1][v2]concat=n=3:v=1:a=0[out]"));
        assert_eq!(args.last().map(String::as_str), Some("out.mp4"));
        assert!(args.windows(2).any(|w| w[0] == "-c:v" && w[1] == "libx264"));
        assert!(args.windows(2).any(|w| w[0] == "-pix_fmt" && w[1] == "yuv420p"));
    }

    #[test]
    fn missing_ffmpeg_is_reported_clearly() {
        assert_eq!(ffmpeg_status_of(MISSING_PROGRAM), FfmpegStatus { available: false, version: None });
        let (tmp, core) = core();
        let p = test_create_villa(&core, "Diagram");
        let source = test_import(&core, tmp.path(), &p.id, "render.png", "regular_image");
        let saved = save_image(&core, save_request(&p.id, &source.id, "frame", [9, 9, 9])).unwrap();
        let request = VideoExportRequest {
            project_id: p.id.clone(),
            frames: vec![frame(&saved.absolute_path, Motion::Appear)],
            width: 640,
            height: 360,
            fps: 24,
        };
        let err = export_video_with(&core, request, MISSING_PROGRAM).unwrap_err();
        assert_eq!(err.code, ErrorCode::InvalidState);
        assert_eq!(err.details.unwrap()["reason"], "ffmpeg_missing");
    }

    #[test]
    fn refuses_frames_outside_the_project_and_bad_sizes() {
        let (tmp, core) = core();
        let p = test_create_villa(&core, "Diagram");
        let outside = crate::services::tests_support::write_png(tmp.path(), "outside.png", 8, 8, [1, 1, 1]);
        let base = |frames: Vec<VideoFrame>, width: u32| VideoExportRequest {
            project_id: p.id.clone(),
            frames,
            width,
            height: 360,
            fps: 24,
        };
        let err =
            export_video_with(&core, base(vec![frame(&outside.to_string_lossy(), Motion::Pan)], 640), MISSING_PROGRAM)
                .unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        let sneaky = core.storage.project_dir(&p.id).join("..").join("x.png");
        let err =
            export_video_with(&core, base(vec![frame(&sneaky.to_string_lossy(), Motion::Pan)], 640), MISSING_PROGRAM)
                .unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
        assert_eq!(
            export_video_with(&core, base(vec![], 640), MISSING_PROGRAM).unwrap_err().code,
            ErrorCode::ValidationError
        );
        let odd = base(vec![frame("x.png", Motion::Pan)], 641);
        assert_eq!(export_video_with(&core, odd, MISSING_PROGRAM).unwrap_err().code, ErrorCode::ValidationError);
    }

    /// Runs FFmpeg for real only when it is on PATH; otherwise the run is skipped.
    #[test]
    fn exports_an_mp4_when_ffmpeg_is_available() {
        if !ffmpeg_status().available {
            eprintln!("skipped: FFmpeg is not on PATH");
            return;
        }
        let (tmp, core) = core();
        let p = test_create_villa(&core, "Diagram");
        let source = test_import(&core, tmp.path(), &p.id, "render.png", "regular_image");
        let a = save_image(&core, save_request(&p.id, &source.id, "frame", [200, 40, 40])).unwrap();
        let b = save_image(&core, save_request(&p.id, &source.id, "frame", [40, 200, 40])).unwrap();
        let result = export_video(
            &core,
            VideoExportRequest {
                project_id: p.id.clone(),
                frames: vec![
                    VideoFrame { path: a.absolute_path.clone(), duration_ms: 600, motion: Motion::Appear },
                    VideoFrame { path: b.absolute_path.clone(), duration_ms: 600, motion: Motion::Zoom },
                ],
                width: 320,
                height: 240,
                fps: 12,
            },
        )
        .unwrap();
        assert_eq!((result.duration_ms, result.frame_count), (1200, 2));
        let out = Path::new(&result.path);
        assert!(out.starts_with(core.storage.project_dir(&p.id).join(EXPORTS_DIR)));
        assert!(fs::metadata(out).unwrap().len() > 0);
    }
}
