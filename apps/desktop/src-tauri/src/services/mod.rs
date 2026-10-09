//! Application use cases. Each function is small and owns one invariant set;
//! Tauri commands are thin wrappers around these.

pub mod anchors;
pub mod assets;
pub mod batches;
pub mod dna;
pub mod dna_validation;
pub mod generations;
pub mod grade;
pub mod projects;
pub mod prompt_enhance;
pub mod provider_settings;
pub mod queue;
pub mod status;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::db;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::providers::ProviderRegistry;
use crate::repositories::ProjectRow;
use crate::secrets::{EnvSource, FixedEnv, KeyringSecretStore, ProcessEnv, SecretStore};
use crate::storage::Storage;

pub const DB_FILE: &str = "studio.db";

/// Process-wide application state: one SQLite connection, managed storage, the compiled-in
/// image providers, the API-key store and the job queue (slots, clock, event sink).
pub struct AppCore {
    db: Mutex<Connection>,
    pub storage: Storage,
    pub providers: ProviderRegistry,
    pub secrets: Arc<dyn SecretStore>,
    /// Development key fallback (`ARCH_STUDIO_<PROVIDER>_API_KEY`). The process environment
    /// in the app; empty for every core made with [`AppCore::open_with`].
    pub env: Arc<dyn EnvSource>,
    /// Time source of the job queue (timestamps, retry backoff). Tests inject a manual clock.
    pub clock: Arc<dyn queue::Clock>,
    /// Receives job/generation updates. The app sets a Tauri emitter before sharing the core.
    pub notifier: Arc<dyn queue::Notifier>,
    pub(crate) queue: queue::QueueState,
}

impl AppCore {
    /// Production wiring: builtin providers + OS keychain + process-environment key fallback.
    pub fn open(data_root: &Path) -> AppResult<Self> {
        let mut core = Self::open_with(data_root, ProviderRegistry::builtin(), Arc::new(KeyringSecretStore))?;
        core.env = Arc::new(ProcessEnv);
        Ok(core)
    }

    /// Explicit wiring (tests use a memory secret store and test-double providers). The key
    /// fallback environment starts empty, so a key in the developer's shell is never used.
    /// Jobs and generations left `running` by a previous process become `interrupted` here;
    /// `queued` and `retrying` jobs stay and resume once the worker runs.
    pub fn open_with(data_root: &Path, providers: ProviderRegistry, secrets: Arc<dyn SecretStore>) -> AppResult<Self> {
        let conn = db::open(&data_root.join(DB_FILE))?;
        let interrupted = generations::recover_interrupted(&conn, &crate::util::now_iso())?;
        if interrupted > 0 {
            eprintln!("[generations] marked {interrupted} unfinished generation(s) as interrupted");
        }
        Ok(Self {
            db: Mutex::new(conn),
            storage: Storage::new(data_root),
            providers,
            secrets,
            env: Arc::new(FixedEnv::default()),
            clock: Arc::new(queue::SystemClock),
            notifier: Arc::new(queue::NoopNotifier),
            queue: queue::QueueState::default(),
        })
    }

