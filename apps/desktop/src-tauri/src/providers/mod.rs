//! Image provider boundary (Phase 2, ADR-012/013).
//!
//! Adapters translate the provider-neutral [`ProviderRequest`] into a vendor call and back.
//! Nothing outside `providers/` may know a vendor request shape, and adapters never touch
//! SQLite, managed storage or the keychain: the generation service hands them reference
//! bytes plus the API key, and persists whatever they return.
//!
//! Adapters are blocking (they run inside `spawn_blocking`) and must enforce their own
//! network timeout.

pub mod gemini;
pub mod local_preview;
pub mod text;

#[cfg(test)]
mod test_http;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    Local,
    Remote,
}

/// Mirrors `ModelCapabilitiesSchema` in `packages/domain/src/schemas/generation.ts`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub id: String,
    pub label: String,
    pub text_to_image: bool,
    pub image_to_image: bool,
    pub max_reference_images: u32,
    pub max_outputs: u32,
    pub aspect_ratios: Vec<String>,
    pub image_sizes: Vec<String>,
    pub supports_negative_prompt: bool,
    pub supports_seed: bool,
}

/// Static description of a provider; the service adds `configured` / `keySource`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderInfo {
    pub id: &'static str,
    pub label: &'static str,
    pub kind: ProviderKind,
    pub requires_api_key: bool,
    pub models: Vec<ModelCapabilities>,
}

impl ProviderInfo {
    pub fn model(&self, model_id: &str) -> Option<&ModelCapabilities> {
        self.models.iter().find(|m| m.id == model_id)
    }
}

/// Mirrors `GenerationParamsSchema`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GenerationParams {
    pub aspect_ratio: Option<String>,
    pub image_size: Option<String>,
    pub output_count: u32,
    pub seed: Option<u64>,
}

/// The text parts of a compiled `PromptBundle`, as adapters consume them.
#[derive(Debug, Clone, PartialEq)]
pub struct PromptText {
    pub positive: String,
    pub negative: String,
    pub reference_instructions: String,
    pub preservation_instructions: String,
}

/// One reference image, in request order, already read from managed storage.
#[derive(Debug, Clone, PartialEq)]
pub struct ReferenceImage {
    pub asset_id: String,
    /// Asset role string, e.g. `master_architecture`.
    pub role: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ProviderRequest {
    pub model_id: String,
    pub prompt: PromptText,
    pub references: Vec<ReferenceImage>,
    pub params: GenerationParams,
    /// `None` for providers that need no key. Never logged, never persisted.
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderImage {
    pub mime_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ProviderOutput {
    pub images: Vec<ProviderImage>,
    /// Small, non-secret vendor metadata (model version, finish reason, text notes).
    pub meta: Value,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderErrorKind {
    Auth,
    RateLimited,
    /// Safety filter / policy refusal.
    Blocked,
    InvalidRequest,
    Network,
    Timeout,
    BadResponse,
}

impl ProviderErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::RateLimited => "rate_limited",
            Self::Blocked => "blocked",
            Self::InvalidRequest => "invalid_request",
            Self::Network => "network",
            Self::Timeout => "timeout",
            Self::BadResponse => "bad_response",
        }
    }

    pub fn retryable(self) -> bool {
        matches!(self, Self::RateLimited | Self::Network | Self::Timeout)
    }
}

/// User-facing message: actionable, no key material, no raw response dumps.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
#[error("{kind:?}: {message}")]
pub struct ProviderError {
    pub kind: ProviderErrorKind,
    pub message: String,
}

impl ProviderError {
    pub fn new(kind: ProviderErrorKind, message: impl Into<String>) -> Self {
        Self { kind, message: message.into() }
    }
}

pub trait ImageProvider: Send + Sync {
    fn info(&self) -> ProviderInfo;

    /// Run one generation. Must return at least one image or an error.
    fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError>;

    /// Cheap credential/connectivity check (no image generation). Returns a short status line.
    fn test_connection(&self, api_key: Option<&str>) -> Result<String, ProviderError>;
}

/// All providers compiled into this build, in UI order.
pub struct ProviderRegistry {
    providers: Vec<Arc<dyn ImageProvider>>,
}

impl ProviderRegistry {
    pub fn new(providers: Vec<Arc<dyn ImageProvider>>) -> Self {
        Self { providers }
    }

    pub fn builtin() -> Self {
        Self::new(vec![Arc::new(gemini::GeminiProvider::new()), Arc::new(local_preview::LocalPreviewProvider)])
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn ImageProvider>> {
        self.providers.iter().find(|p| p.info().id == id).cloned()
    }

    pub fn all(&self) -> &[Arc<dyn ImageProvider>] {
        &self.providers
    }
}
