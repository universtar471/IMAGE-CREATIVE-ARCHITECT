//! SRS P3 enhancement helpers (ADR-035): deterministic upscale sizing, letterboxing,
//! locked-region compositing and the local `EnhanceCheck`. Pure image math: no I/O, no
//! provider calls, no Vision QC (ADR-033). The size math mirrors the domain
//! `resolveUpscaleSize` (shared vectors in `packages/domain/test-vectors/upscale.json`).

use image::imageops::FilterType;
use image::{DynamicImage, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::providers::{
    EnhanceMode, EnhanceParams, IfAlreadyLarger, NamedUpscaleTarget, PreservationMode, UpscaleTarget,
};

pub const CHECK_VERSION: &str = "ec-1.0.0";
pub const UHD: (u32, u32) = (3840, 2160);
/// Locked pixels must keep at least this SSIM against the source (ADR-035).
pub const MIN_LOCKED_SSIM: f64 = 0.98;
/// Largest accepted global shift, in pixels of the registration grid.
pub const MAX_REGISTRATION_SHIFT: f64 = 1.0;
/// Largest accepted relative aspect change of the provider output.
pub const MAX_ASPECT_DELTA: f64 = 0.01;
/// Strict mode: largest accepted share of output edges that are new.
pub const MAX_EDGE_DELTA: f64 = 0.05;

const REGISTRATION_GRID: u32 = 128;
const REGISTRATION_RADIUS: i32 = 12;
const CHECK_GRID: u32 = 256;
const SSIM_WINDOW: u32 = 8;
const SSIM_STRIDE: u32 = 4;
const EDGE_THRESHOLD: f32 = 80.0;
/// Inward feather of the allowed mask, in output pixels.
const COMPOSITE_FEATHER_PX: u32 = 4;

/// What the size step does with a source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SizeAction {
    Upscale,
    Keep,
    QualityOnly,
    Skip,
}

impl From<IfAlreadyLarger> for SizeAction {
    fn from(value: IfAlreadyLarger) -> Self {
        match value {
            IfAlreadyLarger::Keep => SizeAction::Keep,
            IfAlreadyLarger::QualityOnly => SizeAction::QualityOnly,
            IfAlreadyLarger::Skip => SizeAction::Skip,
        }
    }
}

/// The image (`width` x `height`) placed at (`offset_x`, `offset_y`) inside its canvas.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpscaleSize {
    pub width: u32,
    pub height: u32,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub offset_x: u32,
    pub offset_y: u32,
    pub action: SizeAction,
}

impl UpscaleSize {
    fn exact(width: u32, height: u32, action: SizeAction) -> Self {
        Self { width, height, canvas_width: width, canvas_height: height, offset_x: 0, offset_y: 0, action }
    }

    pub fn letterbox(&self) -> bool {
        self.width != self.canvas_width || self.height != self.canvas_height
    }
}

/// round(a / b) for non-negative integers, half up; the same integer math as the domain.
fn round_div(a: u64, b: u64) -> u32 {
    ((2 * a + b) / (2 * b)) as u32
}

fn long_edge_size(sw: u32, sh: u32, edge: u32) -> (u32, u32) {
    let (w, h, e) = (u64::from(sw), u64::from(sh), u64::from(edge));
    if sw >= sh {
        (edge, round_div(h * e, w).max(1))
    } else {
        (round_div(w * e, h).max(1), edge)
    }
}

/// Resolve a size target: aspect is always kept, long edges are exact, UHD and custom targets
/// contain and letterbox (never crop), and a source larger than the target is never
/// downscaled: `if_already_larger` decides instead.
pub fn resolve_upscale_size(
    sw: u32,
    sh: u32,
    target: UpscaleTarget,
    if_already_larger: IfAlreadyLarger,
) -> UpscaleSize {
    let (sw, sh) = (sw.max(1), sh.max(1));
    let larger = UpscaleSize::exact(sw, sh, if_already_larger.into());
    let (cw, ch) = match target {
        UpscaleTarget::Named(NamedUpscaleTarget::LongEdge2048 | NamedUpscaleTarget::LongEdge4096) => {
            let edge = if target == UpscaleTarget::Named(NamedUpscaleTarget::LongEdge2048) { 2048 } else { 4096 };
            if sw.max(sh) > edge {
                return larger;
            }
            let (w, h) = long_edge_size(sw, sh, edge);
            return UpscaleSize::exact(w, h, SizeAction::Upscale);
        }
        UpscaleTarget::Named(NamedUpscaleTarget::Uhd3840x2160Contain) => UHD,
        UpscaleTarget::Custom { width, height, .. } => (width.max(1), height.max(1)),
    };
    if sw > cw || sh > ch {
        return larger;
    }
    let (w, h, cw64, ch64) = (u64::from(sw), u64::from(sh), u64::from(cw), u64::from(ch));
    let (width, height) =
        if w * ch64 >= h * cw64 { (cw, round_div(h * cw64, w).max(1)) } else { (round_div(w * ch64, h).max(1), ch) };
    UpscaleSize {
        width,
        height,
        canvas_width: cw,
        canvas_height: ch,
        offset_x: (cw - width) / 2,
        offset_y: (ch - height) / 2,
        action: SizeAction::Upscale,
    }
}

