//! Application use cases. Each function is small and owns one invariant set;
//! Tauri commands are thin wrappers around these.

pub mod assets;
pub mod dna;
pub mod dna_validation;
pub mod generations;
pub mod projects;
pub mod provider_settings;
pub mod status;

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use rusqlite::Connection;

use crate::db;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::providers::ProviderRegistry;
use crate::repositories::ProjectRow;
use crate::secrets::{KeyringSecretStore, SecretStore};
use crate::storage::Storage;

pub const DB_FILE: &str = "studio.db";

/// Process-wide application state: one SQLite connection, managed storage, the compiled-in
/// image providers and the API-key store.
pub struct AppCore {
    db: Mutex<Connection>,
    pub storage: Storage,
    pub providers: ProviderRegistry,
    pub secrets: Arc<dyn SecretStore>,
}

impl AppCore {
    /// Production wiring: builtin providers + OS keychain.
    pub fn open(data_root: &Path) -> AppResult<Self> {
        Self::open_with(data_root, ProviderRegistry::builtin(), Arc::new(KeyringSecretStore))
    }

    /// Explicit wiring (tests use a memory secret store and test-double providers).
    /// Generations left `running` by a previous process become `interrupted` here.
    pub fn open_with(data_root: &Path, providers: ProviderRegistry, secrets: Arc<dyn SecretStore>) -> AppResult<Self> {
        let conn = db::open(&data_root.join(DB_FILE))?;
        let interrupted = generations::recover_interrupted(&conn)?;
        if interrupted > 0 {
            eprintln!("[generations] marked {interrupted} unfinished generation(s) as interrupted");
        }
        Ok(Self { db: Mutex::new(conn), storage: Storage::new(data_root), providers, secrets })
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
        let double = Arc::new(TestProvider::default());
        let registry = ProviderRegistry::new(vec![Arc::new(LocalPreviewProvider), double.clone()]);
        let core = AppCore::open_with(root, registry, Arc::new(MemorySecretStore::default())).unwrap();
        (core, double)
    }

    pub(crate) use crate::services::dna_validation::tests::minimal as test_valid_dna;
    pub(crate) use crate::services::projects::tests::create_villa as test_create_villa;

    pub fn write_png(dir: &Path, name: &str, w: u32, h: u32, rgb: [u8; 3]) -> PathBuf {
        let path = dir.join(name);
        image::RgbImage::from_pixel(w, h, image::Rgb(rgb)).save(&path).unwrap();
        path
    }

    pub const TEST_PROVIDER: &str = "test_remote";
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
    }

    type Hook = Box<dyn Fn() + Send + Sync>;

    /// Remote-style provider double: needs a key, records the request it received, and runs
    /// an optional hook *during* the call (to inspect or change state mid-generation).
    pub struct TestProvider {
        behavior: Mutex<TestBehavior>,
        pub last_request: Mutex<Option<ProviderRequest>>,
        calls: AtomicUsize,
        hook: Mutex<Option<Hook>>,
    }

    impl Default for TestProvider {
        fn default() -> Self {
            Self {
                behavior: Mutex::new(TestBehavior::Images),
                last_request: Mutex::new(None),
                calls: AtomicUsize::new(0),
                hook: Mutex::new(None),
            }
        }
    }

    impl TestProvider {
        pub fn set_behavior(&self, b: TestBehavior) {
            *self.behavior.lock().unwrap() = b;
        }

        pub fn set_hook(&self, hook: impl Fn() + Send + Sync + 'static) {
            *self.hook.lock().unwrap() = Some(Box::new(hook));
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
        }
    }

    impl ImageProvider for TestProvider {
        fn info(&self) -> ProviderInfo {
            let mut full = model("full", true, true, 2, 2);
            full.aspect_ratios = vec!["1:1".into(), "16:9".into()];
            full.image_sizes = vec!["1K".into(), "2K".into()];
            let mut text_only = model("text-only", true, false, 0, 1);
            text_only.supports_seed = true;
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
            if let Some(hook) = self.hook.lock().unwrap().as_ref() {
                hook();
            }
            let images = match *self.behavior.lock().unwrap() {
                TestBehavior::Fail(kind) => return Err(ProviderError::new(kind, "Test provider failure.")),
                TestBehavior::NoImages => vec![],
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

        fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError> {
            match api_key {
                Some(GOOD_KEY) => Ok("Key accepted.".into()),
                _ => Err(ProviderError::new(ProviderErrorKind::Auth, "The API key was rejected.")),
            }
        }
    }
}
