//! Cross-language contract fixtures.
//!
//! Drives the real services and records what each bridge command returns as JSON under
//! `apps/desktop/tests/fixtures/backend/`. The desktop vitest suite parses every fixture with
//! the Zod response schema of the same command, so a Rust DTO that drifts from
//! `packages/domain` fails a TypeScript test instead of failing at runtime in the app.
//!
//! IDs, timestamps, durations and absolute paths are normalized so fixtures are stable.
//! `cargo test` fails when a fixture is stale; regenerate with
//! `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};

use crate::domain::{GenerationStatus, JobStatus};
use crate::providers::local_preview::{self, LocalPreviewProvider};
use crate::providers::local_upscale::{self, LocalUpscaleProvider};
use crate::providers::{gemini::GeminiProvider, hhtech, openai::OpenAiProvider, ProviderErrorKind, ProviderRegistry};
use crate::secrets::{env_var_names, EnvSource, FixedEnv, MemorySecretStore, ProcessEnv};
use crate::services::anchors::{self, AnchorClearRequest, AnchorSetRequest};
use crate::services::assets::{self, ImportRequest};
use crate::services::batches::{self, BatchCreateRequest};
use crate::services::generations::{self, SubmitRequest};
use crate::services::grade::{self, GradeApplyRequest};
use crate::services::prompt_enhance::{self, EnhanceRequest};
use crate::services::qc::{self, QcListRequest, QcRunRequest, QcSettingsSetRequest};
use crate::services::tests_support::{
    run_queue, set_cameras, submit_and_run, test_create_villa, write_png, TestBehavior, TestProvider, CAM_A, CAM_B,
    CAM_C, TEST_PROVIDER,
};
use crate::services::{projects, provider_settings, queue, workflow, AppCore};

const ULID_CHARS: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/backend")
}

/// Replaces volatile values with stable placeholders that still satisfy the Zod schemas.
struct Normalizer {
    data_root: String,
    ids: BTreeMap<String, String>,
}

impl Normalizer {
    fn new(data_root: &Path) -> Self {
        Self { data_root: data_root.to_string_lossy().replace('\\', "/"), ids: BTreeMap::new() }
    }

    fn normalize(&mut self, v: &Value) -> Value {
        let walked = self.walk(None, v);
        let text = self.stable_ids(&walked.to_string());
        serde_json::from_str(&text).unwrap()
    }

    fn walk(&self, key: Option<&str>, v: &Value) -> Value {
        match v {
            Value::Object(map) => Value::Object(map.iter().map(|(k, v)| (k.clone(), self.walk(Some(k), v))).collect()),
            Value::Array(items) => Value::Array(items.iter().map(|v| self.walk(key, v)).collect()),
            Value::Number(_) if key == Some("durationMs") => json!(1234),
            Value::String(_) if key.is_some_and(|k| k.ends_with("At")) => json!("2026-01-01T00:00:00.000Z"),
            Value::String(s) => {
                let slashed = s.replace('\\', "/");
                match slashed.strip_prefix(&self.data_root) {
                    Some(rest) => json!(format!("/data{rest}")),
                    None => v.clone(),
                }
            }
            other => other.clone(),
        }
    }