/// Output layout of a P3 enhance: the `upscale` target, else the legacy target long edge,
/// else the source size.
pub fn expected_layout(params: &EnhanceParams, sw: u32, sh: u32) -> UpscaleSize {
    if let Some(upscale) = params.upscale {
        return resolve_upscale_size(sw, sh, upscale.target, upscale.if_already_larger);
    }
    match params.target_long_edge {
        Some(edge) if edge as u32 >= sw.max(sh) => {
            let (w, h) = long_edge_size(sw.max(1), sh.max(1), edge as u32);
            UpscaleSize::exact(w, h, SizeAction::Upscale)
        }
        _ => UpscaleSize::exact(sw.max(1), sh.max(1), SizeAction::Keep),
    }
}

/// Letterbox padding: transparent for sources with alpha, opaque black otherwise.
pub fn letterbox_fill(source_has_alpha: bool) -> Rgba<u8> {
    if source_has_alpha {
        Rgba([0, 0, 0, 0])
    } else {
        Rgba([0, 0, 0, 255])
    }
}

/// Place `content` (already `layout.width` x `layout.height`) on the layout's canvas.
pub fn place_on_canvas(content: &RgbaImage, layout: &UpscaleSize, fill: Rgba<u8>) -> RgbaImage {
    if !layout.letterbox() {
        return content.clone();
    }
    let mut canvas = RgbaImage::from_pixel(layout.canvas_width, layout.canvas_height, fill);
    image::imageops::replace(&mut canvas, content, i64::from(layout.offset_x), i64::from(layout.offset_y));
    canvas
}

fn crop_content(image: &RgbaImage, layout: &UpscaleSize) -> RgbaImage {
    image::imageops::crop_imm(image, layout.offset_x, layout.offset_y, layout.width, layout.height).to_image()
}

fn resize_to(image: &DynamicImage, width: u32, height: u32) -> RgbaImage {
    if image.width() == width && image.height() == height {
        image.to_rgba8()
    } else {
        image.resize_exact(width, height, FilterType::Lanczos3).to_rgba8()
    }
}

/// Restore locked pixels from the source. `allowed` is the unfeathered region mask at the
/// content size (255 = AI may edit). The blend is feathered inward only, so every locked pixel
/// is exactly the (resized) source.
pub fn composite_locked(source: &RgbaImage, generated: &RgbaImage, allowed: &[u8]) -> RgbaImage {
    let (width, height) = source.dimensions();
    let feathered = crate::services::regions::mask::feather_mask(allowed, width, height, COMPOSITE_FEATHER_PX);
    let mut out = source.clone();
    for (index, (pixel, generated)) in out.pixels_mut().zip(generated.pixels()).enumerate() {
        let a = f32::from(allowed[index].min(feathered[index])) / 255.0;
        if a <= 0.0 {
            continue;
        }
        for c in 0..3 {
            pixel[c] = (f32::from(pixel[c]) * (1.0 - a) + f32::from(generated[c]) * a).round() as u8;
        }
    }
    out
}

// ------------------------------------------------------------------ the check

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckReason {
    SizeMismatch,
    AspectChanged,
    RegistrationShift,
    LockedSsimLow,
    EdgeStructureChanged,
    NoAllowedRegion,
    CreativeReview,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct PixelSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct ContentRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registration {
    pub dx: f64,
    pub dy: f64,
    pub shift_px: f64,
}

/// Mirrors `EnhanceCheckSchema`. A check, not a score: it never blocks saving.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceCheck {
    pub id: String,
    pub version: &'static str,
    pub preservation_mode: PreservationMode,
    pub status: &'static str,
    pub reasons: Vec<CheckReason>,
    pub expected_size: PixelSize,
    pub actual_size: PixelSize,
    pub content: ContentRect,
    pub aspect_delta: f64,
    pub registration: Registration,
    pub locked_ssim: Option<f64>,
    pub locked_pct: f64,
    pub edge_delta: Option<f64>,
    pub composited: bool,
    pub size_action: SizeAction,
}

