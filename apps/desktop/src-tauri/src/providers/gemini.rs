//! Google Gemini image adapter (first remote provider, ADR-012). Owned by task P2-B.

use super::{
    ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderInfo, ProviderKind, ProviderOutput,
    ProviderRequest,
};

pub const ID: &str = "gemini";
pub const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

pub struct GeminiProvider {
    base_url: String,
}

impl GeminiProvider {
    pub fn new() -> Self {
        Self::with_base_url(DEFAULT_BASE_URL)
    }

    /// Tests point this at a local mock server.
    pub fn with_base_url(base_url: impl Into<String>) -> Self {
        Self { base_url: base_url.into() }
    }
}

impl Default for GeminiProvider {
    fn default() -> Self {
        Self::new()
    }
}

impl ImageProvider for GeminiProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ID,
            label: "Google Gemini",
            kind: ProviderKind::Remote,
            requires_api_key: true,
            models: vec![ModelCapabilities {
                id: "gemini-2.5-flash-image".into(),
                label: "Gemini 2.5 Flash Image".into(),
                text_to_image: true,
                image_to_image: true,
                max_reference_images: 3,
                max_outputs: 1,
                aspect_ratios: vec![],
                image_sizes: vec![],
                supports_negative_prompt: false,
                supports_seed: false,
            }],
        }
    }

    fn generate(&self, _request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        let _ = &self.base_url;
        Err(ProviderError::new(ProviderErrorKind::InvalidRequest, "Gemini adapter is not implemented yet."))
    }

    fn test_connection(&self, _api_key: Option<&str>) -> Result<String, ProviderError> {
        Err(ProviderError::new(ProviderErrorKind::InvalidRequest, "Gemini adapter is not implemented yet."))
    }
}
