//! AI Architecture Image Studio — desktop backend.
//!
//! Layers: `domain` (enums) <- `repositories` (SQL) <- `services` (use cases) <- `commands`
//! (Tauri bridge). Storage and imaging are infrastructure helpers used by services.

pub mod commands;
#[cfg(test)]
mod contract_fixtures;
pub mod db;
pub mod domain;
pub mod dto;
pub mod env_file;
pub mod error;
pub mod imaging;
pub mod providers;
pub mod repositories;
pub mod secrets;
pub mod services;
pub mod storage;
pub mod util;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use dto::{GenerationDto, JobDto};
use services::queue::{self, Notifier};
use services::AppCore;

/// Override the data folder (useful for testing with a throwaway profile).
pub const DATA_DIR_ENV: &str = "ARCH_STUDIO_DATA_DIR";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything reads the environment (provider settings, key fallback). Never
    // overrides variables that are already set; only paths are printed.
    for path in env_file::load_dotenv() {
        eprintln!("[env] loaded {}", path.display());
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_root = match std::env::var_os(DATA_DIR_ENV) {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            // A failed migration aborts startup instead of running on a partial schema.
            let mut core =
                AppCore::open(&data_root).map_err(|e| format!("Cannot open project database: {}", e.message))?;
            core.notifier = Arc::new(TauriNotifier(app.handle().clone()));
            core.storage.ensure_projects_root().map_err(|e| e.message)?;
            // Only managed project files may be served to the webview.
            app.asset_protocol_scope().allow_directory(core.storage.projects_root(), true)?;
            let core = Arc::new(core);
            app.manage(Arc::clone(&core));
            // Resumes jobs left `queued`/`retrying` by the previous run (ADR-017).
            queue::start_worker(core)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::project_create,
            commands::project_list,
            commands::project_get,
            commands::project_update_metadata,
            commands::project_set_archived,
            commands::project_approve_master,
            commands::dna_get,
            commands::dna_update,
            commands::asset_import,
            commands::asset_list,
            commands::asset_update_role,
            commands::asset_set_master,
            commands::asset_remove,
            commands::version_list,
            commands::provider_list,
            commands::provider_set_api_key,
            commands::provider_clear_api_key,
            commands::provider_test,
            commands::prompt_enhance,
            commands::generation_submit,
            commands::generation_list,
            commands::generation_get,
            commands::batch_create,
            commands::batch_list,
            commands::job_list,
            commands::job_cancel,
            commands::job_retry,
            commands::camera_anchor_list,
            commands::camera_anchor_set,
            commands::camera_anchor_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arch AI Studio");
}

/// Forwards queue updates to the webview as Tauri events (payload = the DTO).
struct TauriNotifier(AppHandle);

impl Notifier for TauriNotifier {
    fn job_updated(&self, job: &JobDto) {
        if let Err(e) = self.0.emit(queue::JOB_UPDATED_EVENT, job) {
            eprintln!("[queue] cannot emit {}: {e}", queue::JOB_UPDATED_EVENT);
        }
    }

    fn generation_updated(&self, generation: &GenerationDto) {
        if let Err(e) = self.0.emit(queue::GENERATION_UPDATED_EVENT, generation) {
            eprintln!("[queue] cannot emit {}: {e}", queue::GENERATION_UPDATED_EVENT);
        }
    }
}
