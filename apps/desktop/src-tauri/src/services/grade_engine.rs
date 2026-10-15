//! The sole adapter between the grade service and LightCraft.

use image::{DynamicImage, RgbaImage};
use lightcraft_color::{REC2020, SRGB};
use lightcraft_develop::{controls, DevelopSettings, WbMode, Wheel};
use lightcraft_geom::Point;
use lightcraft_pipeline::{render as render_lightcraft, RenderRequest, SourceInfo};
use lightcraft_raster::Rgb32f;

use super::grade::{ColorGrade, ToneCurve};

#[derive(Debug, Clone, PartialEq)]
pub struct CubeLut {
    size: usize,
    domain_min: [f32; 3],
    domain_max: [f32; 3],
    values: Vec<[f32; 3]>,
}

impl CubeLut {
    pub fn size(&self) -> usize {
        self.size
    }

    pub fn parse(text: &str) -> Result<Self, String> {
        let mut size = None;
        let mut domain_min = [0.0; 3];
        let mut domain_max = [1.0; 3];
        let mut values = Vec::new();
        for raw in text.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let key = parts.next().unwrap();
            if key == "TITLE" {
                continue;
            }
            let mut numbers: Vec<f32> = parts
                .map(|part| part.parse::<f32>().map_err(|_| format!("invalid number: {part}")))
                .collect::<Result<_, _>>()?;
            if let Ok(first) = key.parse::<f32>() {
                numbers.insert(0, first);
            }
            match key {
                "LUT_3D_SIZE" => {
                    if numbers.len() != 1 || numbers[0] < 2.0 || numbers[0] > 65.0 || numbers[0].fract() != 0.0 {
                        return Err("LUT_3D_SIZE must be an integer between 2 and 65".into());
                    }
                    size = Some(numbers[0] as usize);
                }
                "DOMAIN_MIN" | "DOMAIN_MAX" => {
                    if numbers.len() != 3 || numbers.iter().any(|value| !value.is_finite()) {
                        return Err(format!("{key} requires three finite values"));
                    }
                    let target = if key == "DOMAIN_MIN" { &mut domain_min } else { &mut domain_max };
                    target.copy_from_slice(&[numbers[0], numbers[1], numbers[2]]);
                }
                _ => {
                    if numbers.len() != 3 || numbers.iter().any(|value| !value.is_finite()) {
                        return Err("LUT data must contain three finite values per row".into());
                    }
                    values.push([numbers[0], numbers[1], numbers[2]]);
                }
            }
        }
        let size = size.ok_or("missing LUT_3D_SIZE")?;
        if domain_min.iter().zip(domain_max).any(|(min, max)| *min >= max) {
            return Err("DOMAIN_MIN must be less than DOMAIN_MAX".into());
        }
        let expected = size * size * size;
        if values.len() != expected {
            return Err(format!("expected {expected} LUT rows, got {}", values.len()));
        }
        Ok(Self { size, domain_min, domain_max, values })
    }

    pub fn apply(&self, rgb: [f32; 3], strength: f32) -> [f32; 3] {
        let mut point = [0.0; 3];
        for channel in 0..3 {
            point[channel] = ((rgb[channel] - self.domain_min[channel])
                / (self.domain_max[channel] - self.domain_min[channel]))
                .clamp(0.0, 1.0)
                * (self.size - 1) as f32;
        }
        let base = point.map(|value| value.floor() as usize);
        let next = base.map(|value| (value + 1).min(self.size - 1));
        let fraction = point.map(f32::fract);
        let mut mapped = [0.0; 3];
        for z in 0..2 {
            for y in 0..2 {
                for x in 0..2 {
                    let wx = if x == 0 { 1.0 - fraction[0] } else { fraction[0] };
                    let wy = if y == 0 { 1.0 - fraction[1] } else { fraction[1] };
                    let wz = if z == 0 { 1.0 - fraction[2] } else { fraction[2] };
                    let index = (if z == 0 { base[2] } else { next[2] }) * self.size * self.size
                        + (if y == 0 { base[1] } else { next[1] }) * self.size
                        + if x == 0 { base[0] } else { next[0] };
                    for (channel, value) in mapped.iter_mut().enumerate() {
                        *value += self.values[index][channel] * wx * wy * wz;
                    }
                }
            }
        }
        let amount = strength.clamp(0.0, 1.0);
        if amount == 0.0 || mapped.iter().zip(rgb).all(|(mapped, input)| (*mapped - input).abs() < 1e-6) {
            return rgb;
        }
        [0, 1, 2].map(|channel| {
            let value = rgb[channel].clamp(0.0, 1.0);
            (value + (mapped[channel] - value) * amount).clamp(0.0, 1.0)
        })
    }
}

