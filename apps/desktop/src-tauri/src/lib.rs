//! AI Architecture Image Studio — desktop backend.
//!
//! Layers: `domain` (enums) <- `repositories` (SQL) <- `services` (use cases) <- `commands`
//! (Tauri bridge). Storage and imaging are infrastructure helpers used by services.

pub mod commands;
pub mod db;
pub mod domain;
pub mod dto;
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

use tauri::Manager;

use services::AppCore;

/// Override the data folder (useful for testing with a throwaway profile).
pub const DATA_DIR_ENV: &str = "ARCH_STUDIO_DATA_DIR";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_root = match std::env::var_os(DATA_DIR_ENV) {
                Some(dir) => PathBuf::from(dir),
                None => app.path().app_data_dir()?,
            };
            // A failed migration aborts startup instead of running on a partial schema.
            let core = AppCore::open(&data_root).map_err(|e| format!("Cannot open project database: {}", e.message))?;
            core.storage.ensure_projects_root().map_err(|e| e.message)?;
            // Only managed project files may be served to the webview.
            app.asset_protocol_scope().allow_directory(core.storage.projects_root(), true)?;
            app.manage(Arc::new(core));
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arch AI Studio");
}
