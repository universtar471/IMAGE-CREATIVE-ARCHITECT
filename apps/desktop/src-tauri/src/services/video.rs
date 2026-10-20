//! Image-to-video runs (phase B1, ADR-043).
//!
//! A video job goes through the same queue, history and lineage as an image job; only the
//! attempt differs: `submit` once, persist the provider task (`video_tasks`), poll, download,
//! store. The task row makes every later attempt (Retry, the queue's network retry, an app
//! restart) resume polling instead of submitting again, so one request is billed once. The
//! row goes away when the clip is stored or the provider reports a failure; a timeout keeps
//! it. Cancel stops waiting on our side only: the provider may still finish and bill.
//!
//! The clip is an `assets` row with a `video/*` mime type, `parent_asset_id` = the first
//! frame's asset, and `durationMs` in its operation metadata. Its thumbnail is the first frame
//! of the clip when FFmpeg is on PATH, else the source image.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use crate::domain::{AssetRole, AssetSource, GenerationPurpose, GenerationStatus, JobStatus};
use crate::error::{AppError, AppResult};
use crate::imaging;
use crate::providers::video::{parse_duration, video_mime, VideoPoll, VideoRequest, VideoTask};
use crate::providers::{GenerationParams, ImageProvider, OutputKind, ProviderError};
use crate::repositories::{self as repo, AssetRow, VersionRow, VideoTaskRow};
use crate::services::assets::write_new_file;
use crate::services::generations::{elapsed_ms, job_is_running, Failure, Prepared, Stop};
use crate::services::AppCore;
use crate::storage::{self, ORIGINALS_DIR, PREVIEWS_DIR};
use crate::util::{new_id, prefix};

/// Poll errors in a row (network, rate limit) tolerated before the attempt fails.
const MAX_POLL_ERRORS: u32 = 5;
/// Longest single sleep between cancel checks while waiting for the next poll.
const CANCEL_CHECK: Duration = Duration::from_secs(1);

pub fn is_video_asset(asset: &AssetRow) -> bool {
    asset.mime_type.as_deref().is_some_and(|mime| mime.starts_with("video/"))
}

/// `durationMs` from a video asset's operation metadata.
pub fn duration_of(asset: &AssetRow) -> Option<i64> {
    if !is_video_asset(asset) {
        return None;
    }
    let json: Value = serde_json::from_str(asset.operation_json.as_deref()?).ok()?;
    json.get("durationMs").and_then(Value::as_i64)
}

/// `frame` (first frame of the clip via FFmpeg) or `source` (the source image) for a clip's
/// poster; `None` for images, for clips without a poster and for clips stored before ADR-044.
pub fn poster_source_of(asset: &AssetRow) -> Option<&'static str> {
    if !is_video_asset(asset) {
        return None;
    }
    let json: Value = serde_json::from_str(asset.operation_json.as_deref()?).ok()?;
    match json.get("posterSource").and_then(Value::as_str)? {
        "frame" => Some("frame"),
        "source" => Some("source"),
        _ => None,
    }
}

/// Purpose and provider must agree: video purposes run on video providers only, and a video
/// takes exactly one first frame and a clip length.
pub(crate) fn validate_purpose(
    provider: &dyn ImageProvider,
    purpose: GenerationPurpose,
    params: &GenerationParams,
    reference_count: usize,
) -> AppResult<()> {
    let label = provider.info().label;
    match (provider.output_kind(), purpose == GenerationPurpose::Video) {
        (OutputKind::Video, false) => {
            return Err(AppError::validation(format!("{label} makes videos; use it from the Video module.")));
        }
        (OutputKind::Image, true) => {
            return Err(AppError::validation(format!("{label} makes images; pick a video provider.")));
        }
        _ => {}
    }
    if purpose != GenerationPurpose::Video {
        return Ok(());
    }
    if reference_count != 1 {
        return Err(AppError::validation("A video starts from exactly one source image."));
    }
    if parse_duration(params.image_size.as_deref()).is_none() {
        return Err(AppError::validation("Pick a clip length for the video."));
    }
    if params.output_count != 1 {
        return Err(AppError::validation("A video request makes one clip."));
    }
    Ok(())
}