/// Everything the check compares.
pub struct CheckInput<'a> {
    pub mode: PreservationMode,
    pub source: &'a DynamicImage,
    /// The final image (canvas size).
    pub output: &'a RgbaImage,
    pub layout: UpscaleSize,
    /// Size of what the provider returned for the image area (before any resize).
    pub provider_content: (u32, u32),
    /// The provider output at the content size, before locked pixels were restored; used for
    /// registration (a composite would hide a shifted AI output). `None` = the final content.
    pub provider_image: Option<&'a RgbaImage>,
    /// Unfeathered allowed mask at the content size; `None` = no mask.
    pub allowed: Option<&'a [u8]>,
    pub composited: bool,
}

fn round_to(value: f64, places: i32) -> f64 {
    let factor = 10_f64.powi(places);
    (value * factor).round() / factor
}

/// Grid size with the source aspect and the given long edge.
fn grid_size(sw: u32, sh: u32, long: u32) -> (u32, u32) {
    let (w, h) = long_edge_size(sw.max(1), sh.max(1), long);
    (w.max(SSIM_WINDOW), h.max(SSIM_WINDOW))
}

/// Luma (BT.601) of `image` resized to `width` x `height`.
fn luma(image: &DynamicImage, width: u32, height: u32) -> Vec<f32> {
    let resized = image.resize_exact(width, height, FilterType::Triangle).to_rgba8();
    resized.pixels().map(|p| 0.299 * f32::from(p[0]) + 0.587 * f32::from(p[1]) + 0.114 * f32::from(p[2])).collect()
}

/// Global integer offset of `b` against `a`. The central part of `a` (inset by the search
/// radius, so every shift compares the same pixels) is matched against shifted windows of `b`
/// by mean absolute difference. A shift is reported only when it explains the difference
/// clearly better than no shift (half the error), so a locally edited region does not read as
/// a global shift; ties prefer the smaller shift.
fn register(a: &[f32], b: &[f32], width: u32, height: u32) -> (i32, i32) {
    let (w, h) = (width as i32, height as i32);
    let (rx, ry) = (REGISTRATION_RADIUS.min((w - 1) / 4), REGISTRATION_RADIUS.min((h - 1) / 4));
    let mad = |dx: i32, dy: i32| {
        let mut sum = 0.0_f64;
        for y in ry..h - ry {
            let (row_a, row_b) = ((y * w) as usize, ((y + dy) * w) as usize);
            for x in rx..w - rx {
                sum += f64::from((a[row_a + x as usize] - b[row_b + (x + dx) as usize]).abs());
            }
        }
        sum / f64::from(((w - 2 * rx) * (h - 2 * ry)).max(1))
    };
    let zero = mad(0, 0);
    let mut best = (zero, 0_i32, 0_i32);
    for dy in -ry..=ry {
        for dx in -rx..=rx {
            let mean = mad(dx, dy);
            let better = mean < best.0 - 1e-9
                || ((mean - best.0).abs() <= 1e-9 && dx.abs() + dy.abs() < best.1.abs() + best.2.abs());
            if better {
                best = (mean, dx, dy);
            }
        }
    }
    if best.0 < zero * 0.5 {
        (best.1, best.2)
    } else {
        (0, 0)
    }
}

