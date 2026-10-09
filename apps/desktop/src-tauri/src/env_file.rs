//! `.env` loading at startup (development convenience for provider settings such as
//! `HHTECH_BASE_URL` / `HHTECH_API_KEY`).
//!
//! Rules: a variable that is already set is never overridden (the real environment wins, and
//! the first file loaded wins over later ones); values are never logged, only file paths.
//! Files, in order:
//! 1. `ARCH_STUDIO_ENV_FILE`, if set (an explicit file, e.g. the main checkout's `.env` when
//!    running from a git worktree);
//! 2. `.env` in the current working directory;
//! 3. dev builds only: `.env` in each parent directory of the working directory, then in the
//!    repository root this binary was built from (`tauri dev` runs in `apps/desktop/src-tauri`).

use std::path::{Path, PathBuf};

pub const ENV_FILE_VAR: &str = "ARCH_STUDIO_ENV_FILE";

/// Candidate files in load order (existing or not), without duplicates.
pub fn candidates(explicit: Option<PathBuf>, cwd: Option<&Path>, dev: bool) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut push = |p: PathBuf| {
        if !out.contains(&p) {
            out.push(p);
        }
    };
    if let Some(file) = explicit {
        push(file);
    }
    if let Some(cwd) = cwd {
        push(cwd.join(".env"));
        if dev {
            for dir in cwd.ancestors().skip(1) {
                push(dir.join(".env"));
            }
        }
    }
    if dev {
        // CARGO_MANIFEST_DIR = <repo>/apps/desktop/src-tauri.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        push(root.canonicalize().unwrap_or(root).join(".env"));
    }
    out
}

/// Loads every existing candidate file; returns the paths that were loaded.
pub fn load_dotenv() -> Vec<PathBuf> {
    let explicit = std::env::var_os(ENV_FILE_VAR).map(PathBuf::from);
    let cwd = std::env::current_dir().ok();
    let mut loaded = Vec::new();
    for path in candidates(explicit, cwd.as_deref(), cfg!(debug_assertions)) {
        if !path.is_file() {
            continue;
        }
        // `from_path` never overrides a variable that is already set.
        match dotenvy::from_path(&path) {
            Ok(()) => loaded.push(path),
            // The parse error may quote a line of the file; report the path only.
            Err(_) => eprintln!("[env] could not parse {}; it was skipped", path.display()),
        }
    }
    loaded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_order_explicit_cwd_parents_then_repo_root() {
        let cwd = Path::new("/a/b/c");
        let release = candidates(Some(PathBuf::from("/x/my.env")), Some(cwd), false);
        assert_eq!(release, [PathBuf::from("/x/my.env"), cwd.join(".env")], "release: no walking up");
        let dev = candidates(None, Some(cwd), true);
        assert_eq!(
            dev[..4],
            [cwd.join(".env"), PathBuf::from("/a/b/.env"), PathBuf::from("/a/.env"), PathBuf::from("/.env")]
        );
        assert!(dev.last().unwrap().ends_with(".env"));
    }

    #[test]
    fn loading_never_overrides_set_variables() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(".env");
        std::fs::write(&file, "ARCH_STUDIO_ENV_FILE_TEST_SET=from-file\nARCH_STUDIO_ENV_FILE_TEST_NEW=from-file\n")
            .unwrap();
        // Unique names: no other test reads them.
        std::env::set_var("ARCH_STUDIO_ENV_FILE_TEST_SET", "from-env");
        dotenvy::from_path(&file).unwrap();
        assert_eq!(std::env::var("ARCH_STUDIO_ENV_FILE_TEST_SET").unwrap(), "from-env");
        assert_eq!(std::env::var("ARCH_STUDIO_ENV_FILE_TEST_NEW").unwrap(), "from-file");
    }
}
