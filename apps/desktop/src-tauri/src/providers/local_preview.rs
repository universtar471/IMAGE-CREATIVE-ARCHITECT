//! Offline provider that needs no key. Produces deterministic placeholder images so the
//! whole generation flow (persistence, lineage, history, UI) can be exercised without
//! network access or cost. Owned by task P2-A.
//!
//! Each output is a gradient with a few block "massing" shapes, all derived from a hash of
//! the prompt, seed and output index: the same request always yields the same PNG bytes.
//! With references, a downscaled copy of the first one is blended in so image-to-image
//! runs are visibly different from text-to-image runs.

use std::io::Cursor;

use image::codecs::png::{CompressionType, FilterType as PngFilter, PngEncoder};
use image::{ImageEncoder, ImageReader, RgbImage};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{
    ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderImage, ProviderInfo, ProviderKind,
    ProviderOutput, ProviderRequest,
};

pub const ID: &str = "local_preview";
pub const MODEL_ID: &str = "placeholder-v1";
/// Long edge of every output, whatever the aspect ratio.
pub const LONG_EDGE: u32 = 1024;
const DEFAULT_ASPECT: (u32, u32) = (4, 3);
/// The blended reference is sampled from a copy no larger than this.
const REFERENCE_EDGE: u32 = 256;

pub struct LocalPreviewProvider;

impl ImageProvider for LocalPreviewProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ID,
            label: "Local preview (offline)",
            kind: ProviderKind::Local,
            requires_api_key: false,
            models: vec![ModelCapabilities {
                id: MODEL_ID.into(),
                label: "Placeholder renderer".into(),
                text_to_image: true,
                image_to_image: true,
                max_reference_images: 14,
                max_outputs: 4,
                aspect_ratios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"].map(String::from).to_vec(),
                image_sizes: vec!["1K".into()],
                supports_negative_prompt: true,
                supports_seed: true,
                quality_options: Vec::new(),
                price_hint: None,
            }],
        }
    }

    fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        let (width, height) = dimensions(request.params.aspect_ratio.as_deref());
        let reference = match request.references.first() {
            Some(r) => Some(decode_reference(&r.bytes)?),
            None => None,
        };
        let count = request.params.output_count.max(1);
        let images = (0..count)
            .map(|index| {
                let digest = seed_digest(request, index);
                let img = render(&digest, width, height, reference.as_ref());
                encode_png(&img).map(|bytes| ProviderImage { mime_type: "image/png".into(), bytes })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ProviderOutput {
            images,
            meta: json!({ "renderer": MODEL_ID, "width": width, "height": height, "blendedReference": reference.is_some() }),
        })
    }

    fn test_connection(&self, _api_key: Option<&str>) -> Result<String, ProviderError> {
        Ok("Offline provider, always available.".into())
    }
}

/// `"W:H"` → pixel size with a long edge of [`LONG_EDGE`]. Unknown or malformed ratios fall
/// back to 4:3 (the service only lets offered ratios through).
pub fn dimensions(aspect_ratio: Option<&str>) -> (u32, u32) {
    let (w, h) = aspect_ratio
        .and_then(|s| s.split_once(':'))
        .and_then(|(w, h)| Some((w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?)))
        .filter(|&(w, h)| w > 0 && h > 0)
        .unwrap_or(DEFAULT_ASPECT);
    let scale = |a: u32, b: u32| ((LONG_EDGE as f64 * a as f64 / b as f64).round() as u32).max(1);
    if w >= h {
        (LONG_EDGE, scale(h, w))
    } else {
        (scale(w, h), LONG_EDGE)
    }
}

fn seed_digest(request: &ProviderRequest, index: u32) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in [request.prompt.positive.as_str(), request.prompt.negative.as_str()] {
        hasher.update((part.len() as u64).to_le_bytes());
        hasher.update(part.as_bytes());
    }
    hasher.update(request.params.seed.unwrap_or(0).to_le_bytes());
    hasher.update(index.to_le_bytes());
    hasher.finalize().into()
}

fn decode_reference(bytes: &[u8]) -> Result<RgbImage, ProviderError> {
    let img =
        ImageReader::new(Cursor::new(bytes)).with_guessed_format().ok().and_then(|r| r.decode().ok()).ok_or_else(
            || ProviderError::new(ProviderErrorKind::InvalidRequest, "The first reference image could not be decoded."),
        )?;
    Ok(img.thumbnail(REFERENCE_EDGE, REFERENCE_EDGE).to_rgb8())
}

