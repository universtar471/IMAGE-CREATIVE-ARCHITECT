//! HHTECH: a third-party OpenAI-compatible gateway serving image and chat models under one
//! base URL. It reuses the OpenAI adapter in [`Flavor::Gateway`] mode; this module only turns
//! environment variables into an adapter [`Config`].
//!
//! The gateway's docs cannot be checked from here. Facts from the lead's real calls
//! (2026-10-09, base `https://hhtechapi.com/v1`):
//! - `GET /models` → 200, OpenAI list shape `{ data: [{ id, object, owned_by, … }] }`. The
//!   gateway also encodes resolution and edit variants in model ids (`gpt-image-2-2k`,
//!   `gpt-image-2-edit-1k`, …); plain base ids work on both image endpoints, so the app lists
//!   only what `HHTECH_IMAGE_MODEL` names.
//! - `POST /chat/completions` (`claude-sonnet-5`) → standard `choices[0].message.content`.
//! - `POST /images/generations` `{model, prompt, size, quality, n, response_format: "b64_json"}`
//!   → `{ created, data: [{ b64_json }] }` after ~100 s (PNG ~3 MB).
//! - `POST /images/edits` multipart with one `image` file part → `data[0].b64_json` (+
//!   `revised_prompt`) after ~36 s. The field name for several references is unverified; the
//!   adapter sends `image[]` (OpenAI convention) for more than one.
//!
//! Configuration (environment or `.env`, never source/SQLite/DTOs; the key may also live in the
//! OS credential store under provider id `hhtech`):
//!
//! | Variable | Default | Meaning |
//! |---|---|---|
//! | `HHTECH_API_KEY` (or `ARCH_STUDIO_HHTECH_API_KEY`) | — | Bearer key |
//! | `HHTECH_BASE_URL` | — (required) | e.g. `https://hhtechapi.com/v1` |
//! | `HHTECH_IMAGE_MODEL` | `gpt-image-2` | comma-separated model ids for the picker |
//! | `HHTECH_IMAGE_SIZE` | `1024x1024` | size sent without an aspect ratio (and for its ratio); `auto` omits it |
//! | `HHTECH_IMAGE_QUALITY` | `medium` | `quality` field |
//! | `HHTECH_CHAT_MODEL` | `claude-sonnet-5` | prompt enhancement |
//! | `HHTECH_TIMEOUT_SECS` | `600` | per images call (30–3600); several outputs run as parallel calls |

#[cfg(test)]
mod tests;

use super::openai::{gateway_model, Config, Flavor, OpenAiProvider};
use crate::secrets::EnvSource;

pub const ID: &str = "hhtech";
pub const LABEL: &str = "HHTECH (OpenAI-compatible)";
pub const VENDOR: &str = "HHTECH";

pub const ENV_API_KEY: &str = "HHTECH_API_KEY";
pub const ENV_BASE_URL: &str = "HHTECH_BASE_URL";
pub const ENV_IMAGE_MODEL: &str = "HHTECH_IMAGE_MODEL";
pub const ENV_IMAGE_SIZE: &str = "HHTECH_IMAGE_SIZE";
pub const ENV_IMAGE_QUALITY: &str = "HHTECH_IMAGE_QUALITY";
pub const ENV_CHAT_MODEL: &str = "HHTECH_CHAT_MODEL";
pub const ENV_TIMEOUT_SECS: &str = "HHTECH_TIMEOUT_SECS";

pub const DEFAULT_IMAGE_MODEL: &str = "gpt-image-2";
pub const DEFAULT_IMAGE_SIZE: &str = "1024x1024";
pub const DEFAULT_QUALITY: &str = "medium";
/// A live 1024x1024 medium image took about 100 s through the gateway (2026-10-09); allow for
/// a busy gateway and larger sizes.
pub const DEFAULT_TIMEOUT_SECS: u64 = 600;
pub const DEFAULT_CHAT_MODEL: &str = "claude-sonnet-5";

const SETUP_HINT: &str = "Check HHTECH_BASE_URL (usually ends in /v1) and the model names in HHTECH_IMAGE_MODEL / \
                          HHTECH_CHAT_MODEL.";

pub fn provider(env: &dyn EnvSource) -> OpenAiProvider {
    OpenAiProvider::from_config(config(env))
}

