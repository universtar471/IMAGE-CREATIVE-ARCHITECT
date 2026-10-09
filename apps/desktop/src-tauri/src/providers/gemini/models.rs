//! Gemini image model catalogue, transcribed from the official docs (checked 2026-10-08):
//! - model ids, aspect-ratio and resolution tables:
//!   https://ai.google.dev/gemini-api/docs/generate-content/image-generation
//! - lifecycle (release / shutdown dates): https://ai.google.dev/gemini-api/docs/deprecations
//!
//! Where the docs disagree with themselves the narrower value is used (see the agent note).

use super::super::ModelCapabilities;

/// Adapter strategy, not an API guarantee: the docs say the model "won't always follow the
/// exact number of image outputs" requested, so the adapter asks for one image per
/// `generateContent` call and runs `outputCount` calls in sequence. A call that returns several
/// images is accepted; the total is capped at `outputCount`.
pub const MAX_OUTPUTS: u32 = 4;

/// Model used by `test_connection` and listed first in the UI.
pub const DEFAULT_MODEL: &str = "gemini-nano-banana-2.1";

/// 14 ratios accepted by Nano Banana 2.1 and Gemini 3.1 Flash Image.
const RATIOS_EXTENDED: [&str; 14] =
    ["1:1", "1:4", "1:8", "2:3", "3:2", "3:4", "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9"];

/// 10 ratios accepted by Gemini 3 Pro Image, Gemini 3.1 Flash Lite Image and Gemini 2.5 Flash Image.
const RATIOS_STANDARD: [&str; 10] = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

struct Spec {
    id: &'static str,
    label: &'static str,
    max_reference_images: u32,
    aspect_ratios: &'static [&'static str],
    /// Sent verbatim as `imageConfig.imageSize` (uppercase K; "512" has no suffix).
    /// Empty = the model has a fixed output size and rejects `imageSize`.
    image_sizes: &'static [&'static str],
}

const SPECS: [Spec; 5] = [
    Spec {
        id: "gemini-nano-banana-2.1",
        label: "Nano Banana 2.1 (Gemini)",
        max_reference_images: 14,
        aspect_ratios: &RATIOS_EXTENDED,
        image_sizes: &["1K", "2K", "4K"],
    },
    Spec {
        id: "gemini-3-pro-image",
        label: "Nano Banana Pro (Gemini 3 Pro Image)",
        max_reference_images: 14,
        aspect_ratios: &RATIOS_STANDARD,
        image_sizes: &["1K", "2K", "4K"],
    },
    Spec {
        id: "gemini-3.1-flash-image",
        label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
        max_reference_images: 14,
        aspect_ratios: &RATIOS_EXTENDED,
        image_sizes: &["512", "1K", "2K", "4K"],
    },
    Spec {
        id: "gemini-3.1-flash-lite-image",
        label: "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
        max_reference_images: 14,
        aspect_ratios: &RATIOS_STANDARD,
        image_sizes: &["1K"],
    },
    Spec {
        id: "gemini-2.5-flash-image",
        label: "Nano Banana (Gemini 2.5 Flash Image, legacy)",
        // Docs: "works best with up to 3 images as input". Shutdown announced for 2027-03-15.
        max_reference_images: 3,
        aspect_ratios: &RATIOS_STANDARD,
        image_sizes: &[],
    },
];

fn to_capabilities(spec: &Spec) -> ModelCapabilities {
    ModelCapabilities {
        id: spec.id.into(),
        label: spec.label.into(),
        text_to_image: true,
        image_to_image: true,
        max_reference_images: spec.max_reference_images,
        max_outputs: MAX_OUTPUTS,
        aspect_ratios: spec.aspect_ratios.iter().map(|s| s.to_string()).collect(),
        image_sizes: spec.image_sizes.iter().map(|s| s.to_string()).collect(),
        // Gemini has no negative-prompt field; negatives are folded into the text ("Avoid: ...").
        supports_negative_prompt: false,
        // The docs do not state that image models honour `generationConfig.seed`.
        supports_seed: false,
        quality_options: Vec::new(),
        price_hint: None,
    }
}

pub fn all() -> Vec<ModelCapabilities> {
    SPECS.iter().map(to_capabilities).collect()
}

pub fn find(model_id: &str) -> Option<ModelCapabilities> {
    SPECS.iter().find(|s| s.id == model_id).map(to_capabilities)
}