fn render(d: &[u8; 32], width: u32, height: u32, reference: Option<&RgbImage>) -> RgbImage {
    let top = [d[0], d[1], d[2]];
    let bottom = [d[3] / 2, d[4] / 2, d[5] / 2];
    let lerp = |a: u8, b: u8, t: u32, n: u32| ((a as u32 * (n - t) + b as u32 * t) / n) as u8;
    let mut img = RgbImage::from_fn(width, height, |_, y| {
        image::Rgb([0, 1, 2].map(|c| lerp(top[c], bottom[c], y, height.max(1))))
    });

    // Up to five ground-standing blocks, so the placeholder reads as a building massing.
    let blocks = 2 + (d[6] % 4) as usize;
    for i in 0..blocks {
        let b = &d[8 + i * 4..12 + i * 4];
        let w = width / 8 + (b[0] as u32 * width / 4) / 255;
        let h = height / 6 + (b[1] as u32 * height / 2) / 255;
        let x0 = (b[2] as u32 * width.saturating_sub(w)) / 255;
        let y0 = height.saturating_sub(h + height / 10);
        let shade = [b[3], b[3].wrapping_add(d[7]), 255 - b[3]];
        for y in y0..(y0 + h).min(height) {
            for x in x0..(x0 + w).min(width) {
                img.put_pixel(x, y, image::Rgb(shade));
            }
        }
    }

    if let Some(r) = reference {
        let (rw, rh) = r.dimensions();
        for (x, y, px) in img.enumerate_pixels_mut() {
            let src = r
                .get_pixel((x as u64 * rw as u64 / width as u64) as u32, (y as u64 * rh as u64 / height as u64) as u32);
            // 60 % reference, 40 % placeholder.
            px.0 = [0, 1, 2].map(|c| ((src.0[c] as u32 * 3 + px.0[c] as u32 * 2) / 5) as u8);
        }
    }
    img
}

fn encode_png(img: &RgbImage) -> Result<Vec<u8>, ProviderError> {
    let mut out = Vec::new();
    PngEncoder::new_with_quality(&mut out, CompressionType::Fast, PngFilter::Adaptive)
        .write_image(img.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgb8)
        .map_err(|e| {
            ProviderError::new(ProviderErrorKind::BadResponse, format!("Could not encode the preview image: {e}"))
        })?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{GenerationParams, PromptText, ReferenceImage};

    fn request(prompt: &str, aspect: Option<&str>, count: u32, seed: Option<u64>) -> ProviderRequest {
        ProviderRequest {
            model_id: MODEL_ID.into(),
            prompt: PromptText {
                positive: prompt.into(),
                negative: String::new(),
                reference_instructions: String::new(),
                preservation_instructions: String::new(),
            },
            references: vec![],
            params: GenerationParams {
                aspect_ratio: aspect.map(String::from),
                image_size: None,
                output_count: count,
                seed,
                quality: None,
            },
            api_key: None,
        }
    }

    fn png_size(bytes: &[u8]) -> (u32, u32) {
        crate::imaging::inspect(bytes, "out").map(|i| (i.width, i.height)).unwrap()
    }

    #[test]
    fn dimensions_follow_aspect_ratio_with_1024_long_edge() {
        assert_eq!(dimensions(None), (1024, 768));
        assert_eq!(dimensions(Some("16:9")), (1024, 576));
        assert_eq!(dimensions(Some("9:16")), (576, 1024));
        assert_eq!(dimensions(Some("1:1")), (1024, 1024));
        assert_eq!(dimensions(Some("2:3")), (683, 1024));
        assert_eq!(dimensions(Some("nonsense")), (1024, 768));
        assert_eq!(dimensions(Some("0:3")), (1024, 768));
    }

    #[test]
    fn generate_is_deterministic_with_requested_count_and_size() {
        let p = LocalPreviewProvider;
        let a = p.generate(&request("white villa", Some("16:9"), 3, Some(7))).unwrap();
        let b = p.generate(&request("white villa", Some("16:9"), 3, Some(7))).unwrap();
        assert_eq!(a.images.len(), 3);
        assert_eq!(a.images, b.images, "same request must give the same bytes");
        for img in &a.images {
            assert_eq!(img.mime_type, "image/png");
            assert_eq!(png_size(&img.bytes), (1024, 576));
        }
        assert_ne!(a.images[0].bytes, a.images[1].bytes, "outputs differ by index");

        let other_seed = p.generate(&request("white villa", Some("16:9"), 1, Some(8))).unwrap();
        assert_ne!(other_seed.images[0].bytes, a.images[0].bytes);
        let other_prompt = p.generate(&request("black villa", Some("16:9"), 1, Some(7))).unwrap();
        assert_ne!(other_prompt.images[0].bytes, a.images[0].bytes);
    }

    #[test]
    fn reference_is_blended_into_the_output() {
        let p = LocalPreviewProvider;
        let plain = p.generate(&request("x", None, 1, None)).unwrap();

        let mut reference_png = Vec::new();
        RgbImage::from_pixel(40, 30, image::Rgb([250, 10, 10]))
            .write_to(&mut Cursor::new(&mut reference_png), image::ImageFormat::Png)
            .unwrap();
        let mut req = request("x", None, 1, None);
        req.references.push(ReferenceImage {
            asset_id: "AST_1".into(),
            role: "master_architecture".into(),
            mime_type: "image/png".into(),
            bytes: reference_png,
        });
        let blended = p.generate(&req).unwrap();
        assert_ne!(blended.images[0].bytes, plain.images[0].bytes);
        assert_eq!(png_size(&blended.images[0].bytes), (1024, 768));
        assert_eq!(blended.meta["blendedReference"], json!(true));

        req.references[0].bytes = b"not an image".to_vec();
        assert_eq!(p.generate(&req).unwrap_err().kind, ProviderErrorKind::InvalidRequest);
    }
}
