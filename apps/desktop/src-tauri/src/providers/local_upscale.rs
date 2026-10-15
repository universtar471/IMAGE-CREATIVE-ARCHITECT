use std::io::Cursor;

use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
use serde_json::json;

use super::{
    EnhanceMode, ImageProvider, ModelCapabilities, PreservationMode, ProviderError, ProviderErrorKind, ProviderImage,
    ProviderInfo, ProviderKind, ProviderOutput, ProviderRequest,
};
use crate::enhance::{self as sizing, SizeAction};

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
                supports_mask: false,
            }],
        }
    }

    fn generate(&self, request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
        let enhance = request.params.enhance.as_ref().ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, "Local upscale requires enhancement parameters.")
        })?;
        if enhance.mode != EnhanceMode::Conservative
            || matches!(enhance.preservation_mode, Some(PreservationMode::Balanced | PreservationMode::Creative))
        {
            return Err(ProviderError::new(
                ProviderErrorKind::InvalidRequest,
                "Local upscale only supports conservative enhancement.",
            ));
        }
        let reference = request.references.first().ok_or_else(|| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, "Local upscale requires one reference image.")
        })?;
        let source = image::load_from_memory(&reference.bytes).map_err(|e| {
            ProviderError::new(ProviderErrorKind::InvalidRequest, format!("The source image could not be decoded: {e}"))
        })?;
        let (output, meta) = if let Some(upscale) = enhance.upscale {
            let layout = sizing::resolve_upscale_size(
                source.width(),
                source.height(),
                upscale.target,
                upscale.if_already_larger,
            );
            if layout.action == SizeAction::Skip {
                return Err(ProviderError::new(
                    ProviderErrorKind::InvalidRequest,
                    "The source already exceeds the size target and was set to be skipped.",
                ));
            }
            if layout.canvas_width.max(layout.canvas_height) > MAX_EDGE {
                return Err(ProviderError::new(
                    ProviderErrorKind::InvalidRequest,
                    "Enhancement target is outside the supported range.",
                ));
            }
            let output = resize_to_layout(&source, &layout, enhance.detail_strength);
            let meta = json!({
                "renderer": MODEL_ID,
                "width": layout.width,
                "height": layout.height,
                "canvasWidth": layout.canvas_width,
                "canvasHeight": layout.canvas_height,
                "sizeAction": layout.action,
            });
            (output, meta)
        } else {
            let target = enhance.target_long_edge.ok_or_else(|| {
                ProviderError::new(
                    ProviderErrorKind::InvalidRequest,
                    "Conservative upscale requires a target long edge.",
                )
            })?;
            if !(1..=MAX_EDGE as i32).contains(&target) {
                return Err(ProviderError::new(
                    ProviderErrorKind::InvalidRequest,
                    "Enhancement target is outside the supported range.",
                ));
            }
            let output = resize_and_sharpen(&source, target as u32, enhance.detail_strength);
            (output, json!({ "renderer": MODEL_ID, "targetLongEdge": target }))
        };
        let mut bytes = Vec::new();
        output.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).map_err(|e| {
            ProviderError::new(ProviderErrorKind::BadResponse, format!("Could not encode local upscale: {e}"))
        })?;
        Ok(ProviderOutput { images: vec![ProviderImage { mime_type: "image/png".into(), bytes }], meta })
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
    resize_exact_and_sharpen(source, width, height, detail_strength)
}