fn failure(error: ProviderError) -> Stop {
    Failure::new(error.kind.as_str(), error.message, error.kind.retryable()).into()
}

fn request_of(prepared: &Prepared) -> Result<VideoRequest, Stop> {
    let image = prepared
        .references
        .first()
        .cloned()
        .ok_or_else(|| Stop::from(Failure::new("invalid_request", "The video has no source image.", false)))?;
    let params = &prepared.snapshot.params;
    let duration_sec = parse_duration(params.image_size.as_deref())
        .ok_or_else(|| Stop::from(Failure::new("invalid_request", "The video has no clip length.", false)))?;
    let prompt = &prepared.snapshot.prompt;
    let positive = [prompt.positive_prompt.trim(), prompt.preservation_instructions.trim()]
        .into_iter()
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(VideoRequest {
        model_id: prepared.model.id.clone(),
        prompt: positive,
        negative_prompt: prompt.negative_prompt.clone(),
        image,
        duration_sec,
        aspect_ratio: params.aspect_ratio.clone(),
    })
}

/// The stored task, or a new submission persisted before anything else happens.
fn task_for(core: &AppCore, prepared: &Prepared, key: &str) -> Result<VideoTask, Stop> {
    let generation = &prepared.generation;
    let stored = {
        let conn = core.conn()?;
        repo::find_video_task(&conn, &generation.id)?
    };
    if let Some(row) = stored {
        return serde_json::from_str(&row.task_json).map_err(|_| {
            Failure::new("bad_response", "The stored video task cannot be read; make a new video.", false).into()
        });
    }
    let api = prepared.provider.video().expect("video provider");
    let task = api.submit(&request_of(prepared)?, key).map_err(failure)?;
    // Persisted even when the job was cancelled meanwhile: the provider accepted (and may
    // bill) it, and a Retry must find it.
    let conn = core.conn()?;
    repo::insert_video_task(
        &conn,
        &VideoTaskRow {
            generation_id: generation.id.clone(),
            provider_id: generation.provider_id.clone(),
            task_json: serde_json::to_string(&task).map_err(|e| AppError::validation(e.to_string()))?,
            submitted_at: core.now_iso(),
            last_polled_at: None,
        },
    )?;
    Ok(task)
}

/// Sleeps `interval` in short steps; `Discarded` as soon as the job is no longer running.
fn wait(core: &AppCore, job_id: &str, interval: Duration) -> Result<(), Stop> {
    let until = Instant::now() + interval;
    loop {
        if !job_is_running(core, job_id)? {
            return Err(Stop::Discarded);
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Ok(());
        }
        std::thread::sleep(left.min(CANCEL_CHECK));
    }
}

fn poll_until_done(core: &AppCore, prepared: &Prepared, task: &VideoTask, key: &str) -> Result<String, Stop> {
    let api = prepared.provider.video().expect("video provider");
    let deadline = Instant::now() + api.deadline();
    let mut errors = 0;
    loop {
        if !job_is_running(core, &prepared.job_id)? {
            return Err(Stop::Discarded);
        }
        match api.poll(task, key) {
            Ok(VideoPoll::Pending) => errors = 0,
            Ok(VideoPoll::Done { url }) => return Ok(url),
            Ok(VideoPoll::Failed { message, blocked }) => {
                let conn = core.conn()?;
                repo::delete_video_task(&conn, &prepared.generation.id)?;
                let kind = if blocked { "blocked" } else { "bad_response" };
                return Err(Failure::new(kind, message, false).into());
            }
            Err(e) if e.kind.retryable() && errors + 1 < MAX_POLL_ERRORS => errors += 1,
            Err(e) => return Err(failure(e)),
        }
        {
            let conn = core.conn()?;
            repo::touch_video_task(&conn, &prepared.generation.id, &core.now_iso())?;
        }
        if Instant::now() >= deadline {
            return Err(Failure::new(
                "timeout",
                "The video is still being made at the provider. Press Retry to keep waiting; it is not sent again.",
                true,
            )
            .into());
        }
        wait(core, &prepared.job_id, api.poll_interval())?;
    }
}