/// Build the adapter config. Invalid settings never panic: the first problem becomes the
/// provider's "not configured" reason, and the model list falls back to the default so the
/// provider can still be listed.
pub fn config(env: &dyn EnvSource) -> Config {
    let var = |name: &str| env.var(name).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    let mut problems = Vec::new();

    let base_url = match var(ENV_BASE_URL) {
        None => Err(format!(
            "HHTECH needs a base URL: set {ENV_BASE_URL} (e.g. https://hhtechapi.com/v1) in the environment or in .env, \
             then restart the app."
        )),
        Some(url) => parse_base_url(&url),
    };

    let models: Vec<String> = match var(ENV_IMAGE_MODEL) {
        None => vec![DEFAULT_IMAGE_MODEL.to_string()],
        Some(list) => {
            let mut ids: Vec<String> = Vec::new();
            for id in list.split(',').map(str::trim).filter(|id| !id.is_empty()) {
                if !valid_id(id) {
                    problems.push(format!("{ENV_IMAGE_MODEL} contains an invalid model id."));
                } else if !ids.iter().any(|known| known == id) {
                    ids.push(id.to_string());
                }
            }
            if ids.is_empty() {
                vec![DEFAULT_IMAGE_MODEL.to_string()]
            } else {
                ids
            }
        }
    };

    let default_size = match var(ENV_IMAGE_SIZE).as_deref() {
        None => Some(DEFAULT_IMAGE_SIZE.to_string()),
        Some(size) if size.eq_ignore_ascii_case("auto") => None,
        Some(size) if valid_size(size) => Some(size.to_ascii_lowercase()),
        Some(_) => {
            problems.push(format!("{ENV_IMAGE_SIZE} must look like 1024x1024 (or auto)."));
            Some(DEFAULT_IMAGE_SIZE.to_string())
        }
    };

    let quality = match var(ENV_IMAGE_QUALITY) {
        None => DEFAULT_QUALITY.to_string(),
        Some(q) if q.len() <= 16 && q.chars().all(|c| c.is_ascii_alphanumeric()) => q.to_ascii_lowercase(),
        Some(_) => {
            problems.push(format!("{ENV_IMAGE_QUALITY} must be a single word such as low, medium or high."));
            DEFAULT_QUALITY.to_string()
        }
    };

    let chat_model = match var(ENV_CHAT_MODEL) {
        None => DEFAULT_CHAT_MODEL.to_string(),
        Some(id) if valid_id(&id) => id,
        Some(_) => {
            problems.push(format!("{ENV_CHAT_MODEL} is not a valid model id."));
            DEFAULT_CHAT_MODEL.to_string()
        }
    };

    let timeout_secs = match var(ENV_TIMEOUT_SECS) {
        None => DEFAULT_TIMEOUT_SECS,
        Some(v) => match v.parse::<u64>() {
            Ok(secs) if (30..=3600).contains(&secs) => secs,
            _ => {
                problems.push(format!("{ENV_TIMEOUT_SECS} must be a number of seconds from 30 to 3600."));
                DEFAULT_TIMEOUT_SECS
            }
        },
    };

    // A bad optional setting blocks the provider too: silently using a default the user did
    // not ask for would bill the wrong model.
    let base_url = match (base_url, problems.into_iter().next()) {
        (Ok(_), Some(problem)) => Err(format!("{problem} Fix it in the environment or .env, then restart the app.")),
        (base_url, _) => base_url,
    };

    Config {
        id: ID,
        label: LABEL,
        vendor: VENDOR,
        base_url,
        flavor: Flavor::Gateway,
        models: models.iter().map(|id| gateway_model(id)).collect(),
        default_size,
        quality,
        chat_model: Some(chat_model),
        setup_hint: SETUP_HINT,
        generate_timeout: std::time::Duration::from_secs(timeout_secs),
    }
}

/// Trimmed, without a trailing `/`; https, or http only to a loopback host (tests).
fn parse_base_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let invalid = || format!("{ENV_BASE_URL} is not a valid https URL (e.g. https://hhtechapi.com/v1).");
    let url = reqwest::Url::parse(trimmed).map_err(|_| invalid())?;
    let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    match url.scheme() {
        "https" if url.host_str().is_some() => {}
        "http" if loopback => {}
        "http" => return Err(format!("{ENV_BASE_URL} must use https (plain http is only allowed for localhost).")),
        _ => return Err(invalid()),
    }
    if url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err(invalid());
    }
    Ok(trimmed.to_string())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c))
}

/// `WIDTHxHEIGHT`, each edge 256..=4096.
fn valid_size(size: &str) -> bool {
    let Some((w, h)) = size.to_ascii_lowercase().split_once('x').map(|(w, h)| (w.to_string(), h.to_string())) else {
        return false;
    };
    [w, h].iter().all(|edge| edge.parse::<u32>().is_ok_and(|n| (256..=4096).contains(&n)))
}
