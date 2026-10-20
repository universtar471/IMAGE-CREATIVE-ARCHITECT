//! Video runs through the real queue with a scripted vendor (ADR-043).

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use super::*;
use crate::domain::GenerationStatus;
use crate::providers::local_preview::LocalPreviewProvider;
use crate::providers::video::{video_model, VideoApi, VideoProvider};
use crate::providers::{ProviderErrorKind, ProviderRegistry};
use crate::secrets::MemorySecretStore;
use crate::services::generations::{self, SubmitRequest};
use crate::services::tests_support::{run_queue, test_create_villa_unconfirmed, test_import};
use crate::services::{assets, provider_settings, queue};

const PROVIDER: &str = "test_video";

/// A 2-second MP4 header: `ftyp`, then `moov` > `mvhd` (version 0, timescale 1000, 2000).
fn mp4() -> Vec<u8> {
    let mut mvhd = vec![0u8; 100];
    mvhd[12..16].copy_from_slice(&1000u32.to_be_bytes());
    mvhd[16..20].copy_from_slice(&2000u32.to_be_bytes());
    let mut out = b"\x00\x00\x00\x10ftypisom\x00\x00\x02\x00".to_vec();
    out.extend_from_slice(&((8 + 8 + mvhd.len()) as u32).to_be_bytes());
    out.extend_from_slice(b"moov");
    out.extend_from_slice(&((8 + mvhd.len()) as u32).to_be_bytes());
    out.extend_from_slice(b"mvhd");
    out.extend_from_slice(&mvhd);
    out
}

#[derive(Default)]
struct Script {
    submits: AtomicUsize,
    polls: Mutex<VecDeque<Result<VideoPoll, ProviderError>>>,
    deadline_zero: std::sync::atomic::AtomicBool,
    last_prompt: Mutex<String>,
}

struct ScriptedApi(Arc<Script>);

impl VideoApi for ScriptedApi {
    fn submit(&self, request: &VideoRequest, _key: &str) -> Result<VideoTask, ProviderError> {
        self.0.submits.fetch_add(1, Ordering::SeqCst);
        *self.0.last_prompt.lock().unwrap() = format!("{} | {}s", request.prompt, request.duration_sec);
        Ok(VideoTask { id: "task-1".into(), extra: json!({}) })
    }

    fn poll(&self, task: &VideoTask, _key: &str) -> Result<VideoPoll, ProviderError> {
        assert_eq!(task.id, "task-1");
        let next = self.0.polls.lock().unwrap().pop_front();
        next.unwrap_or_else(|| {
            std::thread::sleep(Duration::from_millis(5));
            Ok(VideoPoll::Pending)
        })
    }

    fn download(&self, url: &str, _key: &str) -> Result<Vec<u8>, ProviderError> {
        assert_eq!(url, "https://cdn.test/clip.mp4");
        Ok(mp4())
    }

    fn poll_interval(&self) -> Duration {
        Duration::ZERO
    }

    fn deadline(&self) -> Duration {
        if self.0.deadline_zero.load(Ordering::SeqCst) {
            Duration::ZERO
        } else {
            Duration::from_secs(60)
        }
    }
}

fn open(root: &Path, script: &Arc<Script>) -> AppCore {
    let registry = ProviderRegistry::new(vec![
        Arc::new(LocalPreviewProvider),
        Arc::new(VideoProvider {
            id: PROVIDER,
            label: "Test video",
            models: vec![video_model("vid-1", "Vid 1", &[5, 10], &["16:9"])],
            problem: None,
            api: Box::new(ScriptedApi(Arc::clone(script))),
        }),
    ]);
    AppCore::open_with(root, registry, Arc::new(MemorySecretStore::default())).unwrap()
}

struct Fixture {
    tmp: tempfile::TempDir,
    script: Arc<Script>,
    core: Arc<AppCore>,
    project_id: String,
    source_id: String,
}

fn fixture(polls: Vec<Result<VideoPoll, ProviderError>>) -> Fixture {
    let tmp = tempfile::tempdir().unwrap();
    let script = Arc::new(Script { polls: Mutex::new(polls.into()), ..Default::default() });
    let core = Arc::new(open(&tmp.path().join("data"), &script));
    provider_settings::set_api_key(&core, PROVIDER, "video-key").unwrap();
    // No DNA step is confirmed: video is not gated by the workflow.
    let project = test_create_villa_unconfirmed(&core, "Clip villa");
    let source = test_import(&core, tmp.path(), &project.id, "facade.png", "regular_image");
    Fixture { tmp, script, core, project_id: project.id, source_id: source.id }
}