/// Mean SSIM of 8x8 windows (stride 4) whose pixels are all locked. `None` when no window is.
fn locked_ssim(a: &[f32], b: &[f32], locked: &[bool], width: u32, height: u32) -> Option<f64> {
    const C1: f64 = (0.01 * 255.0) * (0.01 * 255.0);
    const C2: f64 = (0.03 * 255.0) * (0.03 * 255.0);
    let (mut total, mut windows) = (0.0_f64, 0_u32);
    let mut y = 0;
    while y + SSIM_WINDOW <= height {
        let mut x = 0;
        while x + SSIM_WINDOW <= width {
            let indices = (y..y + SSIM_WINDOW)
                .flat_map(|yy| (x..x + SSIM_WINDOW).map(move |xx| (yy * width + xx) as usize))
                .collect::<Vec<_>>();
            if indices.iter().all(|&i| locked[i]) {
                let n = indices.len() as f64;
                let mean_a = indices.iter().map(|&i| f64::from(a[i])).sum::<f64>() / n;
                let mean_b = indices.iter().map(|&i| f64::from(b[i])).sum::<f64>() / n;
                let (mut var_a, mut var_b, mut cov) = (0.0, 0.0, 0.0);
                for &i in &indices {
                    let (da, db) = (f64::from(a[i]) - mean_a, f64::from(b[i]) - mean_b);
                    var_a += da * da;
                    var_b += db * db;
                    cov += da * db;
                }
                let (var_a, var_b, cov) = (var_a / (n - 1.0), var_b / (n - 1.0), cov / (n - 1.0));
                total += ((2.0 * mean_a * mean_b + C1) * (2.0 * cov + C2))
                    / ((mean_a * mean_a + mean_b * mean_b + C1) * (var_a + var_b + C2));
                windows += 1;
            }
            x += SSIM_STRIDE;
        }
        y += SSIM_STRIDE;
    }
    (windows > 0).then(|| total / f64::from(windows))
}

/// Sobel edge map (magnitude above `threshold`); the border is never an edge.
fn edges(l: &[f32], width: u32, height: u32, threshold: f32) -> Vec<bool> {
    let (w, h) = (width as usize, height as usize);
    let mut out = vec![false; w * h];
    for y in 1..h.saturating_sub(1) {
        for x in 1..w.saturating_sub(1) {
            let p = |dx: isize, dy: isize| l[(y as isize + dy) as usize * w + (x as isize + dx) as usize];
            let gx = p(1, -1) + 2.0 * p(1, 0) + p(1, 1) - p(-1, -1) - 2.0 * p(-1, 0) - p(-1, 1);
            let gy = p(-1, 1) + 2.0 * p(0, 1) + p(1, 1) - p(-1, -1) - 2.0 * p(0, -1) - p(1, -1);
            out[y * w + x] = gx.hypot(gy) > threshold;
        }
    }
    out
}

/// Share of output edge pixels with no source edge within one pixel; 0 when there are few.
/// The source map uses half the threshold, so sharpening an existing soft edge is not "new".
fn edge_delta(source: &[f32], output: &[f32], width: u32, height: u32) -> f64 {
    let src = edges(source, width, height, EDGE_THRESHOLD / 2.0);
    let out = edges(output, width, height, EDGE_THRESHOLD);
    let (w, h) = (width as i64, height as i64);
    let near_source = |x: i64, y: i64| {
        (-1..=1).any(|dy| {
            (-1..=1).any(|dx| {
                let (xx, yy) = (x + dx, y + dy);
                xx >= 0 && yy >= 0 && xx < w && yy < h && src[(yy * w + xx) as usize]
            })
        })
    };
    let (mut total, mut new) = (0_u32, 0_u32);
    for y in 0..h {
        for x in 0..w {
            if out[(y * w + x) as usize] {
                total += 1;
                if !near_source(x, y) {
                    new += 1;
                }
            }
        }
    }
    // A handful of pixels on a flat image is noise, not new structure.
    if f64::from(new) < f64::from(width * height) * 0.002 {
        return 0.0;
    }
    f64::from(new) / f64::from(total.max(1))
}

