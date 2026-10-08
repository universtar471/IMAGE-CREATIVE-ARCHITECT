//! Offline provider that needs no key. Produces deterministic placeholder images so the
//! whole generation flow (persistence, lineage, history, UI) can be exercised without
//! network access or cost. Owned by task P2-A.

use super::{
    ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderInfo, ProviderKind, ProviderOutput,
    ProviderRequest,
};

pub const ID: &str = "local_preview";

pub struct LocalPreviewProvider;

impl ImageProvider for LocalPreviewProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ID,
            label: "Local preview (offline)",
            kind: ProviderKind::Local,
            requires_api_key: false,
            models: vec![ModelCapabilities {
                id: "placeholder-v1".into(),
                label: "Placeholder renderer".into(),
                text_to_image: true,
                image_to_image: true,
                max_reference_images: 14,
                max_outputs: 4,
                aspect_ratios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"].map(String::from).to_vec(),
                image_sizes: vec!["1K".into()],
                supports_negative_prompt: true,
                supports_seed: true,
            }],
        }
    }

    fn generate(&self, _request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        Err(ProviderError::new(ProviderErrorKind::InvalidRequest, "Local preview provider is not implemented yet."))
    }

    fn test_connection(&self, _api_key: Option<&str>) -> Result<String, ProviderError> {
        Ok("Offline provider, always available.".into())
    }
}