fn video_request(f: &Fixture, provider: &str, purpose: &str, refs: &[&str], size: Option<&str>) -> SubmitRequest {
    serde_json::from_value(json!({
        "projectId": f.project_id, "providerId": provider, "modelId": if provider == PROVIDER { "vid-1" } else { "placeholder-v1" },
        "purpose": purpose,
        "prompt": { "compilerVersion": "vc-1.0.0", "positivePrompt": "Slow dolly in.", "negativePrompt": "warping",
                    "referenceInstructions": "", "preservationInstructions": "Keep the facade rigid.", "metadata": {} },
        "referenceAssetIds": refs,
        "params": { "aspectRatio": null, "imageSize": size, "outputCount": 1, "seed": null },
    }))
    .unwrap()
}

fn submit(f: &Fixture) -> crate::dto::GenerationDto {
    let g = generations::submit(&f.core, video_request(f, PROVIDER, "video", &[&f.source_id], Some("5s"))).unwrap();
    run_queue(&f.core);
    generations::get(&f.core, &f.project_id, &g.id).unwrap()
}

fn task_row(core: &AppCore, generation_id: &str) -> Option<VideoTaskRow> {
    repo::find_video_task(&core.conn().unwrap(), generation_id).unwrap()
}

fn done() -> Result<VideoPoll, ProviderError> {
    Ok(VideoPoll::Done { url: "https://cdn.test/clip.mp4".into() })
}

#[test]
fn submits_once_polls_and_stores_a_video_with_lineage() {
    let f = fixture(vec![Ok(VideoPoll::Pending), Ok(VideoPoll::Pending), done()]);
    let g = submit(&f);
    assert_eq!(g.status, GenerationStatus::Completed, "{:?}", g.error);
    assert_eq!(f.script.submits.load(Ordering::SeqCst), 1);
    assert_eq!(*f.script.last_prompt.lock().unwrap(), "Slow dolly in. Keep the facade rigid. | 5s");
    assert!(task_row(&f.core, &g.id).is_none(), "the task row goes once the clip is stored");

    let asset =
        assets::list(&f.core, &f.project_id).unwrap().into_iter().find(|a| a.id == g.output_asset_ids[0]).unwrap();
    assert_eq!(asset.media_kind, "video");
    assert_eq!(asset.mime_type.as_deref(), Some("video/mp4"));
    assert_eq!(asset.duration_ms, Some(2000), "read from the mvhd box");
    assert_eq!(asset.parent_asset_id.as_deref(), Some(f.source_id.as_str()));
    assert_eq!(asset.operation.as_deref(), Some("video"));
    assert!(asset.absolute_path.ends_with(".mp4"));
    assert!(asset.thumbnail_path.is_some(), "poster from the source image (or FFmpeg)");
    let source = assets::list(&f.core, &f.project_id).unwrap().into_iter().find(|a| a.id == f.source_id).unwrap();
    assert_eq!(source.media_kind, "image");
    assert_eq!(source.duration_ms, None);
}

#[test]
fn a_timeout_keeps_the_task_and_retry_resumes_without_resubmitting() {
    let f = fixture(vec![]);
    f.script.deadline_zero.store(true, Ordering::SeqCst);
    let g = submit(&f);
    assert_eq!(g.status, GenerationStatus::Failed);
    let error = g.error.clone().unwrap();
    assert_eq!((error.kind.as_str(), error.retryable), ("timeout", true));
    assert!(error.message.contains("not sent again"));
    assert!(task_row(&f.core, &g.id).is_some());
    let job = queue::get(&f.core, g.job_id.as_deref().unwrap()).unwrap();
    assert_eq!(job.status, crate::domain::JobStatus::Failed, "a paid timeout is never retried by itself");

    f.script.deadline_zero.store(false, Ordering::SeqCst);
    f.script.polls.lock().unwrap().push_back(done());
    let retried = queue::retry(&f.core, &job.id).unwrap();
    run_queue(&f.core);
    let again = generations::get(&f.core, &f.project_id, &retried.generation_id).unwrap();
    assert_eq!(again.status, GenerationStatus::Completed, "{:?}", again.error);
    assert_eq!(f.script.submits.load(Ordering::SeqCst), 1, "Retry resumed the accepted task");
    assert!(task_row(&f.core, &g.id).is_none() && task_row(&f.core, &again.id).is_none());
}