/// One attempt of a video job (called by `generations::run_job`).
pub(super) fn run(core: &AppCore, prepared: &Prepared, clock: &Instant) -> Result<(), Stop> {
    let key = prepared.api_key.clone().unwrap_or_default();
    let task = task_for(core, prepared, &key)?;
    let url = poll_until_done(core, prepared, &task, &key)?;
    let api = prepared.provider.video().expect("video provider");
    let bytes = api.download(&url, &key).map_err(failure)?;
    if !job_is_running(core, &prepared.job_id)? {
        return Err(Stop::Discarded);
    }
    store(core, prepared, &bytes, clock)
}

/// Clip length from the MP4/MOV `mvhd` box, if readable.
pub fn mp4_duration_ms(bytes: &[u8]) -> Option<i64> {
    fn boxes(data: &[u8]) -> impl Iterator<Item = (&[u8], &[u8])> {
        let mut at = 0usize;
        std::iter::from_fn(move || {
            let header = data.get(at..at + 8)?;
            let mut size = u32::from_be_bytes(header[..4].try_into().ok()?) as usize;
            let mut start = at + 8;
            if size == 1 {
                size = u64::from_be_bytes(data.get(at + 8..at + 16)?.try_into().ok()?) as usize;
                start = at + 16;
            } else if size == 0 {
                size = data.len() - at;
            }
            let end = at.checked_add(size).filter(|end| *end <= data.len() && size >= start - at)?;
            let item = (&header[4..8], &data[start..end]);
            at = end;
            Some(item)
        })
    }
    let moov = boxes(bytes).find(|(kind, _)| *kind == b"moov")?.1;
    let mvhd = boxes(moov).find(|(kind, _)| *kind == b"mvhd")?.1;
    let (timescale, duration) = if *mvhd.first()? == 1 {
        (
            u32::from_be_bytes(mvhd.get(20..24)?.try_into().ok()?) as u64,
            u64::from_be_bytes(mvhd.get(24..32)?.try_into().ok()?),
        )
    } else {
        (
            u32::from_be_bytes(mvhd.get(12..16)?.try_into().ok()?) as u64,
            u32::from_be_bytes(mvhd.get(16..20)?.try_into().ok()?) as u64,
        )
    };
    if timescale == 0 {
        return None;
    }
    i64::try_from(duration.checked_mul(1000)? / timescale).ok()
}

/// First frame of the clip via FFmpeg, decoded; `None` without FFmpeg or on any failure.
fn first_frame(video: &Path) -> Option<image::DynamicImage> {
    if !crate::services::diagram::ffmpeg_status().available {
        return None;
    }
    let frame = video.with_extension("poster.png");
    let ok = Command::new(crate::services::diagram::FFMPEG_PROGRAM)
        .args(["-v", "error", "-y", "-i"])
        .arg(video)
        .args(["-frames:v", "1"])
        .arg(&frame)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    let decoded = ok.then(|| image::open(&frame).ok()).flatten();
    let _ = fs::remove_file(&frame);
    decoded
}