/// Run the local checks of ADR-035 on a finished output.
pub fn compute_check(input: &CheckInput<'_>) -> EnhanceCheck {
    let layout = input.layout;
    let (sw, sh) = (input.source.width().max(1), input.source.height().max(1));
    let mut reasons = Vec::new();

    let actual = PixelSize { width: input.output.width(), height: input.output.height() };
    let expected = PixelSize { width: layout.canvas_width, height: layout.canvas_height };
    if actual != expected {
        reasons.push(CheckReason::SizeMismatch);
    }
    let source_aspect = f64::from(sw) / f64::from(sh);
    let (pw, ph) = (input.provider_content.0.max(1), input.provider_content.1.max(1));
    let aspect_delta = ((f64::from(pw) / f64::from(ph) - source_aspect).abs() / source_aspect)
        .max((f64::from(layout.width) / f64::from(layout.height) - source_aspect).abs() / source_aspect);
    if aspect_delta > MAX_ASPECT_DELTA {
        reasons.push(CheckReason::AspectChanged);
    }

    let content = if actual == expected {
        DynamicImage::ImageRgba8(crop_content(input.output, &layout))
    } else {
        DynamicImage::ImageRgba8(input.output.clone())
    };

    // The reference is the source resampled to the content size exactly as the pipeline does
    // (Lanczos3), so an untouched or restored pixel compares equal.
    let reference = DynamicImage::ImageRgba8(resize_to(input.source, content.width(), content.height()));
    let (rw, rh) = grid_size(sw, sh, REGISTRATION_GRID);
    let registered = match input.provider_image {
        Some(image) => DynamicImage::ImageRgba8(image.clone()),
        None => content.clone(),
    };
    let (dx, dy) = register(&luma(&reference, rw, rh), &luma(&registered, rw, rh), rw, rh);
    let grid_shift = f64::from(dx).hypot(f64::from(dy));
    let to_source = f64::from(sw.max(sh)) / f64::from(rw.max(rh));
    if grid_shift > MAX_REGISTRATION_SHIFT {
        reasons.push(CheckReason::RegistrationShift);
    }

    let (gw, gh) = grid_size(sw, sh, CHECK_GRID);
    let source_luma = luma(&reference, gw, gh);
    let output_luma = luma(&content, gw, gh);
    let locked: Vec<bool> = match (input.mode, input.allowed) {
        (PreservationMode::Strict, _) => vec![true; (gw * gh) as usize],
        (_, None) => vec![false; (gw * gh) as usize],
        (_, Some(mask)) => {
            let (mw, mh) = (layout.width, layout.height);
            (0..gh)
                .flat_map(|y| (0..gw).map(move |x| (x, y)))
                .map(|(x, y)| {
                    let mx = ((u64::from(x) * 2 + 1) * u64::from(mw) / (u64::from(gw) * 2)) as u32;
                    let my = ((u64::from(y) * 2 + 1) * u64::from(mh) / (u64::from(gh) * 2)) as u32;
                    mask.get((my.min(mh - 1) * mw + mx.min(mw - 1)) as usize).is_some_and(|v| *v == 0)
                })
                .collect()
        }
    };
    let locked_pct = round_to(locked.iter().filter(|v| **v).count() as f64 * 100.0 / locked.len() as f64, 1);
    let ssim = locked_ssim(&source_luma, &output_luma, &locked, gw, gh).map(|v| round_to(v, 4));
    if ssim.is_some_and(|v| v < MIN_LOCKED_SSIM) {
        reasons.push(CheckReason::LockedSsimLow);
    }
    let edge =
        (input.mode == PreservationMode::Strict).then(|| round_to(edge_delta(&source_luma, &output_luma, gw, gh), 4));
    if edge.is_some_and(|v| v > MAX_EDGE_DELTA) {
        reasons.push(CheckReason::EdgeStructureChanged);
    }
    if input.mode != PreservationMode::Strict && input.allowed.is_none() {
        reasons.push(CheckReason::NoAllowedRegion);
    }
    if input.mode == PreservationMode::Creative {
        reasons.push(CheckReason::CreativeReview);
    }

    EnhanceCheck {
        id: crate::util::new_id(crate::util::prefix::ENHANCE_CHECK),
        version: CHECK_VERSION,
        preservation_mode: input.mode,
        status: if reasons.is_empty() { "pass" } else { "warn" },
        reasons,
        expected_size: expected,
        actual_size: actual,
        content: ContentRect { x: layout.offset_x, y: layout.offset_y, width: layout.width, height: layout.height },
        aspect_delta: round_to(aspect_delta, 5),
        registration: Registration {
            dx: round_to(f64::from(dx) * to_source, 1),
            dy: round_to(f64::from(dy) * to_source, 1),
            shift_px: round_to(grid_shift * to_source, 1),
        },
        locked_ssim: ssim,
        locked_pct,
        edge_delta: edge,
        composited: input.composited,
        size_action: match layout.action {
            SizeAction::Skip => SizeAction::Keep,
            other => other,
        },
    }
}

/// A finished P3 enhance output and its check.
pub struct Finished {
    pub image: RgbaImage,
    pub check: Option<EnhanceCheck>,
}

