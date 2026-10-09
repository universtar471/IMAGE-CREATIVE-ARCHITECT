//! Provider list and API-key management (ADR-013). The UI can set, clear and test a key but
//! never read it back: descriptors only say whether a key exists and where it comes from.

use std::sync::Arc;

use serde_json::json;

use crate::dto::{ProviderDescriptorDto, ProviderTestResult};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::providers::ImageProvider;
use crate::secrets::{self, ResolvedKey};
use crate::services::AppCore;

pub fn find_provider(core: &AppCore, provider_id: &str) -> AppResult<Arc<dyn ImageProvider>> {
    core.providers.get(provider_id).ok_or_else(|| AppError::not_found("Provider", provider_id))
}

/// The key a provider would run with right now: `None` if it needs none, has none, or cannot
/// run at all (a [`ImageProvider::config_problem`] such as a missing base URL), so callers
/// that check for a key also refuse a provider that is not set up.
pub(crate) fn key_for(core: &AppCore, provider: &dyn ImageProvider) -> Option<ResolvedKey> {
    if provider.config_problem().is_some() {
        return None;
    }
    stored_key(core, provider)
}

/// The key wherever it is stored, regardless of the provider's other settings.
fn stored_key(core: &AppCore, provider: &dyn ImageProvider) -> Option<ResolvedKey> {
    let info = provider.info();
    if !info.requires_api_key {
        return None;
    }
    secrets::resolve_key(core.secrets.as_ref(), core.env.as_ref(), info.id)
}

/// `PROVIDER_NOT_CONFIGURED`, with an actionable message: the provider's own setup problem,
/// else where a key can go.
pub(crate) fn not_configured(provider: &dyn ImageProvider) -> AppError {
    let info = provider.info();
    let message = provider.config_problem().unwrap_or_else(|| {
        format!(
            "{} needs an API key. Add one in Provider settings (or set {} for development).",
            info.label,
            secrets::env_var_names(info.id).join(" or ")
        )
    });
    AppError::new(ErrorCode::ProviderNotConfigured, message).with_details(json!({ "providerId": info.id }))
}

fn descriptor(core: &AppCore, provider: &dyn ImageProvider) -> ProviderDescriptorDto {
    let info = provider.info();
    let key_source = stored_key(core, provider).map(|k| k.source);
    let set_up = provider.config_problem().is_none();
    ProviderDescriptorDto {
        id: info.id.to_string(),
        label: info.label.to_string(),
        kind: info.kind,
        requires_api_key: info.requires_api_key,
        configured: set_up && (!info.requires_api_key || key_source.is_some()),
        key_source,
        models: info.models,
    }
}

pub fn list(core: &AppCore) -> Vec<ProviderDescriptorDto> {
    core.providers.all().iter().map(|p| descriptor(core, p.as_ref())).collect()
}

pub fn set_api_key(core: &AppCore, provider_id: &str, api_key: &str) -> AppResult<ProviderDescriptorDto> {
    let provider = find_provider(core, provider_id)?;
    let info = provider.info();
    if !info.requires_api_key {
        return Err(AppError::validation(format!("{} does not use an API key.", info.label)));
    }
    let key = secrets::clean_key(api_key)?;
    core.secrets.set(info.id, &key)?;
    Ok(descriptor(core, provider.as_ref()))
}

/// Removes the keychain entry only; an environment-variable key keeps the provider configured.
pub fn clear_api_key(core: &AppCore, provider_id: &str) -> AppResult<ProviderDescriptorDto> {
    let provider = find_provider(core, provider_id)?;
    let info = provider.info();
    if info.requires_api_key {
        core.secrets.delete(info.id)?;
    }
    Ok(descriptor(core, provider.as_ref()))
}

