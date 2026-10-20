//! Environment configuration shared by the OpenAI-compatible gateways (HHTECH and the custom
//! gateway, ADR-040). Each gateway names its variables and model list in a [`GatewaySpec`];
//! this module turns them into an OpenAI adapter [`Config`] in [`Flavor::Gateway`] mode.
//!
//! Invalid settings never panic: the first problem becomes the provider's "not configured"
//! reason, so a typo can never bill a model the user did not ask for.

use std::collections::HashMap;

use super::openai::{Config, Flavor, Route};
use super::ModelCapabilities;
use crate::secrets::EnvSource;

pub struct GatewaySpec {
    pub id: &'static str,
    pub label: &'static str,
    /// Name in user messages ("HHTECH").
    pub vendor: &'static str,
    pub env_base_url: &'static str,
    pub env_image_model: &'static str,
    pub env_image_size: &'static str,
    pub env_image_quality: &'static str,
    pub env_chat_model: &'static str,
    pub env_timeout_secs: &'static str,
    /// Shown in base URL errors, e.g. `https://hhtechapi.com/v1`.
    pub base_url_example: &'static str,
    /// Models offered when the model variable is unset; empty = the variable is required.
    pub default_models: fn() -> Vec<(ModelCapabilities, Route)>,
    /// Capabilities and route of one id named in the model variable.
    pub model: fn(&str) -> (ModelCapabilities, Route),
    /// Chat model for prompt enhancement when the chat variable is unset; `None` = not offered.
    pub default_chat_model: Option<&'static str>,
    pub setup_hint: &'static str,
}

pub const DEFAULT_IMAGE_SIZE: &str = "1024x1024";
pub const DEFAULT_QUALITY: &str = "medium";
/// A live 1024x1024 medium image took about 100 s through a gateway (2026-10-09); allow for
/// a busy gateway and larger sizes.
pub const DEFAULT_TIMEOUT_SECS: u64 = 600;

pub fn config_from_env(spec: &GatewaySpec, env: &dyn EnvSource) -> Config {
    let var = |name: &str| env.var(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let mut problems = Vec::new();

    let base_url = match var(spec.env_base_url) {
        None => Err(format!(
            "{} needs a base URL: set {} (e.g. {}) in the environment or in .env, then restart the app.",
            spec.vendor, spec.env_base_url, spec.base_url_example
        )),
        Some(url) => parse_base_url(spec, &url),
    };

    let ids: Vec<String> = match var(spec.env_image_model) {
        None => Vec::new(),
        Some(list) => {
            let mut ids: Vec<String> = Vec::new();
            for id in list.split(',').map(str::trim).filter(|id| !id.is_empty()) {
                if !valid_id(id) {
                    problems.push(format!("{} contains an invalid model id.", spec.env_image_model));
                } else if !ids.iter().any(|known| known == id) {
                    ids.push(id.to_string());
                }
            }
            ids
        }
    };
    // Unset (or nothing valid in it): the gateway's default list, if it has one.
    let models: Vec<(ModelCapabilities, Route)> =
        if ids.is_empty() { (spec.default_models)() } else { ids.iter().map(|id| (spec.model)(id)).collect() };
    if models.is_empty() {
        problems.push(format!(
            "{} needs at least one image model: set {} to a comma-separated list of model ids.",
            spec.vendor, spec.env_image_model
        ));
    }

    let default_size = match var(spec.env_image_size).as_deref() {
        None => Some(DEFAULT_IMAGE_SIZE.to_string()),
        Some(size) if size.eq_ignore_ascii_case("auto") => None,
        Some(size) if valid_size(size) => Some(size.to_ascii_lowercase()),
        Some(_) => {
            problems.push(format!("{} must look like 1024x1024 (or auto).", spec.env_image_size));
            Some(DEFAULT_IMAGE_SIZE.to_string())
        }
    };

    let quality = match var(spec.env_image_quality) {
        None => DEFAULT_QUALITY.to_string(),
        Some(q) if q.len() <= 16 && q.chars().all(|c| c.is_ascii_alphanumeric()) => q.to_ascii_lowercase(),
        Some(_) => {
            problems.push(format!("{} must be a single word such as low, medium or high.", spec.env_image_quality));
            DEFAULT_QUALITY.to_string()
        }
    };

    let chat_model = match var(spec.env_chat_model) {
        None => spec.default_chat_model.map(String::from),
        Some(id) if valid_id(&id) => Some(id),
        Some(_) => {
            problems.push(format!("{} is not a valid model id.", spec.env_chat_model));
            spec.default_chat_model.map(String::from)
        }
    };

    let timeout_secs = match var(spec.env_timeout_secs) {
        None => DEFAULT_TIMEOUT_SECS,
        Some(v) => match v.parse::<u64>() {
            Ok(secs) if (30..=3600).contains(&secs) => secs,
            _ => {
                problems.push(format!("{} must be a number of seconds from 30 to 3600.", spec.env_timeout_secs));
                DEFAULT_TIMEOUT_SECS
            }
        },
    };

    let base_url = match (base_url, problems.into_iter().next()) {
        (Ok(_), Some(problem)) => Err(format!("{problem} Fix it in the environment or .env, then restart the app.")),
        (base_url, _) => base_url,
    };

    Config {
        id: spec.id,
        label: spec.label,
        vendor: spec.vendor,
        base_url,
        flavor: Flavor::Gateway,
        routes: models.iter().map(|(m, route)| (m.id.clone(), *route)).collect::<HashMap<_, _>>(),
        models: models.into_iter().map(|(m, _)| m).collect(),
        default_size,
        quality,
        chat_model,
        setup_hint: spec.setup_hint,
        generate_timeout: std::time::Duration::from_secs(timeout_secs),
    }
}

/// Trimmed, without a trailing `/`; https, or http only to a loopback host (tests).
fn parse_base_url(spec: &GatewaySpec, raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let invalid = || format!("{} is not a valid https URL (e.g. {}).", spec.env_base_url, spec.base_url_example);
    let url = reqwest::Url::parse(trimmed).map_err(|_| invalid())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    match url.scheme() {
        "https" if url.host_str().is_some() => {}
        "http" if loopback => {}
        "http" => {
            return Err(format!("{} must use https (plain http is only allowed for localhost).", spec.env_base_url))
        }
        _ => return Err(invalid()),
    }
    if url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err(invalid());
    }
    Ok(trimmed.to_string())
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c))
}

/// `WIDTHxHEIGHT`, each edge 256..=4096.
fn valid_size(size: &str) -> bool {
    let Some((w, h)) = size.to_ascii_lowercase().split_once('x').map(|(w, h)| (w.to_string(), h.to_string())) else {
        return false;
    };
    [w, h].iter().all(|edge| edge.parse::<u32>().is_ok_and(|n| (256..=4096).contains(&n)))
}
