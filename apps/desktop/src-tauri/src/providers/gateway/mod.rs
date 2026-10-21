//! Custom gateway (M2, ADR-040): any OpenAI-compatible gateway (BEAR, a self-hosted proxy, …)
//! that serves `/images/generations`, `/images/edits` and optionally `/chat/completions` under
//! one base URL. Configured only from the environment or `.env`, like HHTECH; the key may also
//! live in the OS credential store under provider id `gateway`.
//!
//! | Variable | Default | Meaning |
//! |---|---|---|
//! | `GATEWAY_API_KEY` (or `ARCH_STUDIO_GATEWAY_API_KEY`) | — | Bearer key |
//! | `GATEWAY_BASE_URL` | — (required) | e.g. `https://api.example.com/v1` |
//! | `GATEWAY_IMAGE_MODEL` | — (required) | comma-separated image model ids, offered in that order (no tiers, no prices) |
//! | `GATEWAY_IMAGE_SIZE` | `1024x1024` | size sent without an aspect ratio; `auto` omits it |
//! | `GATEWAY_IMAGE_QUALITY` | `medium` | `quality` sent when the request leaves it null |
//! | `GATEWAY_CHAT_MODEL` | — | chat model for "Enhance prompt"; unset = not offered |
//! | `GATEWAY_TIMEOUT_SECS` | `600` | per images call (30–3600) |

#[cfg(test)]
mod tests;

use super::gateway_env::{self, GatewaySpec};
use super::hhtech::catalog::plain_capabilities;
use super::openai::{Config, OpenAiProvider, Route};
use super::ModelCapabilities;
use crate::secrets::EnvSource;

pub const ID: &str = "gateway";
pub const LABEL: &str = "Custom gateway (OpenAI-compatible)";
pub const VENDOR: &str = "The custom gateway";

pub const ENV_API_KEY: &str = "GATEWAY_API_KEY";
pub const ENV_BASE_URL: &str = "GATEWAY_BASE_URL";
pub const ENV_IMAGE_MODEL: &str = "GATEWAY_IMAGE_MODEL";
pub const ENV_IMAGE_SIZE: &str = "GATEWAY_IMAGE_SIZE";
pub const ENV_IMAGE_QUALITY: &str = "GATEWAY_IMAGE_QUALITY";
pub const ENV_CHAT_MODEL: &str = "GATEWAY_CHAT_MODEL";
pub const ENV_TIMEOUT_SECS: &str = "GATEWAY_TIMEOUT_SECS";

const SETUP_HINT: &str =
    "Check GATEWAY_BASE_URL (usually ends in /v1) and the model names in GATEWAY_IMAGE_MODEL / GATEWAY_CHAT_MODEL.";

/// No built-in list: the gateway's models are unknown until the user names them.
fn no_default_models() -> Vec<(ModelCapabilities, Route)> {
    Vec::new()
}

fn model(id: &str) -> (ModelCapabilities, Route) {
    (plain_capabilities(id), Route::default())
}

pub const SPEC: GatewaySpec = GatewaySpec {
    id: ID,
    label: LABEL,
    vendor: VENDOR,
    env_base_url: ENV_BASE_URL,
    default_base_url: None,
    env_image_model: ENV_IMAGE_MODEL,
    env_image_size: ENV_IMAGE_SIZE,
    env_image_quality: ENV_IMAGE_QUALITY,
    env_chat_model: ENV_CHAT_MODEL,
    env_timeout_secs: ENV_TIMEOUT_SECS,
    base_url_example: "https://api.example.com/v1",
    default_models: no_default_models,
    model,
    default_chat_model: None,
    setup_hint: SETUP_HINT,
};

pub fn provider(env: &dyn EnvSource) -> OpenAiProvider {
    OpenAiProvider::from_config(config(env))
}

pub fn config(env: &dyn EnvSource) -> Config {
    gateway_env::config_from_env(&SPEC, env)
}