fn store(core: &AppCore, prepared: &Prepared, bytes: &[u8], clock: &Instant) -> Result<(), Stop> {
    let (mime, ext) = video_mime(bytes).ok_or_else(|| {
        Stop::from(Failure::new("bad_response", "The provider returned a file that is not a video.", true))
    })?;
    let generation = &prepared.generation;
    let project_id = &generation.project_id;
    let asset_id = new_id(prefix::ASSET);
    core.storage.ensure_project_dirs(project_id)?;
    let managed_rel = storage::rel(&[ORIGINALS_DIR, &format!("{asset_id}.{ext}")]);
    let managed_abs = core.storage.resolve(project_id, &managed_rel)?;
    let thumb_rel = storage::rel(&[PREVIEWS_DIR, &format!("{asset_id}_thumb.jpg")]);
    let thumb_abs = core.storage.resolve(project_id, &thumb_rel)?;
    write_new_file(&managed_abs, bytes)?;
    let cleanup = || {
        let _ = fs::remove_file(&managed_abs);
        let _ = fs::remove_file(&thumb_abs);
    };
    // Where the poster came from is recorded, so the UI never calls the source image a frame
    // of the clip (ADR-044).
    let poster = first_frame(&managed_abs).map(|img| (img, "frame")).or_else(|| {
        let source = prepared.references.first()?;
        let info = imaging::inspect(&source.bytes, "source image").ok()?;
        imaging::decode(&source.bytes, info.format).ok().map(|img| (img, "source"))
    });
    let poster = poster.and_then(|(img, from)| match imaging::save_thumbnail(&img, &thumb_abs) {
        Ok(()) => Some((thumb_rel.clone(), from)),
        Err(e) => {
            eprintln!("[video] poster failed for {asset_id}: {e}");
            None
        }
    });
    let requested_ms = parse_duration(prepared.snapshot.params.image_size.as_deref()).map(|s| i64::from(s) * 1000);
    let duration_ms = mp4_duration_ms(bytes).or(requested_ms);
    let result = commit(core, prepared, &asset_id, &managed_rel, poster, mime, bytes, duration_ms, clock);
    if result.is_err() {
        cleanup();
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn commit(
    core: &AppCore,
    prepared: &Prepared,
    asset_id: &str,
    managed_rel: &str,
    poster: Option<(String, &'static str)>,
    mime: &str,
    bytes: &[u8],
    duration_ms: Option<i64>,
    clock: &Instant,
) -> Result<(), Stop> {
    use sha2::{Digest, Sha256};
    let generation = &prepared.generation;
    let mut conn = core.conn()?;
    let tx = conn.transaction().map_err(AppError::from)?;
    if repo::get_job(&tx, &prepared.job_id)?.status != JobStatus::Running {
        return Err(Stop::Discarded);
    }
    let project = repo::get_project(&tx, &generation.project_id)?;
    if project.archived_at.is_some() {
        return Err(Failure::new(
            "interrupted",
            format!("'{}' was archived while the video was being made, so it was discarded.", project.name),
            false,
        )
        .into());
    }
    let parent_asset_id = match &generation.parent_asset_id {
        Some(id) if repo::find_asset(&tx, id)?.is_some() => Some(id.clone()),
        _ => None,
    };
    let parent_version_id = match &parent_asset_id {
        Some(id) => repo::latest_version_id(&tx, id)?,
        None => None,
    };
    let now = core.now_iso();
    let name = format!("{} — {}", GenerationPurpose::Video.label(), prepared.model.label);
    let operation_json = json!({
        "generationId": generation.id,
        "providerId": generation.provider_id,
        "modelId": generation.model_id,
        "params": prepared.snapshot.params,
        "durationMs": duration_ms,
        "posterSource": poster.as_ref().map(|(_, from)| *from),
        "outputIndex": 0,
    })
    .to_string();
    let sha256: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    repo::insert_asset(
        &tx,
        &AssetRow {
            id: asset_id.to_string(),
            project_id: generation.project_id.clone(),
            source: AssetSource::AiGenerated,
            role: AssetRole::RegularImage,
            status: "ready".into(),
            original_name: Some(name.clone()),
            managed_rel_path: managed_rel.to_string(),
            thumbnail_rel_path: poster.map(|(rel, _)| rel),
            mime_type: Some(mime.to_string()),
            file_size_bytes: Some(bytes.len() as i64),
            width_px: None,
            height_px: None,
            sha256: Some(sha256),
            parent_asset_id,
            operation: Some("video".into()),
            operation_json: Some(operation_json.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
        },
    )?;
    repo::insert_version(
        &tx,
        &VersionRow {
            id: new_id(prefix::VERSION),
            project_id: generation.project_id.clone(),
            asset_id: asset_id.to_string(),
            parent_version_id,
            label: Some(name),
            operation: "video".into(),
            operation_json: Some(operation_json),
            generation_id: Some(generation.id.clone()),
            created_at: now.clone(),
        },
    )?;
    repo::insert_generation_output(&tx, &generation.id, 0, asset_id)?;
    repo::delete_video_task(&tx, &generation.id)?;
    repo::finish_generation(&tx, &generation.id, GenerationStatus::Completed, None, &now, Some(elapsed_ms(clock)))?;
    repo::finish_running_job(&tx, &prepared.job_id, JobStatus::Completed, None, &now)?;
    tx.commit().map_err(AppError::from)?;
    Ok(())
}

#[cfg(test)]
mod tests;
