use std::io::Cursor;

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use serde_json::json;

use super::{
    EnhanceMode, ImageProvider, ModelCapabilities, ProviderError, ProviderErrorKind, ProviderImage, ProviderInfo,
    ProviderKind, ProviderOutput, ProviderRequest,
};

pub const ID: &str = "local_upscale";
pub const LABEL: &str = "Local upscale";
pub const MODEL_ID: &str = "lanczos3";
const MAX_EDGE: u32 = 8192;

pub struct LocalUpscaleProvider;

impl ImageProvider for LocalUpscaleProvider {
    fn info(&self) -> ProviderInfo {
        ProviderInfo {
            id: ID,
            label: LABEL,
            kind: ProviderKind::Local,
            requires_api_key: false,
            models: vec![ModelCapabilities {
                id: MODEL_ID.into(),
                label: "Conservative upscale (local)".into(),
                text_to_image: false,
                image_to_image: true,
                max_reference_images: 1,
                max_outputs: 1,
                aspect_ratios: vec![],
                image_sizes: vec![],
                supports_negative_prompt: false,
                supports_seed: false,
                quality_options: vec![],
                price_hint: None,
            }],
        }
    }

    fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        let enhance = request.params.enhance.as_ref().ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, "Local upscale requires enhancement parameters.")
        })?;
        if enhance.mode != EnhanceMode::Conservative {
            return Err(ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                "Local upscale only supports conservative enhancement.",
            ));
        }
        let target = enhance.target_long_edge.ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, "Conservative upscale requires a target long edge.")
        })?;
        if !(1..=MAX_EDGE as i32).contains(&target) {
            return Err(ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                "Enhancement target is outside the supported range.",
            ));
        }
        let reference = request.references.first().ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, "Local upscale requires one reference image.")
        })?;
        let source = image::load_from_memory(&reference.bytes).map_err(|e| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, format!("The source image could not be decoded: {e}"))
        })?;
        let output = resize_and_sharpen(&source, target as u32, enhance.detail_strength);
        let mut bytes = Vec::new();
        output.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).map_err(|e| {
            ProviderError::new(ProviderErrorKind::BadResponse, format!("Could not encode local upscale: {e}"))
        })?;
        Ok(ProviderOutput {
            images: vec![ProviderImage { mime_type: "image/png".into(), bytes }],
            meta: json!({ "renderer": MODEL_ID, "targetLongEdge": target }),
        })
    }

    fn test_connection(&self, _api_key: Option<&str>) -> Result<String, ProviderError> {
        Ok("Local upscale is ready.".into())
    }
}

/// Resize on the long edge, then apply a radius-1 unsharp mask. Alpha is copied unchanged.
pub fn resize_and_sharpen(source: &DynamicImage, target_long_edge: u32, detail_strength: i32) -> DynamicImage {
    let source_long = source.width().max(source.height());
    let scale = target_long_edge as f32 / source_long as f32;
    let width = ((source.width() as f32 * scale).round() as u32).max(1);
    let height = ((source.height() as f32 * scale).round() as u32).max(1);
    let resized = source.resize_exact(width, height, image::imageops::FilterType::Lanczos3).to_rgba8();
    if detail_strength == 0 {
        return DynamicImage::ImageRgba8(resized);
    }
    let amount = detail_strength as f32 / 100.0 * 0.6;
    let blurred = image::imageops::blur(&resized, 1.0);
    let mut output = RgbaImage::new(width, height);
    for (x, y, pixel) in output.enumerate_pixels_mut() {
        let original = resized.get_pixel(x, y);
        let smooth = blurred.get_pixel(x, y);
        let mut channels = [0; 4];
        for channel in 0..3 {
            let delta = original[channel] as i16 - smooth[channel] as i16;
            channels[channel] = if delta.unsigned_abs() <= 2 {
                original[channel]
            } else {
                (original[channel] as f32 + delta as f32 * amount).round().clamp(0.0, 255.0) as u8
            };
        }
        channels[3] = original[3];
        *pixel = Rgba(channels);
    }
    DynamicImage::ImageRgba8(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::{EnhanceParams, GenerationParams, PromptText, ReferenceImage};
    use image::GenericImageView;

    fn request(source: DynamicImage, target: u32, detail: u8) -> ProviderRequest {
        let mut bytes = Vec::new();
        source.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).unwrap();
        ProviderRequest {
            model_id: MODEL_ID.into(),
            prompt: PromptText {
                positive: String::new(),
                negative: String::new(),
                reference_instructions: String::new(),
                preservation_instructions: String::new(),
            },
            references: vec![ReferenceImage {
                asset_id: "AST_SOURCE".into(),
                role: "master_architecture".into(),
                mime_type: "image/png".into(),
                bytes,
            }],
            params: GenerationParams {
                aspect_ratio: None,
                image_size: None,
                output_count: 1,
                seed: None,
                quality: None,
                enhance: Some(EnhanceParams {
                    mode: EnhanceMode::Conservative,
                    target_long_edge: Some(target as i32),
                    detail_strength: detail as i32,
                    architecture_preserve: true,
                }),
            },
            api_key: None,
        }
    }

    #[test]
    fn exact_long_edge_and_aspect_are_preserved() {
        let output = LocalUpscaleProvider
            .generate(&request(DynamicImage::ImageRgba8(RgbaImage::from_pixel(3, 2, Rgba([80, 100, 120, 77]))), 12, 40))
            .unwrap();
        let image = image::load_from_memory(&output.images[0].bytes).unwrap();
        assert_eq!(image.dimensions(), (12, 8));
    }

    #[test]
    fn zero_strength_is_pure_lanczos_resize() {
        let source =
            DynamicImage::ImageRgba8(RgbaImage::from_fn(3, 2, |x, y| Rgba([x as u8 * 50, y as u8 * 80, 90, 123])));
        let expected = source.resize_exact(12, 8, image::imageops::FilterType::Lanczos3).to_rgba8();
        let actual =
            image::load_from_memory(&LocalUpscaleProvider.generate(&request(source, 12, 0)).unwrap().images[0].bytes)
                .unwrap()
                .to_rgba8();
        assert_eq!(actual, expected);
    }

    #[test]
    fn alpha_is_kept() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 1, Rgba([80, 100, 120, 42])));
        let output = LocalUpscaleProvider.generate(&request(source, 8, 100)).unwrap();
        let image = image::load_from_memory(&output.images[0].bytes).unwrap().to_rgba8();
        assert!(image.pixels().all(|p| p[3] == 42));
    }
}
