//! HHTECH: a third-party OpenAI-compatible gateway serving image and chat models under one
//! base URL. It reuses the OpenAI adapter in [`Flavor::Gateway`] mode; this module only turns
//! environment variables into an adapter [`Config`].
//!
//! The gateway's docs cannot be checked from here. Facts from the lead's real calls
//! (2026-10-09, base `https://hhtechapi.com/v1`):
//! - `GET /models` → 200, OpenAI list shape `{ data: [{ id, object, owned_by, … }] }`. The
//!   gateway also encodes resolution and edit variants in model ids (`gpt-image-2-2k`,
//!   `gpt-image-2-edit-1k`, …). The app lists base ids only: the built-in [`catalog`] (tiers,
//!   prices, which ids take a tier suffix) or what `HHTECH_IMAGE_MODEL` names.
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
//! | `HHTECH_IMAGE_MODEL` | — (the full [`catalog`]) | comma-separated base ids that restrict and order the picker; ids outside the catalog become plain entries without tiers |
//! | `HHTECH_IMAGE_SIZE` | `1024x1024` | size sent when no tier is chosen, without an aspect ratio (and for its ratio); `auto` omits it |
//! | `HHTECH_IMAGE_QUALITY` | `medium` | `quality` sent to GPT models when the request leaves it null (never sent to Gemini) |
//! | `HHTECH_CHAT_MODEL` | `claude-sonnet-5` | prompt enhancement |
//! | `HHTECH_TIMEOUT_SECS` | `600` | per images call (30–3600); several outputs run as parallel calls |

pub mod catalog;
#[cfg(test)]
mod tests;

use super::gateway_env::{self, GatewaySpec};
use super::openai::{OpenAiProvider, Route};
use super::ModelCapabilities;
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
pub const ENV_ASSIST_MODEL: &str = "HHTECH_ASSIST_MODEL";
pub const ENV_TIMEOUT_SECS: &str = "HHTECH_TIMEOUT_SECS";

pub const DEFAULT_IMAGE_SIZE: &str = gateway_env::DEFAULT_IMAGE_SIZE;
pub const DEFAULT_QUALITY: &str = gateway_env::DEFAULT_QUALITY;
pub const DEFAULT_TIMEOUT_SECS: u64 = gateway_env::DEFAULT_TIMEOUT_SECS;
pub const DEFAULT_CHAT_MODEL: &str = "claude-sonnet-5";
pub const DEFAULT_ASSIST_MODEL: &str = "gemini-3.8-flash";

const SETUP_HINT: &str = "Check HHTECH_BASE_URL (usually ends in /v1) and the model names in HHTECH_IMAGE_MODEL / \
                          HHTECH_CHAT_MODEL / HHTECH_ASSIST_MODEL.";

/// The full [`catalog`] in its default order (used when `HHTECH_IMAGE_MODEL` is unset).
fn catalog_models() -> Vec<(ModelCapabilities, Route)> {
    catalog::CATALOG.iter().map(|e| (e.capabilities(), e.route())).collect()
}

/// A catalog entry with its tiers and prices, or a plain entry for an id outside it.
fn model(id: &str) -> (ModelCapabilities, Route) {
    match catalog::find(id) {
        Some(entry) => (entry.capabilities(), entry.route()),
        None => (catalog::plain_capabilities(id), Route::default()),
    }
}

pub const SPEC: GatewaySpec = GatewaySpec {
    id: ID,
    label: LABEL,
    vendor: VENDOR,
    env_base_url: ENV_BASE_URL,
    env_image_model: ENV_IMAGE_MODEL,
    env_image_size: ENV_IMAGE_SIZE,
    env_image_quality: ENV_IMAGE_QUALITY,
    env_chat_model: ENV_CHAT_MODEL,
    env_timeout_secs: ENV_TIMEOUT_SECS,
    base_url_example: "https://hhtechapi.com/v1",
    default_models: catalog_models,
    model,
    default_chat_model: Some(DEFAULT_CHAT_MODEL),
    setup_hint: SETUP_HINT,
};

pub fn provider(env: &dyn EnvSource) -> OpenAiProvider {
    OpenAiProvider::from_config(config(env))
}

/// Build the adapter config (see [`gateway_env::config_from_env`]). The `HHTECH_ASSIST_MODEL`
/// setting is checked here too, so a typo there also shows as "not configured".
pub fn config(env: &dyn EnvSource) -> super::openai::Config {
    let mut config = gateway_env::config_from_env(&SPEC, env);
    if let (Ok(_), Err(problem)) = (&config.base_url, assist_model(env)) {
        config.base_url = Err(format!("{problem} Fix it in the environment or .env, then restart the app."));
    }
    config
}

/// Resolve the AI DNA assistance model without changing prompt enhancement.
pub fn assist_model(env: &dyn EnvSource) -> Result<String, String> {
    let value = env.var(ENV_ASSIST_MODEL).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    match value {
        None => Ok(DEFAULT_ASSIST_MODEL.to_string()),
        Some(id) if gateway_env::valid_id(&id) => Ok(id),
        Some(_) => Err(format!("{ENV_ASSIST_MODEL} is not a valid model id.")),
    }
}