/// Cheap connectivity/credential check. A failed check is `ok: false`, not an error.
pub fn test(core: &AppCore, provider_id: &str) -> AppResult<ProviderTestResult> {
    let provider = find_provider(core, provider_id)?;
    let key = key_for(core, provider.as_ref());
    if provider.config_problem().is_some() || (provider.info().requires_api_key && key.is_none()) {
        return Ok(ProviderTestResult { ok: false, message: not_configured(provider.as_ref()).message });
    }
    Ok(match provider.test_connection(key.as_ref().map(|k| k.value.as_str())) {
        Ok(message) => ProviderTestResult { ok: true, message },
        Err(e) => ProviderTestResult { ok: false, message: e.message },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::local_preview;
    use crate::secrets::KeySource;
    use crate::services::tests_support::{core, GOOD_KEY, TEST_PROVIDER};

    fn find<'a>(list: &'a [ProviderDescriptorDto], id: &str) -> &'a ProviderDescriptorDto {
        list.iter().find(|p| p.id == id).unwrap()
    }

    #[test]
    fn list_reports_configuration_without_keys() {
        let (_tmp, core) = core();
        let providers = list(&core);
        let local = find(&providers, local_preview::ID);
        assert!(local.configured && !local.requires_api_key && local.key_source.is_none());
        let remote = find(&providers, TEST_PROVIDER);
        assert!(!remote.configured && remote.requires_api_key && remote.key_source.is_none());
    }

    #[test]
    fn set_test_and_clear_key() {
        let (_tmp, core) = core();
        assert!(!test(&core, TEST_PROVIDER).unwrap().ok);

        let d = set_api_key(&core, TEST_PROVIDER, "  wrong-key ").unwrap();
        assert!(d.configured);
        assert_eq!(d.key_source, Some(KeySource::Keychain));
        assert_eq!(core.secrets.get(TEST_PROVIDER).unwrap().as_deref(), Some("wrong-key"), "stored trimmed");
        let json = serde_json::to_string(&d).unwrap();
        assert!(!json.contains("wrong-key"), "descriptor must never carry the key");
        let bad = test(&core, TEST_PROVIDER).unwrap();
        assert!(!bad.ok);
        assert!(!bad.message.contains("wrong-key"));

        set_api_key(&core, TEST_PROVIDER, GOOD_KEY).unwrap();
        assert!(test(&core, TEST_PROVIDER).unwrap().ok);

        let d = clear_api_key(&core, TEST_PROVIDER).unwrap();
        assert!(!d.configured && d.key_source.is_none());
        assert!(core.secrets.get(TEST_PROVIDER).unwrap().is_none());
    }

    #[test]
    fn env_fallback_comes_from_the_injected_environment_only() {
        let (_tmp, mut core) = core();
        assert!(!find(&list(&core), TEST_PROVIDER).configured, "test cores ignore the process environment");
        core.env = Arc::new(crate::secrets::FixedEnv::with(&crate::secrets::env_var_name(TEST_PROVIDER), "env-key"));
        let d = list(&core);
        let remote = find(&d, TEST_PROVIDER);
        assert!(remote.configured);
        assert_eq!(remote.key_source, Some(KeySource::Env));
        assert!(!serde_json::to_string(&d).unwrap().contains("env-key"));
        // Clearing the keychain entry keeps an env key.
        assert_eq!(clear_api_key(&core, TEST_PROVIDER).unwrap().key_source, Some(KeySource::Env));
    }

    #[test]
    fn builtin_openai_is_listed_and_takes_its_env_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let registry = crate::providers::ProviderRegistry::builtin();
        let mut core =
            AppCore::open_with(tmp.path(), registry, Arc::new(crate::secrets::MemorySecretStore::default())).unwrap();
        let ids: Vec<String> = list(&core).into_iter().map(|p| p.id).collect();
        assert_eq!(ids, ["gemini", "openai", "hhtech", "local_preview", "local_upscale"]);
        assert!(!find(&list(&core), "openai").configured);

        assert_eq!(crate::secrets::env_var_name("openai"), "ARCH_STUDIO_OPENAI_API_KEY");
        core.env = Arc::new(crate::secrets::FixedEnv::with("ARCH_STUDIO_OPENAI_API_KEY", "sk-env-key"));
        let d = list(&core);
        let openai = find(&d, "openai");
        assert_eq!((openai.configured, openai.key_source), (true, Some(KeySource::Env)));
        assert_eq!(openai.label, "OpenAI (GPT Image)");
        assert!(!find(&d, "gemini").configured, "one provider's env key does not configure another");
        assert!(!serde_json::to_string(&d).unwrap().contains("sk-env-key"));
    }

    #[test]
    fn hhtech_without_base_url_is_not_configured_even_with_a_key() {
        let tmp = tempfile::tempdir().unwrap();
        let no_url = crate::secrets::FixedEnv::default();
        let registry = crate::providers::ProviderRegistry::builtin_with_env(&no_url);
        let mut core =
            AppCore::open_with(tmp.path(), registry, Arc::new(crate::secrets::MemorySecretStore::default())).unwrap();
        core.env = Arc::new(crate::secrets::FixedEnv::with("HHTECH_API_KEY", "hh-env-key"));
        let d = list(&core);
        let hh = find(&d, "hhtech");
        assert_eq!(hh.label, "HHTECH (OpenAI-compatible)");
        assert_eq!((hh.configured, hh.key_source), (false, Some(KeySource::Env)), "key found, base URL missing");
        let t = test(&core, "hhtech").unwrap();
        assert!(!t.ok && t.message.contains("HHTECH_BASE_URL"), "{}", t.message);
        let hh_provider = find_provider(&core, "hhtech").unwrap();
        assert!(key_for(&core, hh_provider.as_ref()).is_none());
        let err = not_configured(hh_provider.as_ref());
        assert_eq!(err.code, ErrorCode::ProviderNotConfigured);
        assert!(err.message.contains("HHTECH_BASE_URL"));
        assert!(!serde_json::to_string(&d).unwrap().contains("hh-env-key"));

        let with_url = crate::secrets::FixedEnv::with("HHTECH_BASE_URL", "http://127.0.0.1:9/v1/");
        let registry = crate::providers::ProviderRegistry::builtin_with_env(&with_url);
        let tmp2 = tempfile::tempdir().unwrap();
        let mut core =
            AppCore::open_with(tmp2.path(), registry, Arc::new(crate::secrets::MemorySecretStore::default())).unwrap();
        assert!(!find(&list(&core), "hhtech").configured, "no key yet");
        assert!(not_configured(find_provider(&core, "hhtech").unwrap().as_ref()).message.contains("HHTECH_API_KEY"));
        core.env = Arc::new(crate::secrets::FixedEnv::with("ARCH_STUDIO_HHTECH_API_KEY", "hh-env-key"));
        assert!(find(&list(&core), "hhtech").configured);
    }

    #[test]
    fn rejects_bad_keys_and_unknown_providers() {
        let (_tmp, core) = core();
        assert_eq!(set_api_key(&core, TEST_PROVIDER, "a b").unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(set_api_key(&core, TEST_PROVIDER, " ").unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(set_api_key(&core, local_preview::ID, "k").unwrap_err().code, ErrorCode::ValidationError);
        assert_eq!(set_api_key(&core, "nope", "k").unwrap_err().code, ErrorCode::NotFound);
        assert_eq!(test(&core, "nope").unwrap_err().code, ErrorCode::NotFound);
        assert!(core.secrets.get(TEST_PROVIDER).unwrap().is_none());
        assert!(test(&core, local_preview::ID).unwrap().ok);
    }

    #[test]
    fn descriptor_json_keys_match_zod_schema() {
        let (_tmp, core) = core();
        let value = serde_json::to_value(find(&list(&core), local_preview::ID)).unwrap();
        let mut keys: Vec<&str> = value.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["configured", "id", "keySource", "kind", "label", "models", "requiresApiKey"]);
        assert_eq!(value["kind"], json!("local"));
        let mut model_keys: Vec<&str> = value["models"][0].as_object().unwrap().keys().map(String::as_str).collect();
        model_keys.sort_unstable();
        assert_eq!(
            model_keys,
            [
                "aspectRatios",
                "id",
                "imageSizes",
                "imageToImage",
                "label",
                "maxOutputs",
                "maxReferenceImages",
                "priceHint",
                "qualityOptions",
                "supportsNegativePrompt",
                "supportsSeed",
                "textToImage"
            ]
        );
    }
}
