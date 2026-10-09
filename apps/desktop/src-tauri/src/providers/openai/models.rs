//! GPT Image model catalogue and the aspect-ratio / size-tier table, from the official docs
//! (checked 2026-10-09):
//! - guide (models, sizes, quality, limits): https://developers.openai.com/api/docs/guides/image-generation
//! - model pages: https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst,
//!   .../gpt-image-2.5-flare, .../gpt-image-2
//! - `POST /images/edits` reference ("up to 16 images", size rules):
//!   https://developers.openai.com/api/reference/resources/images/methods/edit

use super::super::ModelCapabilities;

/// The API takes `n` 1–10 in one request; the app's contract caps every model at 4.
pub const MAX_OUTPUTS: u32 = 4;

/// `POST /images/edits`: "For GPT image models, you can provide up to 16 images."
pub const MAX_REFERENCE_IMAGES: u32 = 16;

/// Model used by `test_connection` and listed first in the UI.
pub const DEFAULT_MODEL: &str = "gpt-image-2.5-sunburst";

/// Sent as `quality` on every request. Adapter choice, not an API default (the API defaults to
/// `auto`, which may pick the slower and dearer `xhigh`/`max` on the 2.5 models): `high` is the
/// best setting all three models accept and keeps cost per image predictable.
pub const QUALITY: &str = "high";

/// Size tiers offered in the UI. The API takes any `WIDTHxHEIGHT` within its limits; the adapter
/// maps (aspect ratio, tier) to one concrete size from [`SIZES`].
pub const IMAGE_SIZES: [&str; 2] = ["1K", "2K"];

/// The same ten ratios Gemini's standard models offer, all within the API's 1:3–3:1 range.
pub const ASPECT_RATIOS: [&str; 10] = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/// `(ratio, 1K size, 2K size)`. Every size satisfies the documented limits: both edges multiples
/// of 16, exact ratio, at least 655,360 pixels. 1K uses the docs' standard sizes where one
/// exists (1024x1024, 1536x1024, 1024x1536, 1536x864); 2K stays at or below the 2560x1440 pixel
/// count, above which the docs call resolutions experimental. 4K (up to 3840 px) is not offered
/// because it is experimental on the 2.5 models.
pub const SIZES: [(&str, &str, &str); 10] = [
    ("1:1", "1024x1024", "1920x1920"),
    ("2:3", "1024x1536", "1344x2016"),
    ("3:2", "1536x1024", "2016x1344"),
    ("3:4", "864x1152", "1536x2048"),
    ("4:3", "1152x864", "2048x1536"),
    ("4:5", "896x1120", "1600x2000"),
    ("5:4", "1120x896", "2000x1600"),
    ("9:16", "864x1536", "1152x2048"),
    ("16:9", "1536x864", "2048x1152"),
    ("21:9", "1680x720", "2016x864"),
];

/// The `size` field to send, or `None` to omit it and let the API choose (`auto`).
/// A ratio without a tier uses 1K; a tier without a ratio uses 1:1.
pub fn api_size(aspect_ratio: Option<&str>, image_size: Option<&str>) -> Option<&'static str> {
    if aspect_ratio.is_none() && image_size.is_none() {
        return None;
    }
    let ratio = aspect_ratio.unwrap_or("1:1");
    let (_, one_k, two_k) = SIZES.iter().find(|(r, _, _)| *r == ratio)?;
    match image_size.unwrap_or("1K") {
        "1K" => Some(one_k),
        "2K" => Some(two_k),
        _ => None,
    }
}

struct Spec {
    id: &'static str,
    label: &'static str,
}

const SPECS: [Spec; 3] = [
    // "Use it for workflows where editing precision matters most" (reference-heavy renders).
    Spec { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst" },
    // "Fast, high-quality everyday image generation".
    Spec { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare" },
    Spec { id: "gpt-image-2", label: "GPT Image 2 (earlier model)" },
];

fn to_capabilities(spec: &Spec) -> ModelCapabilities {
    ModelCapabilities {
        id: spec.id.into(),
        label: spec.label.into(),
        text_to_image: true,
        image_to_image: true,
        max_reference_images: MAX_REFERENCE_IMAGES,
        max_outputs: MAX_OUTPUTS,
        aspect_ratios: ASPECT_RATIOS.iter().map(|s| s.to_string()).collect(),
        image_sizes: IMAGE_SIZES.iter().map(|s| s.to_string()).collect(),
        // Neither endpoint has a negative-prompt or seed field; negatives go into the text.
        supports_negative_prompt: false,
        supports_seed: false,
    }
}

pub fn all() -> Vec<ModelCapabilities> {
    SPECS.iter().map(to_capabilities).collect()
}

pub fn find(model_id: &str) -> Option<ModelCapabilities> {
    SPECS.iter().find(|s| s.id == model_id).map(to_capabilities)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dims(size: &str) -> (u32, u32) {
        let (w, h) = size.split_once('x').unwrap();
        (w.parse().unwrap(), h.parse().unwrap())
    }

    #[test]
    fn every_size_meets_the_documented_limits_and_its_ratio() {
        assert_eq!(SIZES.iter().map(|(r, _, _)| *r).collect::<Vec<_>>(), ASPECT_RATIOS);
        for (ratio, one_k, two_k) in SIZES {
            let (rw, rh) = dims(&ratio.replace(':', "x"));
            for size in [one_k, two_k] {
                let (w, h) = dims(size);
                assert_eq!((w % 16, h % 16), (0, 0), "{size}: edges must be multiples of 16");
                assert_eq!(w * rh, h * rw, "{size} is not exactly {ratio}");
                assert!(w.max(h) <= 3 * w.min(h), "{size}: ratio beyond 3:1");
                assert!(w * h >= 655_360, "{size}: below the minimum pixel count");
                assert!(w.max(h) <= 3840, "{size}: edge above 3840");
            }
            let (w, h) = dims(two_k);
            assert!(w * h <= 2560 * 1440, "{two_k}: 2K must not be in the experimental range");
            let (w1, h1) = dims(one_k);
            assert!(w1 * h1 < w * h, "{ratio}: 2K must be larger than 1K");
        }
    }

    #[test]
    fn api_size_maps_ratio_and_tier() {
        assert_eq!(api_size(None, None), None, "nothing set: omit size, the API decides");
        assert_eq!(api_size(Some("16:9"), None), Some("1536x864"));
        assert_eq!(api_size(Some("3:2"), Some("2K")), Some("2016x1344"));
        assert_eq!(api_size(None, Some("2K")), Some("1920x1920"));
        assert_eq!(api_size(Some("7:3"), None), None);
        assert_eq!(api_size(Some("1:1"), Some("4K")), None);
    }
}