pub fn settings(grade: &ColorGrade) -> DevelopSettings {
    let mut settings = DevelopSettings::default();
    for (id, value) in [
        ("light.exposure", grade.exposure),
        ("light.contrast", grade.contrast),
        ("light.highlights", grade.highlights),
        ("light.shadows", grade.shadows),
        ("light.whites", grade.whites),
        ("light.blacks", grade.blacks),
        ("color.tint", grade.tint),
        ("color.vibrance", grade.vibrance),
        ("color.saturation", grade.saturation),
        ("effects.texture", grade.texture.unwrap_or(0.0)),
        ("effects.clarity", grade.clarity),
        ("effects.dehaze", grade.dehaze),
        ("vignette.amount", -grade.vignette.unwrap_or(0.0)),
        ("grain.amount", grade.grain.unwrap_or(0.0)),
    ] {
        let _ = controls::set(&mut settings, id, value as f64);
    }
    if grade.temperature != 0.0 {
        settings.wb.mode = WbMode::Custom;
        settings.wb.temp = 6500.0 + grade.temperature as f64 * 20.0;
    }
    if let Some(split_tone) = &grade.split_tone {
        settings.grading.shadows =
            Wheel { hue: split_tone.shadows_hue as f64, sat: split_tone.shadows_sat as f64, lum: 0.0 };
        settings.grading.highlights =
            Wheel { hue: split_tone.highlights_hue as f64, sat: split_tone.highlights_sat as f64, lum: 0.0 };
        settings.grading.balance = split_tone.balance as f64;
    }
    if let Some(curve) = &grade.tone_curve {
        settings.curve.master = match curve {
            ToneCurve::None => Vec::new(),
            ToneCurve::SoftS => {
                vec![Point::new(0.0, 0.0), Point::new(0.25, 0.20), Point::new(0.75, 0.80), Point::new(1.0, 1.0)]
            }
            ToneCurve::StrongS => {
                vec![Point::new(0.0, 0.0), Point::new(0.25, 0.12), Point::new(0.75, 0.88), Point::new(1.0, 1.0)]
            }
            ToneCurve::Faded => {
                vec![Point::new(0.0, 0.08), Point::new(0.25, 0.28), Point::new(0.75, 0.78), Point::new(1.0, 0.94)]
            }
            ToneCurve::Matte => vec![Point::new(0.0, 0.08), Point::new(0.5, 0.50), Point::new(1.0, 0.92)],
        };
    }
    settings
}

fn uses_v2(grade: &ColorGrade) -> bool {
    grade.texture.is_some()
        || grade.vignette.is_some()
        || grade.grain.is_some()
        || grade.split_tone.is_some()
        || grade.tone_curve.is_some()
        || grade.lut.is_some()
}

fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn to_linear_rec2020(image: &DynamicImage) -> Rgb32f {
    let rgb = image.to_rgb8();
    let matrix = SRGB.to_space(&REC2020);
    Rgb32f::from_fn(rgb.width() as usize, rgb.height() as usize, |x, y| {
        let pixel = rgb.get_pixel(x as u32, y as u32).0;
        let linear = pixel.map(|value| srgb_to_linear(value as f32 / 255.0));
        matrix.apply_f32(linear)
    })
}

fn render_v1(image: &DynamicImage, grade: &ColorGrade) -> RgbaImage {
    let mut output = image.to_rgba8();
    for pixel in output.pixels_mut() {
        let alpha = pixel[3];
        let rgb =
            super::grade::grade_rgb([pixel[0] as f32 / 255.0, pixel[1] as f32 / 255.0, pixel[2] as f32 / 255.0], grade);
        pixel[0] = (rgb[0] * 255.0).round() as u8;
        pixel[1] = (rgb[1] * 255.0).round() as u8;
        pixel[2] = (rgb[2] * 255.0).round() as u8;
        pixel[3] = alpha;
    }
    output
}

fn render_with_lightcraft(image: &DynamicImage, grade: &ColorGrade) -> RgbaImage {
    let source = to_linear_rec2020(image);
    let info = SourceInfo { relative_wb: true, ..SourceInfo::default() };
    let rendered = render_lightcraft(
        &source,
        &info,
        &settings(grade),
        &RenderRequest::fit(image.width() as usize, image.height() as usize),
    );
    let bytes: Vec<u8> = rendered.image.data.iter().flat_map(|pixel| pixel.iter().copied()).collect();
    let mut output = RgbaImage::from_raw(rendered.image.width as u32, rendered.image.height as u32, bytes)
        .expect("LightCraft returned a malformed RGBA buffer");
    for (output_pixel, source_pixel) in output.pixels_mut().zip(image.to_rgba8().pixels()) {
        output_pixel[3] = source_pixel[3];
    }
    output
}

pub fn render(image: &DynamicImage, grade: &ColorGrade) -> RgbaImage {
    render_with_lut(image, grade, None)
}

