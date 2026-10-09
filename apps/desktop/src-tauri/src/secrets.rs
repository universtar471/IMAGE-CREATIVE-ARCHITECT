//! Provider API keys (ADR-013). Keys live in the OS credential store, keyed by provider id;
//! an environment variable is a read-only development fallback. SQLite never sees a key.
//!
//! Keys must never reach logs, error messages or DTOs: errors here describe the store, not
//! the value, and [`ResolvedKey`] redacts itself in `Debug`.

use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;

use serde::Serialize;

use crate::error::{AppError, AppResult, ErrorCode};

pub const KEYRING_SERVICE: &str = "com.archaistudio.desktop.provider";
pub const MAX_KEY_LEN: usize = 512;

/// Where a provider key was found. Serialized as `keySource` in `ProviderDescriptorDTO`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KeySource {
    Keychain,
    Env,
}

pub trait SecretStore: Send + Sync {
    fn get(&self, provider_id: &str) -> AppResult<Option<String>>;
    /// Stores an already-cleaned key (see [`clean_key`]).
    fn set(&self, provider_id: &str, secret: &str) -> AppResult<()>;
    /// Removing a key that does not exist is not an error.
    fn delete(&self, provider_id: &str) -> AppResult<()>;
}

/// OS credential store (Windows Credential Manager / macOS Keychain).
pub struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry(provider_id: &str) -> AppResult<keyring::Entry> {
        keyring::Entry::new(KEYRING_SERVICE, provider_id).map_err(store_error)
    }
}

/// `keyring` errors describe the store, never the secret, so their text is safe to surface.
fn store_error(err: keyring::Error) -> AppError {
    AppError::new(ErrorCode::IoError, format!("The OS credential store is not available: {err}"))
}

impl SecretStore for KeyringSecretStore {
    fn get(&self, provider_id: &str) -> AppResult<Option<String>> {
        match Self::entry(provider_id)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(store_error(e)),
        }
    }

    fn set(&self, provider_id: &str, secret: &str) -> AppResult<()> {
        Self::entry(provider_id)?.set_password(secret).map_err(store_error)
    }

    fn delete(&self, provider_id: &str) -> AppResult<()> {
        match Self::entry(provider_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(store_error(e)),
        }
    }
}

/// In-process store for tests (never touches the OS keychain).
#[derive(Default)]
pub struct MemorySecretStore {
    keys: Mutex<HashMap<String, String>>,
}

impl MemorySecretStore {
    fn keys(&self) -> AppResult<std::sync::MutexGuard<'_, HashMap<String, String>>> {
        self.keys.lock().map_err(|_| AppError::new(ErrorCode::IoError, "Secret store lock was poisoned."))
    }
}

impl SecretStore for MemorySecretStore {
    fn get(&self, provider_id: &str) -> AppResult<Option<String>> {
        Ok(self.keys()?.get(provider_id).cloned())
    }

    fn set(&self, provider_id: &str, secret: &str) -> AppResult<()> {
        self.keys()?.insert(provider_id.to_string(), secret.to_string());
        Ok(())
    }

    fn delete(&self, provider_id: &str) -> AppResult<()> {
        self.keys()?.remove(provider_id);
        Ok(())
    }
}

/// Where the development fallback `ARCH_STUDIO_<PROVIDER>_API_KEY` is read from. Injected so
/// tests and contract fixtures never see a key that happens to be set in the developer's
/// shell (which would make them call a real paid API).
pub trait EnvSource: Send + Sync {
    fn var(&self, name: &str) -> Option<String>;
}

/// The real process environment (production `AppCore::open`).
pub struct ProcessEnv;

impl EnvSource for ProcessEnv {
    fn var(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }
}

/// A fixed environment; `FixedEnv::default()` is empty (tests, fixtures).
#[derive(Default)]
pub struct FixedEnv(pub HashMap<String, String>);

impl FixedEnv {
    pub fn with(name: &str, value: &str) -> Self {
        Self(HashMap::from([(name.to_string(), value.to_string())]))
    }
}

impl EnvSource for FixedEnv {
    fn var(&self, name: &str) -> Option<String> {
        self.0.get(name).cloned()
    }
}

/// A key ready to hand to an adapter, plus where it came from.
#[derive(Clone)]
pub struct ResolvedKey {
    pub value: String,
    pub source: KeySource,
}

impl fmt::Debug for ResolvedKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ResolvedKey").field("value", &"<redacted>").field("source", &self.source).finish()
    }
}

/// `ARCH_STUDIO_<PROVIDER_ID>_API_KEY`, e.g. `ARCH_STUDIO_GEMINI_API_KEY`.
pub fn env_var_name(provider_id: &str) -> String {
    format!("ARCH_STUDIO_{}_API_KEY", provider_id.to_uppercase())
}

/// Environment variables holding a provider's key, in lookup order: a vendor's own name where
/// one is conventional (`HHTECH_API_KEY`), then `ARCH_STUDIO_<PROVIDER_ID>_API_KEY`.
pub fn env_var_names(provider_id: &str) -> Vec<String> {
    let mut names = Vec::new();
    if provider_id == crate::providers::hhtech::ID {
        names.push(crate::providers::hhtech::ENV_API_KEY.to_string());
    }
    names.push(env_var_name(provider_id));
    names
}

