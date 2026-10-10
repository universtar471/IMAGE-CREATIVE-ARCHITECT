//! Built-in HHTECH image model catalog (code, not environment).
//!
//! Facts from the lead's real calls and the gateway's web price list (2026-10-09, base
//! `https://hhtechapi.com/v1`):
//! - The gateway bills per resolution tier. Web UI prices per image (VND):
//!   GPT Image 2 180 / 500 / 800 (1K / 2K / 4K); GPT Image 2.5 Flare and Sunburst 280 / 600 /
//!   900; Gemini 3 Pro Image, 3.1 Flash Image and 2.5 Flash Image — / 500 / 800 (no 1K price).
//! - GPT Image models take the tier from `size`: base id `gpt-image-2` + `size` 2048x2048 →
//!   a 2048x2048 PNG (177 s); `gpt-image-2.5-sunburst` + 1024x1024 → 1254x1254 (150 s). A `-2k`
//!   suffixed GPT id with 1024x1024 returned 1254x1254, so suffixes are not used for GPT.
//! - Gemini models take the tier from a model-id suffix: the base id ignores `size`
//!   (`gemini-3-pro-image` + 2048x2048 → 1024x1024, 35 s; edits with one reference → 1024x1024,
//!   30 s), `gemini-3-pro-image-2k` + 2048x1152 → 2752x1536 (47 s), edits with the `-2k` id →
//!   2048x2048 (75 s). `gemini-3-pro-image-edit-2k` on `/images/edits` returned HTTP 502, so the
//!   `-edit-*` ids are never used. Like the gateway's published offer, Gemini exposes only 2K
//!   and 4K: requests always use `<base>-2k` or `<base>-4k` on both endpoints (never the bare
//!   base id), so every Gemini choice has a price and the default tier is 2K.
//! - `quality` was never sent to Gemini, so it is not sent there.
//!
//! Unlike the official OpenAI provider (which keeps no tiers because the API has none), these
//! tiers are real, separately billed products of the gateway, so they are advertised as
//! `imageSizes`.

use std::collections::BTreeMap;

use super::super::openai::{gateway_model, Route, TierStrategy, MAX_REFERENCE_IMAGES};
use super::super::{ModelCapabilities, QUALITY_VALUES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Gpt,
    Gemini,
}

/// Reference cap for the gateway's Gemini models. UNVERIFIED: only one reference was tested
/// live; 14 is Google's documented cap for its current image models.
pub const GEMINI_MAX_REFERENCE_IMAGES: u32 = 14;

pub struct Entry {
    /// Base model id, sent as is for GPT and as `<id>[-2k|-4k]` for Gemini.
    pub id: &'static str,
    pub label: &'static str,
    pub family: Family,
    /// Offered tiers in UI order with the web UI price per image in VND (`None` = offered,
    /// but the gateway publishes no price for it).
    pub tiers: &'static [(&'static str, Option<u32>)],
}

const GPT_2: &[(&str, Option<u32>)] = &[("1K", Some(180)), ("2K", Some(500)), ("4K", Some(800))];
const GPT_25: &[(&str, Option<u32>)] = &[("1K", Some(280)), ("2K", Some(600)), ("4K", Some(900))];
/// Only the published tiers (the bare base id, 1024 px, is not offered).
const GEMINI: &[(&str, Option<u32>)] = &[("2K", Some(500)), ("4K", Some(800))];

/// Default picker order (best first).
pub const CATALOG: [Entry; 6] = [
    Entry { id: "gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", family: Family::Gpt, tiers: GPT_25 },
    Entry { id: "gemini-3-pro-image", label: "Gemini 3 Pro Image (Banana)", family: Family::Gemini, tiers: GEMINI },
    Entry { id: "gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", family: Family::Gpt, tiers: GPT_25 },
    Entry { id: "gpt-image-2", label: "GPT Image 2", family: Family::Gpt, tiers: GPT_2 },
    Entry { id: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", family: Family::Gemini, tiers: GEMINI },
    Entry { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash Image", family: Family::Gemini, tiers: GEMINI },
];

pub fn find(id: &str) -> Option<&'static Entry> {
    CATALOG.iter().find(|e| e.id == id)
}

/// Tier selected for the default Gemini 3 Pro Image enhancement route.
pub fn enhance_tier(target_long_edge: Option<u32>) -> &'static str {
    if target_long_edge.is_some_and(|edge| edge > 2048) {
        "4K"
    } else {
        "2K"
    }
}

impl Entry {
    pub fn route(&self) -> Route {
        match self.family {
            Family::Gpt => Route { tiers: TierStrategy::Size, sends_quality: true },
            Family::Gemini => Route { tiers: TierStrategy::IdSuffix, sends_quality: false },
        }
    }

    /// Picker label with the price hint, e.g. "GPT Image 2.5 Sunburst · 1K 280đ / 2K 600đ / 4K 900đ".
    pub fn label_with_prices(&self) -> String {
        let prices: Vec<String> =
            self.tiers.iter().filter_map(|(tier, price)| price.map(|p| format!("{tier} {}", format_vnd(p)))).collect();
        if prices.is_empty() {
            self.label.to_string()
        } else {
            format!("{} · {}", self.label, prices.join(" / "))
        }
    }