    /// `PRJ_/AST_/VER_/GEN_/JOB_/BAT_` + 26 ULID chars → counters in order of first appearance.
    fn stable_ids(&mut self, text: &str) -> String {
        let bytes = text.as_bytes();
        let mut out = String::with_capacity(text.len());
        let mut i = 0;
        while i < bytes.len() {
            let candidate =
                ["PRJ_", "AST_", "VER_", "GEN_", "JOB_", "BAT_", "QC_"].iter().find(|p| text[i..].starts_with(**p));
            if let Some(prefix) = candidate {
                let prefix_len = prefix.len();
                let tail = &bytes[i + prefix_len..(i + prefix_len + 26).min(bytes.len())];
                if tail.len() == 26 && tail.iter().all(|b| ULID_CHARS.contains(b)) {
                    let raw = &text[i..i + prefix_len + 26];
                    let n = self.ids.len() + 1;
                    let stable = self.ids.entry(raw.to_string()).or_insert_with(|| {
                        let mut digits = vec![b'0'; 26];
                        let (mut v, mut j) = (n, 25);
                        while v > 0 {
                            digits[j] = ULID_CHARS[v % 32];
                            v /= 32;
                            j -= 1;
                        }
                        format!("{prefix}{}", String::from_utf8(digits).unwrap())
                    });
                    out.push_str(stable);
                    i += prefix_len + 26;
                    continue;
                }
            }
            let ch = text[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
        out
    }
}

struct Recorder {
    norm: Normalizer,
    out: BTreeMap<String, Value>,
}

impl Recorder {
    fn record(&mut self, name: &str, command: &str, value: &impl Serialize) {
        let v = serde_json::to_value(value).unwrap();
        let v = self.norm.normalize(&v);
        self.out.insert(name.to_string(), json!({ "command": command, "response": v }));
    }

    fn record_error(&mut self, name: &str, err: &crate::error::AppError) {
        self.record(name, "error", err);
    }
}

fn submit_request(project_id: &str, provider: &str, model: &str, refs: &[&str], count: u32) -> SubmitRequest {
    serde_json::from_value(json!({
        "projectId": project_id, "providerId": provider, "modelId": model, "purpose": "hero",
        "prompt": {
            "compilerVersion": "pc-1.0.0", "positivePrompt": "Tropical villa at dusk", "negativePrompt": "people",
            "referenceInstructions": "Image 1 is the master.", "preservationInstructions": "Keep the massing.",
            "metadata": { "projectType": "villa" }
        },
        "referenceAssetIds": refs, "params": { "aspectRatio": null, "imageSize": null, "outputCount": count, "seed": null }
    }))
    .unwrap()
}

/// Nothing that can reach a paid API: closed local port (connection refused at once).
const UNROUTABLE_GEMINI_URL: &str = "http://127.0.0.1:9/v1beta";
const UNROUTABLE_OPENAI_URL: &str = "http://127.0.0.1:9/v1";
const UNROUTABLE_HHTECH_URL: &str = "http://127.0.0.1:9/v1";

/// `ambient` stands for the environment of the process running `cargo test` (a developer
/// may have `ARCH_STUDIO_GEMINI_API_KEY` or `ARCH_STUDIO_OPENAI_API_KEY` set). It is
/// deliberately *not* wired into the core: the fixture core resolves keys from its memory store
/// and an empty environment only, and its remote adapters point at an unroutable address
/// (Codex review p2-backend, last item).
fn build_fixtures(ambient: Arc<dyn EnvSource>) -> BTreeMap<String, Value> {
    let tmp = tempfile::tempdir().unwrap();
    let data_root = tmp.path().join("data");
    let double = Arc::new(TestProvider::default());
    let registry = ProviderRegistry::new(vec![
        Arc::new(GeminiProvider::with_base_url(UNROUTABLE_GEMINI_URL)),
        Arc::new(OpenAiProvider::with_base_url(UNROUTABLE_OPENAI_URL)),
        // Configured from an injected environment (never the process one): default models.
        Arc::new(hhtech::provider(&FixedEnv::with(hhtech::ENV_BASE_URL, UNROUTABLE_HHTECH_URL))),
        Arc::new(LocalPreviewProvider),
        Arc::new(LocalUpscaleProvider),
        double.clone(),
    ]);
    let core = AppCore::open_with(&data_root, registry, Arc::new(MemorySecretStore::default())).unwrap();
    drop(ambient);
    for id in ["gemini", "openai", "hhtech"] {
        for name in env_var_names(id) {
            assert!(core.env.var(&name).is_none(), "fixture core must not see an ambient key");
        }
    }
    let mut rec = Recorder { norm: Normalizer::new(&data_root), out: BTreeMap::new() };

    // Providers. Gemini: unconfigured, then configured (the key never appears in the DTO).
    rec.record("provider_list", "provider_list", &provider_settings::list(&core));
    let configured = provider_settings::set_api_key(&core, "gemini", "fixture-key-not-real").unwrap();
    assert!(!serde_json::to_string(&configured).unwrap().contains("fixture-key-not-real"));
    rec.record("provider_set_api_key", "provider_set_api_key", &configured);
    rec.record(
        "provider_clear_api_key",
        "provider_clear_api_key",
        &provider_settings::clear_api_key(&core, "gemini").unwrap(),
    );
    rec.record("provider_test", "provider_test", &provider_settings::test(&core, local_preview::ID).unwrap());

    // Project with a master (approved) and cameras: A and B are anchor views, C is not.
    let p = test_create_villa(&core, "Fixture villa");
    rec.record("workflow_get", "workflow_get", &workflow::get(&core, &p.id).unwrap());
    rec.record("workflow_reopen_step", "workflow_reopen_step", &workflow::reopen(&core, &p.id, "dna.context").unwrap());
    workflow::confirm(&core, &p.id, "dna.context").unwrap();
    workflow::reopen(&core, &p.id, "dna.references").unwrap();
    workflow::confirm(&core, &p.id, "dna.references").unwrap();
    workflow::reopen(&core, &p.id, "dna.camera").unwrap();
    workflow::confirm(&core, &p.id, "dna.camera").unwrap();
    workflow::reopen(&core, &p.id, "dna.lighting").unwrap();
    rec.record(
        "workflow_confirm_step",
        "workflow_confirm_step",
        &workflow::confirm(&core, &p.id, "dna.lighting").unwrap(),
    );
    let master = assets::import(
        &core,
        ImportRequest {
            project_id: p.id.clone(),
            source_path: write_png(tmp.path(), "master.png", 32, 24, [180, 40, 40]).to_string_lossy().into_owned(),
            source: "external".into(),
            role: "master_architecture".into(),
            allow_duplicate: false,
        },
    )
    .unwrap();
    projects::approve_master(&core, &p.id, true).unwrap();
    rec.record("qc_settings_get", "qc_settings_get", &qc::settings_get(&core, &p.id).unwrap());
    let mut qc_settings = qc::settings_get(&core, &p.id).unwrap();
    qc_settings.pass_min = 72.0;
    rec.record(
        "qc_settings_set",
        "qc_settings_set",
        &qc::settings_set(&core, QcSettingsSetRequest { project_id: p.id.clone(), settings: qc_settings }).unwrap(),
    );
    set_cameras(&core, &p.id, &[(CAM_A, "Front corner", true), (CAM_B, "Rear garden", true), (CAM_C, "Detail", false)]);

    let graded = grade::apply(
        &core,
        GradeApplyRequest {
            project_id: p.id.clone(),
            asset_id: master.id.clone(),
            grade: serde_json::from_value(json!({
                "schemaVersion": 1, "exposure": 0.5, "contrast": 12, "highlights": -8,
                "shadows": 18, "whites": 4, "blacks": -6, "temperature": 16, "tint": -3,
                "vibrance": 20, "saturation": 8, "clarity": 10, "dehaze": 5, "look": "warm_tropical"
            }))
            .unwrap(),
            label: Some("Warm tropical grade".into()),
        },
    )
    .unwrap();
    rec.record("grade_apply", "grade_apply", &graded);
    rec.record(
        "qc_run",
        "qc_run",
        &qc::run(&core, QcRunRequest { project_id: p.id.clone(), asset_id: graded.id.clone(), vision: None }).unwrap(),
    );
    rec.record(
        "qc_list",
        "qc_list",
        &qc::list(&core, QcListRequest { project_id: p.id.clone(), asset_id: None }).unwrap(),
    );

    let enhance_request: SubmitRequest = serde_json::from_value(json!({
        "projectId": p.id,
        "providerId": local_upscale::ID,
        "modelId": local_upscale::MODEL_ID,
        "purpose": "enhance",
        "prompt": { "compilerVersion": "", "positivePrompt": "", "negativePrompt": "", "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
        "referenceAssetIds": [master.id],
        "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null,
                    "enhance": { "mode": "conservative", "targetLongEdge": 2048, "detailStrength": 40, "architecturePreserve": true } }
    })).unwrap();
    let enhance_queued = generations::submit(&core, enhance_request).unwrap();
    rec.record("enhance_submit_queued", "generation_submit", &enhance_queued);
    run_queue(&core);
    rec.record(
        "enhance_generation_get",
        "generation_get",
        &generations::get(&core, &p.id, &enhance_queued.id).unwrap(),
    );

    // generation_submit returns the queued generation; the queue then completes it.
    let mut hero = submit_request(&p.id, local_preview::ID, local_preview::MODEL_ID, &[&master.id], 2);
    hero.camera_id = Some(CAM_C.into());
    let queued = generations::submit(&core, hero).unwrap();
    assert_eq!(queued.status, GenerationStatus::Queued);
    rec.record("generation_submit_queued", "generation_submit", &queued);
    run_queue(&core);
    let done = generations::get(&core, &p.id, &queued.id).unwrap();
    assert_eq!(done.status, GenerationStatus::Completed);
    rec.record("generation_get", "generation_get", &done);

    let missing_key = generations::submit(&core, submit_request(&p.id, "gemini", "gemini-2.5-flash-image", &[], 1))
        .expect_err("gemini has no key");
    rec.record_error("error_provider_not_configured", &missing_key);

    // A non-retryable provider error: failed at once.
    provider_settings::set_api_key(&core, TEST_PROVIDER, "fixture-test-key").unwrap();
    double.set_behavior(TestBehavior::Fail(ProviderErrorKind::Blocked));
    let failed = submit_and_run(&core, submit_request(&p.id, TEST_PROVIDER, "full", &[], 1)).unwrap();
    assert_eq!(failed.status, GenerationStatus::Failed);
    rec.record("generation_get_failed", "generation_get", &failed);

    // A retryable one: the job waits in `retrying` (next attempt 15 s later, not run here).
    double.set_behavior(TestBehavior::Fail(ProviderErrorKind::RateLimited));
    let retrying = generations::submit(&core, submit_request(&p.id, TEST_PROVIDER, "full", &[], 1)).unwrap();
    run_queue(&core);
    let retrying_job = queue::get(&core, retrying.job_id.as_deref().unwrap()).unwrap();
    assert_eq!(retrying_job.status, JobStatus::Retrying);
    double.set_behavior(TestBehavior::Images);
    // Queued behind it on the same remote provider (nothing runs until the next tick).
    let waiting = generations::submit(&core, submit_request(&p.id, TEST_PROVIDER, "full", &[], 1)).unwrap();

    // Cancel a queued job, then retry it as a new job.
    let to_cancel =
        generations::submit(&core, submit_request(&p.id, local_preview::ID, local_preview::MODEL_ID, &[], 1)).unwrap();
    let cancelled = queue::cancel(&core, to_cancel.job_id.as_deref().unwrap()).unwrap();
    assert_eq!(cancelled.status, JobStatus::Cancelled);
    rec.record("job_cancel", "job_cancel", &cancelled);
    rec.record_error("error_job_cancel_terminal", &queue::cancel(&core, &cancelled.id).unwrap_err());
    let retried = queue::retry(&core, &cancelled.id).unwrap();
    assert_eq!(retried.status, JobStatus::Queued);
    rec.record("job_retry", "job_retry", &retried);

    // An anchor batch: one item per anchor view, all queued.
    let item = |camera: &str, label: &str| {
        json!({ "cameraId": camera, "label": label, "referenceAssetIds": [master.id],
            "prompt": { "compilerVersion": "pc-1.0.0", "positivePrompt": format!("{label}, tropical villa"),
                        "negativePrompt": "", "referenceInstructions": "Image 1 is the master.",
                        "preservationInstructions": "Keep the massing.", "metadata": { "cameraId": camera } },
            "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null } })
    };
    let batch_request = |items: Vec<Value>| -> BatchCreateRequest {
        serde_json::from_value(json!({ "projectId": p.id, "name": "Anchors", "providerId": local_preview::ID,
            "modelId": local_preview::MODEL_ID, "purpose": "anchor", "priority": 1, "items": items }))
        .unwrap()
    };
    let batch = batches::create(
        &core,
        batch_request(vec![item(CAM_A, "Front corner — anchor"), item(CAM_B, "Rear garden — anchor")]),
    )
    .unwrap();
    assert_eq!(batch.counts.queued, 2);
    rec.record("batch_create", "batch_create", &batch);
    let invalid =
        batches::create(&core, batch_request(vec![item(CAM_A, "ok"), item("CAM_01J9ZZZZZZZZZZZZZZZZZZZZZX", "bad")]))
            .unwrap_err();
    rec.record_error("error_batch_item_invalid", &invalid);

    // job_list (all projects): queued, retrying, cancelled, completed and failed jobs.
    let jobs = queue::list(&core, None).unwrap();
    let statuses: std::collections::BTreeSet<&str> = jobs.iter().map(|j| j.status.as_str()).collect();
    assert_eq!(statuses, ["cancelled", "completed", "failed", "queued", "retrying"].into_iter().collect());
    assert!(jobs.iter().any(|j| j.id == retrying_job.id) && jobs.iter().any(|j| j.generation_id == waiting.id));
    rec.record("job_list", "job_list", &jobs);

    run_queue(&core);
    let batches_now = batches::list(&core, &p.id).unwrap();
    assert_eq!(batches_now[0].counts.completed, 2);
    rec.record("batch_list", "batch_list", &batches_now);

    // Anchors from the batch outputs: status moves to production, then back.
    let output_of = |job_id: &str| {
        let job = queue::get(&core, job_id).unwrap();
        generations::get(&core, &p.id, &job.generation_id).unwrap().output_asset_ids[0].clone()
    };
    let set = |camera: &str, job_id: &str| {
        anchors::set(
            &core,
            AnchorSetRequest { project_id: p.id.clone(), camera_id: camera.into(), asset_id: output_of(job_id) },
        )
        .unwrap()
    };
    set(CAM_A, &batch.job_ids[0]);
    rec.record("camera_anchor_set", "camera_anchor_set", &set(CAM_B, &batch.job_ids[1]));
    rec.record("camera_anchor_list", "camera_anchor_list", &anchors::list(&core, &p.id).unwrap());
    rec.record("project_get", "project_get", &projects::get(&core, &p.id).unwrap());
    rec.record(
        "camera_anchor_clear",
        "camera_anchor_clear",
        &anchors::clear(&core, AnchorClearRequest { project_id: p.id.clone(), camera_id: CAM_B.into() }).unwrap(),
    );

    // Prompt enhancement: the test double's chat answers; HHTECH without a key is not configured.
    let enhance = |provider: &str| EnhanceRequest {
        project_id: p.id.clone(),
        provider_id: provider.into(),
        text: "villa at dusk".into(),
        context: "Two-storey tropical villa.".into(),
    };
    rec.record("prompt_enhance", "prompt_enhance", &prompt_enhance::enhance(&core, enhance(TEST_PROVIDER)).unwrap());
    let unconfigured = prompt_enhance::enhance(&core, enhance(hhtech::ID)).unwrap_err();
    rec.record_error("error_prompt_enhance_not_configured", &unconfigured);
    // With a key, the call reaches the unroutable address: a provider error, nothing leaves the machine.
    provider_settings::set_api_key(&core, hhtech::ID, "fixture-key-not-real").unwrap();
    let failed = prompt_enhance::enhance(&core, enhance(hhtech::ID)).unwrap_err();
    rec.record_error("error_prompt_enhance_provider", &failed);
    provider_settings::clear_api_key(&core, hhtech::ID).unwrap();

    rec.record("generation_list", "generation_list", &generations::list(&core, &p.id).unwrap());
    rec.record("version_list", "version_list", &assets::list_versions(&core, &p.id).unwrap());
    rec.out
}

#[test]
fn fixtures_and_descriptors_ignore_remote_keys_in_the_environment() {
    let ambient: Arc<dyn EnvSource> = Arc::new(FixedEnv(
        [
            ("gemini", "ambient-real-looking-key"),
            ("openai", "sk-ambient-real-looking-key"),
            ("hhtech", "hh-ambient-key"),
        ]
        .into_iter()
        .flat_map(|(id, key)| env_var_names(id).into_iter().map(move |name| (name, key.to_string())))
        .collect(),
    ));
    let with_key = build_fixtures(ambient);
    let without = build_fixtures(Arc::new(FixedEnv::default()));
    assert_eq!(with_key, without);
    let text = serde_json::to_string(&with_key).unwrap();
    assert!(!text.contains("ambient-real-looking-key") && !text.contains("hh-ambient-key"));
    let providers = with_key["provider_list"]["response"].as_array().unwrap();
    let ids: Vec<_> = providers.iter().map(|p| p["id"].as_str().unwrap()).collect();
    assert_eq!(ids[..4], ["gemini", "openai", "hhtech", "local_preview"]);
    for remote in &providers[..3] {
        assert_eq!(remote["configured"].as_bool(), Some(false), "{remote}");
    }
}

#[test]
fn backend_fixtures_are_current() {
    let fixtures = build_fixtures(Arc::new(ProcessEnv));
    let dir = fixtures_dir();
    let update = std::env::var_os("UPDATE_BACKEND_FIXTURES").is_some();
    if update {
        std::fs::create_dir_all(&dir).unwrap();
    }
    let mut stale = Vec::new();
    for (name, value) in &fixtures {
        let path = dir.join(format!("{name}.json"));
        let text = format!("{}\n", serde_json::to_string_pretty(value).unwrap());
        if update {
            std::fs::write(&path, &text).unwrap();
        } else if std::fs::read_to_string(&path).map(|s| s.replace("\r\n", "\n")).ok().as_deref() != Some(&text) {
            stale.push(name.clone());
        }
    }
    assert!(
        stale.is_empty(),
        "backend contract fixtures are stale: {stale:?}. Run `UPDATE_BACKEND_FIXTURES=1 cargo test contract_fixtures` and commit."
    );
}