pub fn render_with_lut(image: &DynamicImage, grade: &ColorGrade, lut: Option<&CubeLut>) -> RgbaImage {
    let mut output = if uses_v2(grade) { render_with_lightcraft(image, grade) } else { render_v1(image, grade) };
    if let Some(lut) = lut {
        let strength = grade.lut.as_ref().map_or(1.0, |value| value.strength / 100.0);
        for pixel in output.pixels_mut() {
            let alpha = pixel[3];
            let rgb = lut.apply([pixel[0] as f32 / 255.0, pixel[1] as f32 / 255.0, pixel[2] as f32 / 255.0], strength);
            pixel[0] = (rgb[0] * 255.0).round() as u8;
            pixel[1] = (rgb[1] * 255.0).round() as u8;
            pixel[2] = (rgb[2] * 255.0).round() as u8;
            pixel[3] = alpha;
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgba;

    fn identity(size: usize) -> String {
        let mut text = format!("LUT_3D_SIZE {size}\n");
        for blue in 0..size {
            for green in 0..size {
                for red in 0..size {
                    let divisor = (size - 1) as f32;
                    text.push_str(&format!(
                        "{} {} {}\n",
                        red as f32 / divisor,
                        green as f32 / divisor,
                        blue as f32 / divisor
                    ));
                }
            }
        }
        text
    }

    fn neutral() -> ColorGrade {
        serde_json::from_value(serde_json::json!({ "schemaVersion": 1 })).unwrap()
    }

    #[test]
    fn identity_lut_is_noop() {
        let lut = CubeLut::parse(&identity(2)).unwrap();
        assert_eq!(lut.apply([0.2, 0.4, 0.8], 1.0), [0.2, 0.4, 0.8]);
    }

    #[test]
    fn parses_comments_and_domain() {
        let text = format!(
            "LUT_3D_SIZE 2\nTITLE identity # comment\nDOMAIN_MIN 0.1 0.2 0.3\nDOMAIN_MAX 1 1 1\n{}",
            identity(2).lines().skip(1).collect::<Vec<_>>().join("\n")
        );
        let lut = CubeLut::parse(&text).unwrap();
        assert_eq!(lut.domain_min, [0.1, 0.2, 0.3]);
        assert_eq!(lut.domain_max, [1.0, 1.0, 1.0]);
    }

    #[test]
    fn parse_errors_are_reported() {
        assert!(CubeLut::parse("LUT_3D_SIZE 66").is_err());
        assert!(CubeLut::parse("LUT_3D_SIZE 2\n0 0 0").is_err());
    }

    #[test]
    fn maps_v2_controls_to_lightcraft() {
        let grade: ColorGrade = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "texture": 25,
            "vignette": 40,
            "grain": 15,
            "splitTone": {
                "shadowsHue": 210,
                "shadowsSat": 30,
                "highlightsHue": 35,
                "highlightsSat": 20,
                "balance": -10
            },
            "toneCurve": "soft_s"
        }))
        .unwrap();
        let mapped = settings(&grade);
        assert_eq!(mapped.effects.texture, 25.0);
        assert_eq!(mapped.vignette.amount, -40.0);
        assert_eq!(mapped.grain.amount, 15.0);
        assert_eq!(mapped.grading.shadows.hue, 210.0);
        assert_eq!(mapped.grading.highlights.sat, 20.0);
        assert_eq!(mapped.grading.balance, -10.0);
        assert_eq!(mapped.curve.master.len(), 4);
    }
    #[test]
    fn v1_render_keeps_old_pixel_math() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(1, 1, Rgba([80, 120, 160, 255])));
        let grade = ColorGrade { exposure: 20.0, contrast: -10.0, temperature: 15.0, saturation: 12.0, ..neutral() };
        assert_eq!(render(&image, &grade), super::render_v1(&image, &grade));
    }

    #[test]
    fn neutral_grade_is_near_identity() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(2, 2, Rgba([80, 120, 160, 255])));
        let output = render(&image, &neutral());
        let error: f32 = output
            .pixels()
            .zip(image.to_rgba8().pixels())
            .map(|(a, b)| {
                a.0[..3].iter().zip(&b.0[..3]).map(|(x, y)| (*x as f32 - *y as f32).abs() / 255.0).sum::<f32>()
            })
            .sum::<f32>()
            / 12.0;
        assert!(error <= 1.0 / 255.0, "mean absolute error was {error}");
    }

    #[test]
    fn lut_strength_blends() {
        let lut = CubeLut::parse("LUT_3D_SIZE 2\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n").unwrap();
        assert_eq!(lut.apply([0.2, 0.4, 0.8], 0.0), [0.2, 0.4, 0.8]);
        assert_eq!(lut.apply([0.2, 0.4, 0.8], 1.0), [1.0, 1.0, 1.0]);
    }
}