/// Bring a provider output to the expected layout, restore locked pixels (balanced/creative
/// with an allowed mask) and run the check (when a preservation mode is set).
/// `allowed_mask` rasterizes the allowed regions at a given content size.
pub fn finish_output(
    source: &DynamicImage,
    provider: &DynamicImage,
    params: &EnhanceParams,
    allowed_mask: Option<&dyn Fn(u32, u32) -> Vec<u8>>,
) -> Finished {
    let layout = expected_layout(params, source.width(), source.height());
    let laid_out = provider.width() == layout.canvas_width && provider.height() == layout.canvas_height;
    let (mut content, provider_content) = if laid_out {
        (crop_content(&provider.to_rgba8(), &layout), (layout.width, layout.height))
    } else {
        // A provider may ignore the requested aspect ratio. Contain its pixels instead
        // of squeezing a square image into the source's portrait/landscape rectangle.
        let fitted = provider.resize(layout.width, layout.height, FilterType::Lanczos3).to_rgba8();
        let mut canvas = RgbaImage::from_pixel(layout.width, layout.height, letterbox_fill(source.color().has_alpha()));
        image::imageops::overlay(
            &mut canvas,
            &fitted,
            ((layout.width - fitted.width()) / 2) as i64,
            ((layout.height - fitted.height()) / 2) as i64,
        );
        (canvas, (provider.width(), provider.height()))
    };
    let generative = params.mode == EnhanceMode::Generative
        && matches!(params.preservation_mode, Some(PreservationMode::Balanced | PreservationMode::Creative));
    let mask = if generative { allowed_mask.map(|raster| raster(layout.width, layout.height)) } else { None };
    let mut provider_image = None;
    if let Some(mask) = &mask {
        let source_content = resize_to(source, layout.width, layout.height);
        let composited = composite_locked(&source_content, &content, mask);
        provider_image = Some(std::mem::replace(&mut content, composited));
    }
    let image = place_on_canvas(&content, &layout, letterbox_fill(source.color().has_alpha()));
    let check = params.preservation_mode.map(|mode| {
        compute_check(&CheckInput {
            mode,
            source,
            output: &image,
            layout,
            provider_content,
            provider_image: provider_image.as_ref(),
            allowed: mask.as_deref(),
            composited: mask.is_some(),
        })
    });
    Finished { image, check }
}