    /// Current time of the queue clock, as stored in the DB.
    pub fn now_iso(&self) -> String {
        queue::iso(self.clock.now())
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
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use super::AppCore;
    use crate::providers::local_preview::LocalPreviewProvider;
    use crate::providers::{
        ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderImage, ProviderInfo, ProviderKind,
        ProviderOutput, ProviderRegistry, ProviderRequest,
    };
    use crate::secrets::MemorySecretStore;

    /// Fresh data root + core per test. Keep the TempDir alive for the test's duration.
    /// Wired with the memory secret store, `local_preview` and a [`TestProvider`].
    pub fn core() -> (tempfile::TempDir, AppCore) {
        let tmp = tempfile::tempdir().unwrap();
        let (core, _) = open_test_core(&tmp.path().join("data"));
        (tmp, core)
    }

    /// Like [`core`], but shared (so provider hooks can hold a `Weak`) and with the double.
    pub fn core_with_double() -> (tempfile::TempDir, Arc<AppCore>, Arc<TestProvider>) {
        let tmp = tempfile::tempdir().unwrap();
        let (core, double) = open_test_core(&tmp.path().join("data"));
        (tmp, Arc::new(core), double)
    }

    /// Open (or reopen) a test core at `root` with a new double and an empty memory store.
    pub fn open_test_core(root: &Path) -> (AppCore, Arc<TestProvider>) {
        let (core, double, _) = open_queue_core(root);
        (core, double)
    }

    /// Like [`open_test_core`], plus a local-kind double (`test_local`, 2 slots).
    pub fn open_queue_core(root: &Path) -> (AppCore, Arc<TestProvider>, Arc<TestProvider>) {
        let double = Arc::new(TestProvider::default());
        let local = Arc::new(TestProvider::local());
        let registry = ProviderRegistry::new(vec![Arc::new(LocalPreviewProvider), double.clone(), local.clone()]);
        let core = AppCore::open_with(root, registry, Arc::new(MemorySecretStore::default())).unwrap();
        (core, double, local)
    }

    /// Everything a queue test needs: manual clock, event recorder, a remote and a local
    /// double. Nothing runs until the test calls `queue::tick` / `run_queue`.
    pub struct QueueHarness {
        pub tmp: tempfile::TempDir,
        pub core: Arc<AppCore>,
        pub remote: Arc<TestProvider>,
        pub local: Arc<TestProvider>,
        pub clock: Arc<ManualClock>,
        pub events: Arc<RecordingNotifier>,
    }

    pub fn queue_harness() -> QueueHarness {
        let tmp = tempfile::tempdir().unwrap();
        let (mut core, remote, local) = open_queue_core(&tmp.path().join("data"));
        let clock = Arc::new(ManualClock::new());
        let events = Arc::new(RecordingNotifier::default());
        core.clock = clock.clone();
        core.notifier = events.clone();
        QueueHarness { tmp, core: Arc::new(core), remote, local, clock, events }
    }

    /// Run the queue on this thread at the core's clock until nothing more can start now.
    pub fn run_queue(core: &AppCore) {
        while crate::services::queue::tick(core, core.clock.now()).unwrap() > 0 {}
    }

    /// Submit and run to the end (Phase 2 tests: the old synchronous behaviour).
    pub fn submit_and_run(
        core: &AppCore,
        req: crate::services::generations::SubmitRequest,
    ) -> crate::error::AppResult<crate::dto::GenerationDto> {
        let g = crate::services::generations::submit(core, req)?;
        run_queue(core);
        crate::services::generations::get(core, &g.project_id, &g.id)
    }

    /// A valid one-output request with an inline prompt (references and camera optional).
    pub fn test_request(
        project_id: &str,
        provider: &str,
        model: &str,
        refs: &[&str],
        camera_id: Option<&str>,
    ) -> crate::services::generations::SubmitRequest {
        serde_json::from_value(serde_json::json!({
            "projectId": project_id, "providerId": provider, "modelId": model, "purpose": "hero",
            "prompt": { "compilerVersion": "1", "positivePrompt": "Villa at dusk", "negativePrompt": "",
                        "referenceInstructions": "", "preservationInstructions": "", "metadata": {} },
            "referenceAssetIds": refs,
            "params": { "aspectRatio": null, "imageSize": null, "outputCount": 1, "seed": null },
            "cameraId": camera_id
        }))
        .unwrap()
    }

    /// Import a small PNG into the project.
    pub fn test_import(core: &AppCore, dir: &Path, project_id: &str, name: &str, role: &str) -> crate::dto::AssetDto {
        let rgb = [name.len() as u8 * 17, 80, 160];
        crate::services::assets::import(
            core,
            crate::services::assets::ImportRequest {
                project_id: project_id.into(),
                source_path: write_png(dir, name, 24, 16, rgb).to_string_lossy().into_owned(),
                source: "external".into(),
                role: role.into(),
                allow_duplicate: true,
            },
        )
        .unwrap()
    }

    /// Replace the DNA cameras: `(id, name, isAnchorView)`.
    pub fn set_cameras(core: &AppCore, project_id: &str, cameras: &[(&str, &str, bool)]) {
        let mut dna = crate::services::dna::get(core, project_id).unwrap();
        dna["cameras"] = cameras
            .iter()
            .map(|(id, name, anchor)| {
                serde_json::json!({ "schemaVersion": 1, "id": id, "name": name, "viewType": "exterior_corner",
                                    "isAnchorView": anchor, "notes": "" })
            })
            .collect();
        crate::services::dna::update(core, project_id, dna).unwrap();
    }

    /// Camera ids that satisfy `CAM_<ULID>`.
    pub const CAM_A: &str = "CAM_01J9ZZZZZZZZZZZZZZZZZZZZZA";
    pub const CAM_B: &str = "CAM_01J9ZZZZZZZZZZZZZZZZZZZZZB";
    pub const CAM_C: &str = "CAM_01J9ZZZZZZZZZZZZZZZZZZZZZC";

    /// Settable clock; starts at a fixed instant.
    pub struct ManualClock(Mutex<chrono::DateTime<chrono::Utc>>);

    impl ManualClock {
        pub fn new() -> Self {
            Self(Mutex::new("2026-10-01T08:00:00Z".parse().unwrap()))
        }

        pub fn advance_secs(&self, secs: i64) {
            *self.0.lock().unwrap() += chrono::Duration::seconds(secs);
        }
    }

    impl crate::services::queue::Clock for ManualClock {
        fn now(&self) -> chrono::DateTime<chrono::Utc> {
            *self.0.lock().unwrap()
        }
    }

    /// Records every event as `(event name, id, status)`.
    #[derive(Default)]
    pub struct RecordingNotifier {
        pub events: Mutex<Vec<(&'static str, String, String)>>,
    }

    impl RecordingNotifier {
        pub fn take(&self) -> Vec<(&'static str, String, String)> {
            std::mem::take(&mut *self.events.lock().unwrap())
        }

        /// Job statuses seen for one job, in order.
        pub fn job_statuses(&self, job_id: &str) -> Vec<String> {
            let events = self.events.lock().unwrap();
            events.iter().filter(|(e, id, _)| *e == "job" && id == job_id).map(|(_, _, s)| s.clone()).collect()
        }
    }

    impl crate::services::queue::Notifier for RecordingNotifier {
        fn job_updated(&self, job: &crate::dto::JobDto) {
            self.events.lock().unwrap().push(("job", job.id.clone(), job.status.as_str().to_string()));
        }

        fn generation_updated(&self, g: &crate::dto::GenerationDto) {
            self.events.lock().unwrap().push(("generation", g.id.clone(), g.status.as_str().to_string()));
        }
    }

    pub(crate) use crate::services::dna_validation::tests::minimal as test_valid_dna;
    pub(crate) use crate::services::projects::tests::create_villa as test_create_villa;

    pub fn write_png(dir: &Path, name: &str, w: u32, h: u32, rgb: [u8; 3]) -> PathBuf {
        let path = dir.join(name);
        image::RgbImage::from_pixel(w, h, image::Rgb(rgb)).save(&path).unwrap();
        path
    }

    pub const TEST_PROVIDER: &str = "test_remote";
    /// Local-kind double (no key, 2 slots).
    pub const TEST_LOCAL_PROVIDER: &str = "test_local";
    /// Accepted by [`TestProvider::test_connection`].
    pub const GOOD_KEY: &str = "good-test-key";

    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum TestBehavior {
        /// One small PNG per requested output.
        Images,
        Fail(ProviderErrorKind),
        /// Bytes that are not an image (e.g. an HTML error page).
        NotAnImage,
        NoImages,
        /// A PNG whose header is valid but whose pixel data is corrupt.
        CorruptPixels,
    }

    /// Valid PNG signature + IHDR (so `imaging::inspect` passes), garbage inside IDAT.
    pub fn corrupt_pixel_png() -> Vec<u8> {
        let img = image::RgbImage::from_fn(64, 48, |x, y| image::Rgb([(x * 7) as u8, (y * 13) as u8, (x ^ y) as u8]));
        let mut bytes = Vec::new();
        img.write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
        let idat = bytes.windows(4).position(|w| w == b"IDAT").unwrap();
        let len = u32::from_be_bytes(bytes[idat - 4..idat].try_into().unwrap()) as usize;
        // Keep the 2-byte zlib header, scramble the deflate stream.
        for b in &mut bytes[idat + 6..idat + 4 + len] {
            *b = !*b ^ 0x5A;
        }
        bytes
    }

    type Hook = Arc<dyn Fn() + Send + Sync>;

    /// Remote-style provider double: needs a key, records the request it received, and runs
    /// an optional hook *during* the call (to inspect or change state mid-generation).
    pub struct TestProvider {
        local: bool,
        /// Behaviours for the next calls, used before `behavior` (one per call).
        script: Mutex<std::collections::VecDeque<TestBehavior>>,
        behavior: Mutex<TestBehavior>,
        pub last_request: Mutex<Option<ProviderRequest>>,
        /// `(system, user, api_key)` of the last `chat` call.
        pub last_chat: Mutex<Option<(String, String, Option<String>)>>,
        calls: AtomicUsize,
        hook: Mutex<Option<Hook>>,
        /// `auto_retries_timeouts` answer (default true, like most providers).
        pub retry_timeouts: std::sync::atomic::AtomicBool,
    }

    impl Default for TestProvider {
        fn default() -> Self {
            Self {
                local: false,
                script: Mutex::new(Default::default()),
                behavior: Mutex::new(TestBehavior::Images),
                last_request: Mutex::new(None),
                last_chat: Mutex::new(None),
                calls: AtomicUsize::new(0),
                hook: Mutex::new(None),
                retry_timeouts: std::sync::atomic::AtomicBool::new(true),
            }
        }
    }

    impl TestProvider {
        pub fn local() -> Self {
            Self { local: true, ..Self::default() }
        }

        /// The next calls behave like this, one entry per call, then `behavior` again.
        pub fn script(&self, behaviors: &[TestBehavior]) {
            self.script.lock().unwrap().extend(behaviors.iter().copied());
        }

        pub fn set_behavior(&self, b: TestBehavior) {
            *self.behavior.lock().unwrap() = b;
        }

        pub fn set_hook(&self, hook: impl Fn() + Send + Sync + 'static) {
            *self.hook.lock().unwrap() = Some(Arc::new(hook));
        }

        pub fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    fn model(id: &str, t2i: bool, i2i: bool, max_refs: u32, max_outputs: u32) -> ModelCapabilities {
        ModelCapabilities {
            id: id.into(),
            label: format!("Test {id}"),
            text_to_image: t2i,
            image_to_image: i2i,
            max_reference_images: max_refs,
            max_outputs,
            aspect_ratios: vec![],
            image_sizes: vec![],
            supports_negative_prompt: false,
            supports_seed: false,
            quality_options: Vec::new(),
            price_hint: None,
        }
    }

    impl ImageProvider for TestProvider {
        fn info(&self) -> ProviderInfo {
            let mut full = model("full", true, true, 2, 2);
            full.aspect_ratios = vec!["1:1".into(), "16:9".into()];
            full.image_sizes = vec!["1K".into(), "2K".into()];
            full.quality_options = vec!["low".into(), "high".into()];
            let mut text_only = model("text-only", true, false, 0, 1);
            text_only.supports_seed = true;
            if self.local {
                return ProviderInfo {
                    id: TEST_LOCAL_PROVIDER,
                    label: "Test local",
                    kind: ProviderKind::Local,
                    requires_api_key: false,
                    models: vec![model("full", true, true, 2, 2)],
                };
            }
            ProviderInfo {
                id: TEST_PROVIDER,
                label: "Test remote",
                kind: ProviderKind::Remote,
                requires_api_key: true,
                models: vec![full, text_only, model("edit-only", false, true, 1, 1)],
            }
        }

        fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            *self.last_request.lock().unwrap() = Some(request.clone());
            // Cloned out of the lock so parallel calls can run their hooks at the same time.
            let hook = self.hook.lock().unwrap().clone();
            if let Some(hook) = hook {
                hook();
            }
            let scripted = self.script.lock().unwrap().pop_front();
            let images = match scripted.unwrap_or(*self.behavior.lock().unwrap()) {
                TestBehavior::Fail(kind) => return Err(ProviderError::new(kind, "Test provider failure.")),
                TestBehavior::NoImages => vec![],
                TestBehavior::CorruptPixels => {
                    vec![ProviderImage { mime_type: "image/png".into(), bytes: corrupt_pixel_png() }]
                }
                TestBehavior::NotAnImage => {
                    vec![ProviderImage { mime_type: "image/png".into(), bytes: b"<html>oops</html>".to_vec() }]
                }
                TestBehavior::Images => (0..request.params.output_count)
                    .map(|i| {
                        let mut bytes = Vec::new();
                        image::RgbImage::from_pixel(8, 6, image::Rgb([i as u8 * 40, 100, 200]))
                            .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png)
                            .unwrap();
                        ProviderImage { mime_type: "image/png".into(), bytes }
                    })
                    .collect(),
            };
            Ok(ProviderOutput { images, meta: serde_json::json!({}) })
        }

        fn auto_retries_timeouts(&self) -> bool {
            self.retry_timeouts.load(Ordering::SeqCst)
        }

        fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError> {
            match api_key {
                Some(GOOD_KEY) => Ok("Key accepted.".into()),
                _ => Err(ProviderError::new(ProviderErrorKind::Auth, "The API key was rejected.")),
            }
        }

        fn chat_model(&self) -> Option<String> {
            (!self.local).then(|| "test-chat".to_string())
        }

        /// Answers `Enhanced: <last line of the user message>`, or fails like `generate`.
        fn chat(&self, system: &str, user: &str, api_key: Option<&str>) -> Result<String, ProviderError> {
            *self.last_chat.lock().unwrap() = Some((system.into(), user.into(), api_key.map(str::to_string)));
            if let TestBehavior::Fail(kind) = *self.behavior.lock().unwrap() {
                return Err(ProviderError::new(kind, "Test provider failure."));
            }
            Ok(format!("Enhanced: {}", user.lines().last().unwrap_or_default()))
        }
    }
}
