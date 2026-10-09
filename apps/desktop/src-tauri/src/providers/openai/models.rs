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

/// The same ten ratios Gemini's standard models offer, all within the API's 1:3–3:1 range.
pub const ASPECT_RATIOS: [&str; 10] = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/// `(ratio, size)`. The API takes any `WIDTHxHEIGHT` within its limits and has no resolution
/// tiers, so the app offers no `imageSizes` (Codex review openai-provider: only real tiers may
/// be advertised) and picks one concrete size per aspect ratio. Every size satisfies the
/// documented limits: both edges multiples of 16, exact ratio, at least 655,360 pixels, and it
/// uses the docs' standard sizes where one exists (1024x1024, 1536x1024, 1024x1536, 1536x864).
pub const SIZES: [(&str, &str); 10] = [
    ("1:1", "1024x1024"),
    ("2:3", "1024x1536"),
    ("3:2", "1536x1024"),
    ("3:4", "864x1152"),
    ("4:3", "1152x864"),
    ("4:5", "896x1120"),
    ("5:4", "1120x896"),
    ("9:16", "864x1536"),
    ("16:9", "1536x864"),
    ("21:9", "1680x720"),
];

/// The `size` field to send for an aspect ratio, or `None` (no ratio, or an unknown one) to omit
/// it and let the API choose (`auto`).
pub fn api_size(aspect_ratio: Option<&str>) -> Option<&'static str> {
    let ratio = aspect_ratio?;
    SIZES.iter().find(|(r, _)| *r == ratio).map(|(_, size)| *size)
}

/// The reduced aspect ratio of a `WIDTHxHEIGHT` size, e.g. `1536x864` → `16:9`.
pub fn ratio_of(size: &str) -> Option<String> {
    let (w, h) = size.split_once('x')?;
    let (w, h): (u32, u32) = (w.trim().parse().ok()?, h.trim().parse().ok()?);
    if w == 0 || h == 0 {
        return None;
    }
    let gcd = {
        let (mut a, mut b) = (w, h);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        a
    };
    Some(format!("{}:{}", w / gcd, h / gcd))
}

/// Capabilities of a model behind an OpenAI-compatible gateway: same request shape as GPT Image
/// (ten aspect ratios, no size tiers, no seed or negative prompt), outputs capped at 4.
pub fn gateway_model(id: &str) -> ModelCapabilities {
    ModelCapabilities { id: id.into(), label: id.into(), ..to_capabilities(&SPECS[0]) }
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
        // No resolution tiers: `imageSize` must stay null; the size follows the aspect ratio.
        image_sizes: Vec::new(),
        // Neither endpoint has a negative-prompt or seed field; negatives go into the text.
        supports_negative_prompt: false,
        supports_seed: false,
    }
}

pub fn all() -> Vec<ModelCapabilities> {
    SPECS.iter().map(to_capabilities).collect()
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
        assert_eq!(SIZES.iter().map(|(r, _)| *r).collect::<Vec<_>>(), ASPECT_RATIOS);
        for (ratio, size) in SIZES {
            let (rw, rh) = dims(&ratio.replace(':', "x"));
            let (w, h) = dims(size);
            assert_eq!((w % 16, h % 16), (0, 0), "{size}: edges must be multiples of 16");
            assert_eq!(w * rh, h * rw, "{size} is not exactly {ratio}");
            assert!(w.max(h) <= 3 * w.min(h), "{size}: ratio beyond 3:1");
            assert!(w * h >= 655_360, "{size}: below the minimum pixel count");
            assert!(w * h <= 2560 * 1440, "{size}: must not be in the experimental range");
        }
    }

    #[test]
    fn api_size_follows_the_aspect_ratio_only() {
        assert_eq!(api_size(None), None, "no ratio: omit size, the API decides");
        assert_eq!(api_size(Some("16:9")), Some("1536x864"));
        assert_eq!(api_size(Some("3:2")), Some("1536x1024"));
        assert_eq!(api_size(Some("7:3")), None);
    }

    #[test]
    fn ratio_of_reduces_sizes() {
        assert_eq!(ratio_of("1024x1024").as_deref(), Some("1:1"));
        assert_eq!(ratio_of("1536x864").as_deref(), Some("16:9"));
        assert_eq!(ratio_of("1024x1536").as_deref(), Some("2:3"));
        assert_eq!(ratio_of("auto"), None);
        assert_eq!(ratio_of("0x10"), None);
    }

    #[test]
    fn models_advertise_no_invented_size_tiers() {
        for model in all() {
            assert!(model.image_sizes.is_empty(), "{}", model.id);
        }
    }
}