    pub fn capabilities(&self) -> ModelCapabilities {
        let (max_reference_images, quality_options) = match self.family {
            Family::Gpt => (MAX_REFERENCE_IMAGES, QUALITY_VALUES.iter().map(|q| q.to_string()).collect()),
            Family::Gemini => (GEMINI_MAX_REFERENCE_IMAGES, Vec::new()),
        };
        let price_hint: BTreeMap<String, u32> =
            self.tiers.iter().filter_map(|(tier, price)| price.map(|p| (tier.to_string(), p))).collect();
        ModelCapabilities {
            label: self.label_with_prices(),
            max_reference_images,
            image_sizes: self.tiers.iter().map(|(tier, _)| tier.to_string()).collect(),
            quality_options,
            price_hint: Some(price_hint),
            vision: true,
            supports_mask: matches!(self.family, Family::Gpt),
            ..gateway_model(self.id)
        }
    }
}

/// An id outside the catalog (from `HHTECH_IMAGE_MODEL`): a plain GPT-style entry, as before
/// the catalog existed — no tiers, no price, `quality` sent and selectable.
pub fn plain_capabilities(id: &str) -> ModelCapabilities {
    ModelCapabilities {
        quality_options: QUALITY_VALUES.iter().map(|q| q.to_string()).collect(),
        vision: true,
        supports_mask: true,
        ..gateway_model(id)
    }
}

/// VND with a dot as thousands separator: 280 → "280đ", 1200 → "1.200đ".
pub fn format_vnd(amount: u32) -> String {
    let digits = amount.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push('.');
        }
        out.push(c);
    }
    out.push('đ');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_order_ids_and_families() {
        let ids: Vec<_> = CATALOG.iter().map(|e| e.id).collect();
        assert_eq!(
            ids,
            [
                "gpt-image-2.5-sunburst",
                "gemini-3-pro-image",
                "gpt-image-2.5-flare",
                "gpt-image-2",
                "gemini-3.1-flash-image",
                "gemini-2.5-flash-image",
            ]
        );
        for e in &CATALOG {
            let expected = if e.id.starts_with("gpt") { Family::Gpt } else { Family::Gemini };
            assert_eq!(e.family, expected, "{}", e.id);
            assert!(!e.id.contains("-edit"), "edit ids returned 502 live");
        }
    }

    #[test]
    fn gpt_capabilities_have_priced_tiers_and_quality() {
        let caps = find("gpt-image-2.5-sunburst").unwrap().capabilities();
        assert_eq!(caps.label, "GPT Image 2.5 Sunburst · 1K 280đ / 2K 600đ / 4K 900đ");
        assert_eq!(caps.image_sizes, ["1K", "2K", "4K"]);
        assert_eq!(caps.quality_options, ["low", "medium", "high"]);
        assert_eq!(caps.max_reference_images, 16);
        let hint = caps.price_hint.unwrap();
        assert_eq!((hint["1K"], hint["2K"], hint["4K"]), (280, 600, 900));
        let gpt2 = find("gpt-image-2").unwrap().capabilities();
        assert_eq!(gpt2.label, "GPT Image 2 · 1K 180đ / 2K 500đ / 4K 800đ");
        assert_eq!(find("gpt-image-2").unwrap().route(), Route { tiers: TierStrategy::Size, sends_quality: true });
    }

    #[test]
    fn gemini_capabilities_send_no_quality_and_have_no_1k_price() {
        let entry = find("gemini-3-pro-image").unwrap();
        let caps = entry.capabilities();
        assert_eq!(caps.label, "Gemini 3 Pro Image (Banana) · 2K 500đ / 4K 800đ");
        assert_eq!(caps.image_sizes, ["2K", "4K"], "only the published tiers; 2K is the default");
        assert!(caps.quality_options.is_empty());
        assert_eq!(caps.max_reference_images, GEMINI_MAX_REFERENCE_IMAGES);
        let hint = caps.price_hint.unwrap();
        assert_eq!(hint.get("1K"), None);
        assert_eq!((hint["2K"], hint["4K"]), (500, 800));
        assert_eq!(entry.route(), Route { tiers: TierStrategy::IdSuffix, sends_quality: false });
        assert_eq!(caps.aspect_ratios.len(), 10);
        assert!(!caps.supports_seed && !caps.supports_negative_prompt);
    }

    #[test]
    fn unknown_ids_are_plain_gpt_style_entries() {
        let caps = plain_capabilities("my-model");
        assert_eq!((caps.id.as_str(), caps.label.as_str()), ("my-model", "my-model"));
        assert!(caps.image_sizes.is_empty());
        assert_eq!(caps.price_hint, None);
        assert_eq!(caps.quality_options, ["low", "medium", "high"]);
        assert_eq!(find("my-model").map(|e| e.id), None);
    }

    #[test]
    fn vnd_uses_a_dot_for_thousands() {
        assert_eq!(format_vnd(0), "0đ");
        assert_eq!(format_vnd(280), "280đ");
        assert_eq!(format_vnd(1200), "1.200đ");
        assert_eq!(format_vnd(1234567), "1.234.567đ");
    }

    #[test]
    fn enhancement_tier_follows_requested_long_edge() {
        assert_eq!(enhance_tier(Some(2048)), "2K");
        assert_eq!(enhance_tier(Some(4096)), "4K");
        assert_eq!(enhance_tier(None), "2K");
    }
}
