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

/// How a model turns the requested resolution tier (`imageSize`) into a request. Only gateways
/// configure anything but [`TierStrategy::None`]; see `providers::hhtech` for the live facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TierStrategy {
    /// No tiers: the size follows the aspect ratio (official OpenAI, unknown gateway ids).
    None,
    /// The tier sets the pixel `size` (HHTECH GPT Image models).
    Size,
    /// The tier is a model-id suffix (`-2k`, `-4k`; 1K = the base id) and `size` only carries the
    /// aspect (HHTECH Gemini models).
    IdSuffix,
}

/// Per-model request routing of the adapter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Route {
    pub tiers: TierStrategy,
    /// Whether the `quality` field is sent at all.
    pub sends_quality: bool,
}

impl Default for Route {
    fn default() -> Self {
        Self { tiers: TierStrategy::None, sends_quality: true }
    }
}

/// Long edge in pixels of each resolution tier (HHTECH bills per tier; 4K is 3840, not 4096).
pub const TIER_LONG_EDGES: [(&str, u32); 3] = [("1K", 1024), ("2K", 2048), ("4K", 3840)];

/// `WIDTHxHEIGHT` for an aspect ratio (`W:H`) at a tier: the long edge from
/// [`TIER_LONG_EDGES`], the short edge by the ratio, rounded to a multiple of 16. `None` for an
/// unknown tier or a ratio that does not parse.
pub fn tier_size(ratio: &str, tier: &str) -> Option<String> {
    let long = TIER_LONG_EDGES.iter().find(|(t, _)| *t == tier)?.1;
    let (w, h) = ratio.split_once(':')?;
    let (w, h): (f64, f64) = (w.trim().parse().ok()?, h.trim().parse().ok()?);
    if !(w > 0.0 && h > 0.0 && w.is_finite() && h.is_finite()) {
        return None;
    }
    let short = ((f64::from(long) * w.min(h) / w.max(h)) / 16.0).round().max(1.0) as u32 * 16;
    Some(if w >= h { format!("{long}x{short}") } else { format!("{short}x{long}") })
}

/// The model id to send: with [`TierStrategy::IdSuffix`] the 2K / 4K tiers append `-2k` /
/// `-4k`; everything else sends the base id.
pub fn tier_model_id(base: &str, tiers: TierStrategy, tier: Option<&str>) -> String {
    match (tiers, tier) {
        (TierStrategy::IdSuffix, Some(tier)) if tier != "1K" => format!("{base}-{}", tier.to_ascii_lowercase()),
        _ => base.to_string(),
    }
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
        quality_options: Vec::new(),
        price_hint: None,
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
    fn tier_sizes_scale_the_long_edge_and_keep_the_ratio() {
        assert_eq!(tier_size("1:1", "1K").as_deref(), Some("1024x1024"));
        assert_eq!(tier_size("1:1", "2K").as_deref(), Some("2048x2048"));
        assert_eq!(tier_size("1:1", "4K").as_deref(), Some("3840x3840"));
        assert_eq!(tier_size("16:9", "1K").as_deref(), Some("1024x576"));
        assert_eq!(tier_size("16:9", "2K").as_deref(), Some("2048x1152"));
        assert_eq!(tier_size("16:9", "4K").as_deref(), Some("3840x2160"));
        assert_eq!(tier_size("9:16", "2K").as_deref(), Some("1152x2048"));
        assert_eq!(tier_size("3:2", "1K").as_deref(), Some("1024x688"), "682.7 rounds to 688");
        assert_eq!(tier_size("21:9", "4K").as_deref(), Some("3840x1648"), "1645.7 rounds to 1648");
        assert_eq!(tier_size("1:1", "8K"), None);
        assert_eq!(tier_size("wide", "1K"), None);
        assert_eq!(tier_size("0:1", "1K"), None);
        for ratio in ASPECT_RATIOS {
            for (tier, long) in TIER_LONG_EDGES {
                let (w, h) = dims(&tier_size(ratio, tier).unwrap());
                assert_eq!((w % 16, h % 16), (0, 0), "{ratio} {tier}");
                assert_eq!(w.max(h), long, "{ratio} {tier}");
            }
        }
    }

    #[test]
    fn only_the_id_suffix_strategy_renames_the_model() {
        assert_eq!(tier_model_id("gemini-3-pro-image", TierStrategy::IdSuffix, Some("1K")), "gemini-3-pro-image");
        assert_eq!(tier_model_id("gemini-3-pro-image", TierStrategy::IdSuffix, Some("2K")), "gemini-3-pro-image-2k");
        assert_eq!(tier_model_id("gemini-3-pro-image", TierStrategy::IdSuffix, Some("4K")), "gemini-3-pro-image-4k");
        assert_eq!(tier_model_id("gemini-3-pro-image", TierStrategy::IdSuffix, None), "gemini-3-pro-image");
        assert_eq!(tier_model_id("gpt-image-2", TierStrategy::Size, Some("4K")), "gpt-image-2");
        assert_eq!(tier_model_id("gpt-image-2", TierStrategy::None, Some("2K")), "gpt-image-2");
    }

    #[test]
    fn models_advertise_no_invented_size_tiers() {
        for model in all() {
            assert!(model.image_sizes.is_empty(), "{}", model.id);
        }
    }
}
