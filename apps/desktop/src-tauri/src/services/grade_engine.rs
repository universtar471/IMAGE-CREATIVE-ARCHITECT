//! The sole adapter between the grade service and LightCraft.

use image::{DynamicImage, RgbaImage};
use lightcraft_develop::{controls, DevelopSettings, WbMode};

use super::grade::ColorGrade;

#[derive(Debug, Clone, PartialEq)]
pub struct CubeLut {
    size: usize,
    domain_min: [f32; 3],
    domain_max: [f32; 3],
    values: Vec<[f32; 3]>,
}

impl CubeLut {
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
                    if numbers.len() != 3 {
                        return Err(format!("{key} requires three values"));
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
        if mapped.iter().zip(rgb).all(|(mapped, input)| (*mapped - input).abs() < 1e-6) {
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
        ("effects.clarity", grade.clarity),
        ("effects.dehaze", grade.dehaze),
    ] {
        let _ = controls::set(&mut settings, id, value as f64);
    }
    if grade.temperature != 0.0 {
        settings.wb.mode = WbMode::Custom;
        settings.wb.temp = 6500.0 + grade.temperature as f64 * 20.0;
    }
    settings
}

pub fn render(image: &DynamicImage, grade: &ColorGrade) -> RgbaImage {
    let _lightcraft_settings = settings(grade);
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

    #[test]
    fn identity_lut_is_noop() {
        let lut = CubeLut::parse(&identity(2)).unwrap();
        assert_eq!(lut.apply([0.2, 0.4, 0.8], 1.0), [0.2, 0.4, 0.8]);
    }

    #[test]
    fn parse_errors_are_reported() {
        assert!(CubeLut::parse("LUT_3D_SIZE 66").is_err());
        assert!(CubeLut::parse("LUT_3D_SIZE 2\n0 0 0").is_err());
    }

    #[test]
    fn neutral_grade_is_near_identity() {
        let image = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(2, 2, Rgba([80, 120, 160, 255])));
        let grade = ColorGrade {
            schema_version: 1,
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            temperature: 0.0,
            tint: 0.0,
            vibrance: 0.0,
            saturation: 0.0,
            clarity: 0.0,
            dehaze: 0.0,
            look: None,
        };
        let output = render(&image, &grade);
        let error: u32 = output
            .pixels()
            .zip(image.to_rgba8().pixels())
            .map(|(a, b)| a.0.iter().zip(b.0).map(|(x, y)| (*x as i32 - y as i32).unsigned_abs()).sum::<u32>())
            .sum();
        assert!(error <= 16);
    }
}