/// Keychain first, then the environment fallback ([`env_var_names`], first non-blank wins). A keychain that cannot be read is
/// reported on stderr (without the key) and treated as empty, so the env fallback and the
/// provider list keep working on machines without a credential store.
pub fn resolve_key(store: &dyn SecretStore, env: &dyn EnvSource, provider_id: &str) -> Option<ResolvedKey> {
    match store.get(provider_id) {
        Ok(Some(value)) if !value.trim().is_empty() => {
            return Some(ResolvedKey { value, source: KeySource::Keychain });
        }
        Ok(_) => {}
        Err(e) => eprintln!("[secrets] cannot read key for '{provider_id}': {}", e.message),
    }
    env_var_names(provider_id)
        .iter()
        .filter_map(|name| env.var(name))
        .map(|v| v.trim().to_string())
        .find(|v| !v.is_empty())
        .map(|value| ResolvedKey { value, source: KeySource::Env })
}

/// Trim and validate a key typed by the user. Messages never echo the key.
pub fn clean_key(raw: &str) -> AppResult<String> {
    let key = raw.trim();
    if key.is_empty() {
        return Err(AppError::validation("The API key is empty."));
    }
    if key.chars().count() > MAX_KEY_LEN {
        return Err(AppError::validation(format!("The API key is longer than {MAX_KEY_LEN} characters.")));
    }
    if key.chars().any(char::is_whitespace) {
        return Err(AppError::validation("The API key must not contain spaces or line breaks."));
    }
    Ok(key.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_key_trims_and_rejects_bad_input() {
        assert_eq!(clean_key("  abc-123\n").unwrap(), "abc-123");
        assert_eq!(clean_key("   ").unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(clean_key("ab cd").unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(clean_key(&"x".repeat(MAX_KEY_LEN + 1)).unwrap_err().code, ErrorCode::ValidationError);
        assert!(clean_key(&"x".repeat(MAX_KEY_LEN)).is_ok());
        let err = clean_key("secret value").unwrap_err();
        assert!(!err.message.contains("secret"), "messages must not echo the key");
    }

    #[test]
    fn env_var_name_uses_uppercase_provider_id() {
        assert_eq!(env_var_name("gemini"), "ARCH_STUDIO_GEMINI_API_KEY");
        assert_eq!(env_var_name("local_preview"), "ARCH_STUDIO_LOCAL_PREVIEW_API_KEY");
    }

    #[test]
    fn hhtech_reads_its_own_variable_first() {
        assert_eq!(env_var_names("hhtech"), ["HHTECH_API_KEY", "ARCH_STUDIO_HHTECH_API_KEY"]);
        assert_eq!(env_var_names("openai"), ["ARCH_STUDIO_OPENAI_API_KEY"]);
        let store = MemorySecretStore::default();
        let both = FixedEnv(HashMap::from([
            ("HHTECH_API_KEY".to_string(), "vendor-name".to_string()),
            ("ARCH_STUDIO_HHTECH_API_KEY".to_string(), "app-name".to_string()),
        ]));
        assert_eq!(resolve_key(&store, &both, "hhtech").unwrap().value, "vendor-name");
        let fallback = FixedEnv::with("ARCH_STUDIO_HHTECH_API_KEY", "app-name");
        assert_eq!(resolve_key(&store, &fallback, "hhtech").unwrap().value, "app-name");
        let blank_first = FixedEnv(HashMap::from([
            ("HHTECH_API_KEY".to_string(), " ".to_string()),
            ("ARCH_STUDIO_HHTECH_API_KEY".to_string(), "app-name".to_string()),
        ]));
        assert_eq!(resolve_key(&store, &blank_first, "hhtech").unwrap().value, "app-name");
        store.set("hhtech", "from-keychain").unwrap();
        assert_eq!(resolve_key(&store, &both, "hhtech").unwrap().source, KeySource::Keychain);
    }

    #[test]
    fn keychain_wins_over_env_and_env_is_fallback() {
        // Injected environment: no global env mutation shared with parallel tests.
        let id = "gemini";
        let store = MemorySecretStore::default();
        let empty = FixedEnv::default();
        let env = FixedEnv::with(&env_var_name(id), " from-env ");
        assert!(resolve_key(&store, &empty, id).is_none());

        let k = resolve_key(&store, &env, id).unwrap();
        assert_eq!((k.value.as_str(), k.source), ("from-env", KeySource::Env));

        store.set(id, "from-keychain").unwrap();
        let k = resolve_key(&store, &env, id).unwrap();
        assert_eq!((k.value.as_str(), k.source), ("from-keychain", KeySource::Keychain));
        assert!(!format!("{k:?}").contains("from-keychain"));

        store.delete(id).unwrap();
        store.delete(id).unwrap(); // idempotent
        assert_eq!(resolve_key(&store, &env, id).unwrap().source, KeySource::Env);
        assert!(resolve_key(&store, &empty, id).is_none());
        assert!(resolve_key(&store, &FixedEnv::with(&env_var_name(id), "  "), id).is_none(), "blank is no key");
    }
}