#[test]
fn a_restart_resumes_polling_a_running_video() {
    let f = fixture(vec![]);
    f.script.deadline_zero.store(true, Ordering::SeqCst);
    let g = submit(&f);
    // As if the app had closed while the job was polling.
    {
        let conn = f.core.conn().unwrap();
        conn.execute("UPDATE jobs SET status = 'running' WHERE generation_id = ?1", [&g.id]).unwrap();
        conn.execute("UPDATE generations SET status = 'running' WHERE id = ?1", [&g.id]).unwrap();
    }
    let root = f.tmp.path().join("data");
    let Fixture { tmp: _tmp, script, core, project_id, .. } = f;
    drop(core);
    script.deadline_zero.store(false, Ordering::SeqCst);
    script.polls.lock().unwrap().push_back(done());
    let core = open(&root, &script);
    provider_settings::set_api_key(&core, PROVIDER, "video-key").unwrap();
    assert_eq!(generations::get(&core, &project_id, &g.id).unwrap().status, GenerationStatus::Queued);
    run_queue(&core);
    let resumed = generations::get(&core, &project_id, &g.id).unwrap();
    assert_eq!(resumed.status, GenerationStatus::Completed, "{:?}", resumed.error);
    assert_eq!(script.submits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_provider_failure_ends_the_task() {
    let f = fixture(vec![Ok(VideoPoll::Failed { message: "Kling: risk control".into(), blocked: true })]);
    let g = submit(&f);
    assert_eq!(g.status, GenerationStatus::Failed);
    let error = g.error.unwrap();
    assert_eq!((error.kind.as_str(), error.retryable), ("blocked", false));
    assert!(task_row(&f.core, &g.id).is_none());
    assert!(g.output_asset_ids.is_empty());
}

#[test]
fn transient_poll_errors_are_tolerated_then_fail_retryable() {
    let net = || Err(ProviderError::new(ProviderErrorKind::Network, "down"));
    let f = fixture(vec![net(), net(), done()]);
    assert_eq!(submit(&f).status, GenerationStatus::Completed);

    let f = fixture((0..5).map(|_| net()).collect());
    let g = generations::submit(&f.core, video_request(&f, PROVIDER, "video", &[&f.source_id], Some("5s"))).unwrap();
    queue::tick(&f.core, f.core.clock.now()).unwrap();
    let job = queue::get(&f.core, g.job_id.as_deref().unwrap()).unwrap();
    assert_eq!(job.status, crate::domain::JobStatus::Retrying, "network errors go back to the queue");
    assert!(task_row(&f.core, &g.id).is_some(), "and the next attempt polls the same task");
}

#[test]
fn purpose_provider_and_references_must_fit() {
    let f = fixture(vec![]);
    let err = |req| generations::submit(&f.core, req).unwrap_err().message;
    assert!(err(video_request(&f, PROVIDER, "hero", &[&f.source_id], Some("5s"))).contains("makes videos"));
    assert!(err(video_request(&f, "local_preview", "video", &[&f.source_id], None)).contains("makes images"));
    assert!(err(video_request(&f, PROVIDER, "video", &[], Some("5s"))).contains("needs at least one reference"));
    assert!(err(video_request(&f, PROVIDER, "video", &[&f.source_id], None)).contains("clip length"));
    assert!(err(video_request(&f, PROVIDER, "video", &[&f.source_id], Some("7s"))).contains("does not offer"));
    assert_eq!(f.script.submits.load(Ordering::SeqCst), 0);

    // A finished clip cannot be the reference of another run.
    f.script.polls.lock().unwrap().push_back(done());
    let clip = submit(&f).output_asset_ids[0].clone();
    assert!(err(video_request(&f, PROVIDER, "video", &[&clip], Some("5s"))).contains("is a video"));
}

#[test]
fn cancel_while_polling_discards_and_keeps_the_task() {
    let f = fixture(vec![]);
    let g = generations::submit(&f.core, video_request(&f, PROVIDER, "video", &[&f.source_id], Some("5s"))).unwrap();
    let claims = queue::claim(&f.core, f.core.clock.now()).unwrap();
    let core = Arc::clone(&f.core);
    let worker = std::thread::spawn(move || {
        for c in claims {
            queue::run(&core, c);
        }
    });
    while f.script.submits.load(Ordering::SeqCst) == 0 {
        std::thread::sleep(Duration::from_millis(5));
    }
    queue::cancel(&f.core, g.job_id.as_deref().unwrap()).unwrap();
    worker.join().unwrap();
    assert_eq!(f.script.submits.load(Ordering::SeqCst), 1);
    assert!(task_row(&f.core, &g.id).is_some(), "the accepted task is kept for a Retry");
    let after = generations::get(&f.core, &f.project_id, &g.id).unwrap();
    assert_eq!(after.status, GenerationStatus::Cancelled);
    assert!(after.output_asset_ids.is_empty());
}

#[test]
fn mp4_duration_reads_version_0_and_rejects_garbage() {
    assert_eq!(mp4_duration_ms(&mp4()), Some(2000));
    assert_eq!(mp4_duration_ms(b"\x00\x00\x00\x08ftyp"), None);
    assert_eq!(mp4_duration_ms(&[0xff; 40]), None);
}