/// Lanczos3 to an exact size, then the radius-1 unsharp mask. Alpha is copied unchanged.
fn resize_exact_and_sharpen(source: &DynamicImage, width: u32, height: u32, detail_strength: i32) -> DynamicImage {
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

/// Apply a resolved size layout: Lanczos3 plus the unsharp of `resize_and_sharpen`, then
/// letterbox padding for contain targets. `keep` returns the source pixels unchanged and
/// `quality_only` sharpens at the source size. Alpha is kept.
fn resize_to_layout(source: &DynamicImage, layout: &sizing::UpscaleSize, detail_strength: i32) -> DynamicImage {
    let content = match layout.action {
        SizeAction::Keep | SizeAction::Skip => source.to_rgba8(),
        SizeAction::QualityOnly | SizeAction::Upscale => {
            resize_exact_and_sharpen(source, layout.width, layout.height, detail_strength).to_rgba8()
        }
    };
    let fill = sizing::letterbox_fill(source.color().has_alpha());
    DynamicImage::ImageRgba8(sizing::place_on_canvas(&content, layout, fill))
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
                    preservation_mode: None,
                    locks: None,
                    allowed_region_ids: None,
                    upscale: None,
                }),
                repair: None,
                region: None,
            },
            api_key: None,
            mask: None,
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

    fn with_upscale(
        mut request: ProviderRequest,
        target: crate::providers::UpscaleTarget,
        if_already_larger: crate::providers::IfAlreadyLarger,
    ) -> ProviderRequest {
        let enhance = request.params.enhance.as_mut().unwrap();
        enhance.preservation_mode = Some(PreservationMode::Strict);
        enhance.target_long_edge = None;
        enhance.upscale = Some(crate::providers::UpscaleParams { target, if_already_larger });
        request
    }

    fn run(request: &ProviderRequest) -> RgbaImage {
        image::load_from_memory(&LocalUpscaleProvider.generate(request).unwrap().images[0].bytes).unwrap().to_rgba8()
    }

    use crate::providers::{ContainFit, IfAlreadyLarger, NamedUpscaleTarget, UpscaleTarget};

    #[test]
    fn three_by_two_reaches_exactly_4096_and_keeps_its_aspect() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(300, 200, |x, y| Rgba([x as u8, y as u8, 90, 255])));
        let request = with_upscale(
            request(source, 12, 0),
            UpscaleTarget::Named(NamedUpscaleTarget::LongEdge4096),
            IfAlreadyLarger::Keep,
        );
        let output = run(&request);
        assert_eq!(output.dimensions(), (4096, 2731));
        assert!((4096.0 / 2731.0 - 1.5_f64).abs() < 0.001);
    }

    #[test]
    fn uhd_contain_letterboxes_without_cropping_and_keeps_png_alpha() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(30, 20, Rgba([80, 100, 120, 42])));
        let request = with_upscale(
            request(source, 12, 60),
            UpscaleTarget::Custom { width: 96, height: 54, fit: ContainFit::Contain },
            IfAlreadyLarger::Keep,
        );
        let output = run(&request);
        assert_eq!(output.dimensions(), (96, 54));
        // 30x20 contained in 96x54 is 81x54 at x = 7: pillarbox columns are fully transparent.
        assert!((0..54).all(|y| output.get_pixel(0, y)[3] == 0 && output.get_pixel(95, y)[3] == 0));
        assert!((7..88).all(|x| output.get_pixel(x, 27)[3] == 42), "alpha of the image is kept");
    }

    #[test]
    fn opaque_sources_get_an_opaque_letterbox() {
        let source = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(20, 20, image::Rgb([200, 10, 10])));
        let request = with_upscale(
            request(source, 12, 0),
            UpscaleTarget::Custom { width: 40, height: 20, fit: ContainFit::Contain },
            IfAlreadyLarger::Keep,
        );
        let output = run(&request);
        assert_eq!(*output.get_pixel(0, 10), Rgba([0, 0, 0, 255]));
        assert_eq!(*output.get_pixel(20, 10), Rgba([200, 10, 10, 255]));
    }

    #[test]
    fn a_source_larger_than_the_target_follows_if_already_larger() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_fn(60, 40, |x, y| {
            Rgba([(x * 4) as u8, if (x + y) % 2 == 0 { 30 } else { 220 }, 90, 200])
        }));
        let target = UpscaleTarget::Custom { width: 40, height: 40, fit: ContainFit::Contain };
        let keep = run(&with_upscale(request(source.clone(), 12, 80), target, IfAlreadyLarger::Keep));
        assert_eq!(keep, source.to_rgba8(), "keep returns the source pixels unchanged");
        let quality = run(&with_upscale(request(source.clone(), 12, 80), target, IfAlreadyLarger::QualityOnly));
        assert_eq!(quality.dimensions(), (60, 40), "quality only never downscales");
        assert_ne!(quality, source.to_rgba8(), "quality only still sharpens");
        assert!(quality.pixels().all(|p| p[3] == 200));
        let skipped =
            LocalUpscaleProvider.generate(&with_upscale(request(source, 12, 80), target, IfAlreadyLarger::Skip));
        assert_eq!(skipped.unwrap_err().kind, ProviderErrorKind::InvalidRequest);
    }

    #[test]
    fn balanced_and_creative_are_refused_locally() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let mut req = request(source, 8, 0);
        req.params.enhance.as_mut().unwrap().preservation_mode = Some(PreservationMode::Balanced);
        assert!(LocalUpscaleProvider.generate(&req).is_err());
    }
}
