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

use crate::providers::local_preview::{self, LocalPreviewProvider};
use crate::providers::{gemini::GeminiProvider, ProviderErrorKind, ProviderRegistry};
use crate::secrets::MemorySecretStore;
use crate::services::assets::{self, ImportRequest};
use crate::services::generations::{self, SubmitRequest};
use crate::services::tests_support::{
    submit_and_run, test_create_villa, write_png, TestBehavior, TestProvider, TEST_PROVIDER,
};
use crate::services::{projects, provider_settings, AppCore};

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

    /// `PRJ_/AST_/VER_/GEN_` + 26 ULID chars → counters in order of first appearance.
    fn stable_ids(&mut self, text: &str) -> String {
        let bytes = text.as_bytes();
        let mut out = String::with_capacity(text.len());
        let mut i = 0;
        while i < bytes.len() {
            let candidate = ["PRJ_", "AST_", "VER_", "GEN_"].iter().find(|p| text[i..].starts_with(**p));
            if let Some(prefix) = candidate {
                let tail = &bytes[i + 4..(i + 30).min(bytes.len())];
                if tail.len() == 26 && tail.iter().all(|b| ULID_CHARS.contains(b)) {
                    let raw = &text[i..i + 30];
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
                    i += 30;
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

fn build_fixtures() -> BTreeMap<String, Value> {
    let tmp = tempfile::tempdir().unwrap();
    let data_root = tmp.path().join("data");
    let double = Arc::new(TestProvider::default());
    let registry =
        ProviderRegistry::new(vec![Arc::new(GeminiProvider::new()), Arc::new(LocalPreviewProvider), double.clone()]);
    let core = AppCore::open_with(&data_root, registry, Arc::new(MemorySecretStore::default())).unwrap();
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

    // Project with a master, a completed hero generation and a failed one.
    let p = test_create_villa(&core, "Fixture villa");
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
    let done =
        submit_and_run(&core, submit_request(&p.id, local_preview::ID, local_preview::MODEL_ID, &[&master.id], 2))
            .unwrap();
    rec.record("generation_submit_completed", "generation_submit", &done);

    let missing_key = generations::submit(&core, submit_request(&p.id, "gemini", "gemini-2.5-flash-image", &[], 1))
        .expect_err("gemini has no key");
    rec.record_error("error_provider_not_configured", &missing_key);

    provider_settings::set_api_key(&core, TEST_PROVIDER, "fixture-test-key").unwrap();
    double.set_behavior(TestBehavior::Fail(ProviderErrorKind::Blocked));
    let failed = submit_and_run(&core, submit_request(&p.id, TEST_PROVIDER, "full", &[], 1)).unwrap();
    rec.record("generation_submit_failed", "generation_submit", &failed);

    rec.record("generation_list", "generation_list", &generations::list(&core, &p.id).unwrap());
    rec.record("generation_get", "generation_get", &generations::get(&core, &p.id, &done.id).unwrap());
    rec.record("version_list", "version_list", &assets::list_versions(&core, &p.id).unwrap());
    rec.record("project_get", "project_get", &projects::get(&core, &p.id).unwrap());
    rec.out
}

#[test]
fn backend_fixtures_are_current() {
    let fixtures = build_fixtures();
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