#[cfg(test)]
mod tests {
    #[test]
    fn mismatched_api_output_is_contained_instead_of_stretched() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(50, 100, Rgba([0, 0, 0, 255])));
        let provider = DynamicImage::ImageRgba8(RgbaImage::from_pixel(100, 100, Rgba([255, 0, 0, 255])));
        let params = EnhanceParams {
            mode: EnhanceMode::Generative,
            target_long_edge: None,
            detail_strength: 40,
            architecture_preserve: true,
            preservation_mode: Some(PreservationMode::Balanced),
            locks: None,
            allowed_region_ids: None,
            upscale: Some(crate::providers::UpscaleParams {
                target: UpscaleTarget::Custom { width: 50, height: 100, fit: ContainFit::Contain },
                if_already_larger: IfAlreadyLarger::Keep,
            }),
        };
        let result = finish_output(&source, &provider, &params, None);
        assert_eq!(result.image.dimensions(), (50, 100));
        assert_eq!(result.image.get_pixel(25, 10)[3], 0, "padding must not stretch the square to a portrait");
        assert_eq!(*result.image.get_pixel(25, 50), Rgba([255, 0, 0, 255]));
    }
    use super::*;
    use crate::providers::ContainFit;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Vector {
        name: String,
        source: Size,
        target: UpscaleTarget,
        if_already_larger: IfAlreadyLarger,
        expected: Expected,
    }
    #[derive(Deserialize)]
    struct Size {
        width: u32,
        height: u32,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Expected {
        width: u32,
        height: u32,
        canvas_width: u32,
        canvas_height: u32,
        offset_x: u32,
        offset_y: u32,
        letterbox: bool,
        action: SizeAction,
    }

    #[test]
    fn matches_the_domain_upscale_vectors() {
        let vectors: Vec<Vector> =
            serde_json::from_str(include_str!("../../../../packages/domain/test-vectors/upscale.json")).unwrap();
        assert!(!vectors.is_empty());
        for v in vectors {
            let size = resolve_upscale_size(v.source.width, v.source.height, v.target, v.if_already_larger);
            let e = &v.expected;
            assert_eq!(
                (size.width, size.height, size.canvas_width, size.canvas_height, size.offset_x, size.offset_y),
                (e.width, e.height, e.canvas_width, e.canvas_height, e.offset_x, e.offset_y),
                "vector {}",
                v.name
            );
            assert_eq!(size.letterbox(), e.letterbox, "vector {}", v.name);
            assert_eq!(size.action, e.action, "vector {}", v.name);
        }
    }

    #[test]
    fn three_by_two_to_4096_keeps_the_aspect_without_a_crop() {
        let size = resolve_upscale_size(
            3000,
            2000,
            UpscaleTarget::Named(NamedUpscaleTarget::LongEdge4096),
            IfAlreadyLarger::Keep,
        );
        assert_eq!((size.width, size.height), (4096, 2731));
        assert!(!size.letterbox());
        let custom = resolve_upscale_size(
            300,
            200,
            UpscaleTarget::Custom { width: 900, height: 900, fit: ContainFit::Contain },
            IfAlreadyLarger::Keep,
        );
        assert_eq!((custom.width, custom.height, custom.offset_y), (900, 600, 150));
    }

    /// Deterministic synthetic architecture: a gradient sky, a facade with windows, a roof line.
    pub(crate) fn facade(width: u32, height: u32) -> RgbaImage {
        RgbaImage::from_fn(width, height, |x, y| {
            let (fx, fy) = (x as f32 / width as f32, y as f32 / height as f32);
            let mut c = [(120.0 + 80.0 * fy) as u8, (150.0 + 60.0 * fy) as u8, (200.0 - 40.0 * fx) as u8];
            if fy > 0.3 {
                c = [190, 170, 150];
                let wx = (fx * 8.0).fract();
                let wy = (fy * 6.0).fract();
                if wx > 0.25 && wx < 0.75 && wy > 0.3 && wy < 0.8 {
                    c = [40, 60, 90];
                }
            }
            if (fy - 0.3).abs() < 0.02 {
                c = [90, 50, 40];
            }
            Rgba([c[0], c[1], c[2], 255])
        })
    }

    fn check(mode: PreservationMode, source: &RgbaImage, output: &RgbaImage, allowed: Option<&[u8]>) -> EnhanceCheck {
        let source = DynamicImage::ImageRgba8(source.clone());
        compute_check(&CheckInput {
            mode,
            source: &source,
            output,
            layout: UpscaleSize::exact(output.width(), output.height(), SizeAction::Upscale),
            provider_content: output.dimensions(),
            provider_image: None,
            allowed,
            composited: allowed.is_some(),
        })
    }

    #[test]
    fn an_identical_image_passes_every_check() {
        let image = facade(192, 128);
        let result = check(PreservationMode::Strict, &image, &image, None);
        assert_eq!(result.status, "pass", "{result:?}");
        assert!(result.reasons.is_empty());
        assert_eq!(result.registration.shift_px, 0.0);
        assert!(result.locked_ssim.unwrap() > 0.999);
        assert_eq!(result.edge_delta, Some(0.0));
        assert_eq!(result.locked_pct, 100.0);
    }

    #[test]
    fn a_shifted_image_warns_about_registration() {
        let image = facade(192, 128);
        let shifted = RgbaImage::from_fn(192, 128, |x, y| *image.get_pixel(x.saturating_sub(10), y));
        let result = check(PreservationMode::Strict, &image, &shifted, None);
        assert_eq!(result.status, "warn");
        assert!(result.reasons.contains(&CheckReason::RegistrationShift), "{result:?}");
        assert!(result.registration.dx > 5.0, "{result:?}");
    }

    #[test]
    fn a_changed_locked_region_warns_and_new_structure_is_flagged_in_strict() {
        let image = facade(192, 128);
        let mut changed = image.clone();
        for y in 70..120 {
            for x in 20..90 {
                changed.put_pixel(x, y, Rgba([250, 20, 20, 255]));
            }
        }
        // Balanced: only the right half is allowed; the change is in the locked left half.
        let allowed: Vec<u8> = (0..128).flat_map(|_| (0..192).map(|x| if x >= 96 { 255 } else { 0 })).collect();
        let result = check(PreservationMode::Balanced, &image, &changed, Some(&allowed));
        assert!(result.reasons.contains(&CheckReason::LockedSsimLow), "{result:?}");
        assert!((result.locked_pct - 50.0).abs() < 1.0, "{result:?}");
        assert_eq!(result.edge_delta, None);
        let strict = check(PreservationMode::Strict, &image, &changed, None);
        assert!(strict.reasons.contains(&CheckReason::EdgeStructureChanged), "{strict:?}");
        // The same change inside the allowed half keeps the locked pixels intact.
        let mut inside = image.clone();
        for y in 70..120 {
            for x in 110..180 {
                inside.put_pixel(x, y, Rgba([250, 20, 20, 255]));
            }
        }
        let ok = check(PreservationMode::Balanced, &image, &inside, Some(&allowed));
        assert!(!ok.reasons.contains(&CheckReason::LockedSsimLow), "{ok:?}");
        assert_eq!(ok.status, "pass", "{ok:?}");
    }

    #[test]
    fn modes_without_a_mask_or_creative_always_ask_for_review() {
        let image = facade(64, 48);
        let balanced = check(PreservationMode::Balanced, &image, &image, None);
        assert_eq!(balanced.reasons, vec![CheckReason::NoAllowedRegion]);
        assert_eq!(balanced.locked_ssim, None);
        let creative = check(PreservationMode::Creative, &image, &image, None);
        assert!(creative.reasons.contains(&CheckReason::CreativeReview));
        assert_eq!(creative.status, "warn");
    }

    #[test]
    fn a_wrong_size_or_aspect_warns() {
        let image = facade(90, 60);
        let source = DynamicImage::ImageRgba8(image.clone());
        let output = DynamicImage::ImageRgba8(image.clone()).resize_exact(90, 90, FilterType::Triangle).to_rgba8();
        let result = compute_check(&CheckInput {
            mode: PreservationMode::Strict,
            source: &source,
            output: &output,
            layout: UpscaleSize::exact(90, 60, SizeAction::Upscale),
            provider_content: (90, 90),
            provider_image: None,
            allowed: None,
            composited: false,
        });
        assert!(result.reasons.contains(&CheckReason::SizeMismatch));
        assert!(result.reasons.contains(&CheckReason::AspectChanged));
    }

    #[test]
    fn compositing_restores_every_locked_pixel_exactly() {
        let source = DynamicImage::ImageRgba8(facade(60, 40));
        let generated = DynamicImage::ImageRgba8(RgbaImage::from_pixel(120, 80, Rgba([255, 0, 255, 255])));
        let params = EnhanceParams {
            mode: EnhanceMode::Generative,
            target_long_edge: None,
            detail_strength: 40,
            architecture_preserve: true,
            preservation_mode: Some(PreservationMode::Balanced),
            locks: None,
            allowed_region_ids: Some(vec!["RGN_1".into()]),
            upscale: Some(crate::providers::UpscaleParams {
                target: UpscaleTarget::Custom { width: 120, height: 80, fit: ContainFit::Contain },
                if_already_larger: IfAlreadyLarger::Keep,
            }),
        };
        let raster = |w: u32, h: u32| -> Vec<u8> {
            (0..h).flat_map(|_| (0..w).map(move |x| if x >= w / 2 { 255 } else { 0 })).collect()
        };
        let finished = finish_output(&source, &generated, &params, Some(&raster));
        let expected = source.resize_exact(120, 80, FilterType::Lanczos3).to_rgba8();
        for (x, y, pixel) in finished.image.enumerate_pixels() {
            if x < 60 {
                assert_eq!(pixel, expected.get_pixel(x, y), "locked pixel {x},{y}");
            }
        }
        assert_eq!(*finished.image.get_pixel(110, 40), Rgba([255, 0, 255, 255]));
        let check = finished.check.unwrap();
        assert!(check.composited);
        assert!(check.locked_ssim.unwrap() >= MIN_LOCKED_SSIM, "{check:?}");
        assert!(!check.reasons.contains(&CheckReason::LockedSsimLow), "{check:?}");
    }

    #[test]
    fn uhd_contain_letterboxes_a_generative_output_and_keeps_alpha() {
        let source = DynamicImage::ImageRgba8(RgbaImage::from_pixel(30, 20, Rgba([10, 200, 30, 90])));
        let provider = DynamicImage::ImageRgba8(RgbaImage::from_pixel(60, 40, Rgba([10, 200, 30, 90])));
        let params = EnhanceParams {
            mode: EnhanceMode::Generative,
            target_long_edge: None,
            detail_strength: 40,
            architecture_preserve: true,
            preservation_mode: Some(PreservationMode::Balanced),
            locks: None,
            allowed_region_ids: None,
            upscale: Some(crate::providers::UpscaleParams {
                target: UpscaleTarget::Custom { width: 96, height: 54, fit: ContainFit::Contain },
                if_already_larger: IfAlreadyLarger::Keep,
            }),
        };
        let finished = finish_output(&source, &provider, &params, None);
        assert_eq!(finished.image.dimensions(), (96, 54));
        assert_eq!(*finished.image.get_pixel(0, 27), Rgba([0, 0, 0, 0]), "letterbox is transparent");
        assert_eq!(finished.image.get_pixel(48, 27)[3], 90, "alpha is kept");
        let check = finished.check.unwrap();
        assert_eq!(check.content, ContentRect { x: 7, y: 0, width: 81, height: 54 });
        assert!(!check.reasons.contains(&CheckReason::SizeMismatch));
    }
}
