use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use arch_ai_studio_lib::services::grade::ColorGrade;
use arch_ai_studio_lib::services::grade_engine;
use image::codecs::jpeg::JpegEncoder;
use image::{DynamicImage, ImageBuffer, Rgba, RgbaImage};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
struct Metrics {
    mean_luminance: f64,
    mean_saturation: f64,
    mean_r_minus_b: f64,
    rms_contrast: f64,
    green_hue_mean: f64,
    green_saturation_mean: f64,
    sky_hue_mean: f64,
    p5_luminance: f64,
    p99_luminance: f64,
    clipped_fraction: f64,
}

fn save_jpeg(image: &RgbaImage, path: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let file = fs::File::create(path)?;
    let mut encoder = JpegEncoder::new_with_quality(file, 92);
    encoder.encode_image(&DynamicImage::ImageRgba8(image.clone()))?;
    Ok(())
}

fn scaled_to_max(image: DynamicImage, max_edge: u32) -> DynamicImage {
    let longest = image.width().max(image.height());
    if longest <= max_edge {
        image
    } else {
        let scale = max_edge as f32 / longest as f32;
        let width = (image.width() as f32 * scale).round().max(1.0) as u32;
        let height = (image.height() as f32 * scale).round().max(1.0) as u32;
        image.resize(width, height, image::imageops::FilterType::Lanczos3)
    }
}

fn metrics(image: &RgbaImage) -> Metrics {
    let mut luminances = Vec::with_capacity((image.width() * image.height()) as usize);
    let mut saturation_sum = 0.0;
    let mut warmth_sum = 0.0;
    let mut green_hue_sum = 0.0;
    let mut green_saturation_sum = 0.0;
    let mut green_count = 0_u64;
    let mut sky_hue_sum = 0.0;
    let mut sky_count = 0_u64;
    let mut clipped_count = 0_u64;
    let sky_rows = ((image.height() as f64) * 0.20).ceil() as u32;

    for (_, y, pixel) in image.enumerate_pixels() {
        let [r, g, b, _] = pixel.0.map(|value| f64::from(value) / 255.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let chroma = max - min;
        let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        luminances.push(luminance);
        let saturation = if max == 0.0 { 0.0 } else { chroma / max };
        saturation_sum += saturation;
        warmth_sum += r - b;
        clipped_count += u64::from(max >= 250.0 / 255.0);

        if chroma > 0.0 {
            let mut hue = if chroma == 0.0 {
                0.0
            } else if (max - r).abs() < f64::EPSILON {
                60.0 * ((g - b) / chroma).rem_euclid(6.0)
            } else if (max - g).abs() < f64::EPSILON {
                60.0 * ((b - r) / chroma + 2.0)
            } else {
                60.0 * ((r - g) / chroma + 4.0)
            };
            if hue < 0.0 {
                hue += 360.0;
            }
            if (70.0..=170.0).contains(&hue) && saturation > 0.15 {
                green_hue_sum += hue;
                green_saturation_sum += saturation;
                green_count += 1;
            }
            if y < sky_rows && (180.0..=260.0).contains(&hue) && saturation > 0.08 {
                sky_hue_sum += hue;
                sky_count += 1;
            }
        }
    }

    let count = luminances.len() as f64;
    let mean_luminance = luminances.iter().sum::<f64>() / count;
    let rms_contrast = (luminances.iter().map(|value| (value - mean_luminance).powi(2)).sum::<f64>() / count).sqrt();
    luminances.sort_by(f64::total_cmp);

    Metrics {
        mean_luminance,
        mean_saturation: saturation_sum / count,
        mean_r_minus_b: warmth_sum / count,
        rms_contrast,
        green_hue_mean: if green_count == 0 { 0.0 } else { green_hue_sum / green_count as f64 },
        green_saturation_mean: if green_count == 0 { 0.0 } else { green_saturation_sum / green_count as f64 },
        sky_hue_mean: if sky_count == 0 { 0.0 } else { sky_hue_sum / sky_count as f64 },
        p5_luminance: luminances[((luminances.len() - 1) as f64 * 0.05).round() as usize],
        p99_luminance: luminances[((luminances.len() - 1) as f64 * 0.99).round() as usize],
        clipped_fraction: clipped_count as f64 / count,
    }
}

fn neutral_grade() -> ColorGrade {
    ColorGrade {
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
        texture: None,
        vignette: None,
        grain: None,
        split_tone: None,
        tone_curve: None,
        lut: None,
        look: None,
    }
}

fn contact_sheet(images: &[(String, RgbaImage)]) -> RgbaImage {
    let columns = 3_u32;
    let thumb_width = images[0].1.width().min(600);
    let thumb_height = (images[0].1.height() as f64 * thumb_width as f64 / images[0].1.width() as f64).round() as u32;
    let rows = (images.len() as u32).div_ceil(columns);
    let mut sheet = ImageBuffer::from_pixel(thumb_width * columns, thumb_height * rows, Rgba([245, 245, 245, 255]));

    for (index, (_, image)) in images.iter().enumerate() {
        let thumb = DynamicImage::ImageRgba8(image.clone())
            .resize(thumb_width, thumb_height, image::imageops::FilterType::Lanczos3)
            .to_rgba8();
        let x = (index as u32 % columns) * thumb_width + (thumb_width - thumb.width()) / 2;
        let y = (index as u32 / columns) * thumb_height + (thumb_height - thumb.height()) / 2;
        image::imageops::overlay(&mut sheet, &thumb, i64::from(x), i64::from(y));
    }
    sheet
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        return Err("usage: grade_tuning <input.jpg> <output-dir> <presets.json>".into());
    }

    let input_path = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]);
    let presets_path = PathBuf::from(&args[3]);
    fs::create_dir_all(&output_dir)?;

    let source = scaled_to_max(image::open(input_path)?, 1280).to_rgba8();
    let neutral = grade_engine::render(&DynamicImage::ImageRgba8(source.clone()), &neutral_grade());
    save_jpeg(&neutral, &output_dir.join("neutral.jpg"))?;

    let preset_json = fs::read_to_string(presets_path)?;
    let presets: BTreeMap<String, ColorGrade> = serde_json::from_str(&preset_json)?;
    let mut rendered = vec![("neutral".to_string(), neutral.clone())];
    let mut outputs = BTreeMap::new();
    for (preset_id, grade) in presets {
        let output = grade_engine::render(&DynamicImage::ImageRgba8(source.clone()), &grade);
        save_jpeg(&output, &output_dir.join(format!("{preset_id}.jpg")))?;
        outputs.insert(preset_id, output);
    }
    for preset_id in ["earthy_muted", "heritage_warmth", "clean_editorial", "tropical_forest", "concrete_steel"] {
        rendered
            .push((preset_id.to_string(), outputs.remove(preset_id).ok_or(format!("missing preset: {preset_id}"))?));
    }

    save_jpeg(&contact_sheet(&rendered), &output_dir.join("sheet.jpg"))?;

    let neutral_metrics = metrics(&neutral);
    println!("preset,dL,dSat,dWarm,dContrast,dP5,dP99,dClip,skyHue,greenHue,greenSat,PASS/FAIL");
    for (preset_id, image) in &rendered {
        let values = metrics(image);
        let dl = values.mean_luminance - neutral_metrics.mean_luminance;
        let dsat = values.mean_saturation - neutral_metrics.mean_saturation;
        let dwarm = values.mean_r_minus_b - neutral_metrics.mean_r_minus_b;
        let dcontrast = values.rms_contrast - neutral_metrics.rms_contrast;
        let dp5 = values.p5_luminance - neutral_metrics.p5_luminance;
        let dp99 = values.p99_luminance - neutral_metrics.p99_luminance;
        let dclip = values.clipped_fraction - neutral_metrics.clipped_fraction;
        let sky_hue = values.sky_hue_mean - neutral_metrics.sky_hue_mean;
        let green_hue = values.green_hue_mean - neutral_metrics.green_hue_mean;
        let green_sat = values.green_saturation_mean - neutral_metrics.green_saturation_mean;
        let sky_limit = if preset_id == "tropical_forest" { 6.0 } else { 4.0 };
        let passes = match preset_id.as_str() {
            "earthy_muted" => {
                (-0.10..=-0.06).contains(&dsat)
                    && (0.010..=0.030).contains(&dwarm)
                    && dp5 >= 0.015
                    && dcontrast <= -0.01
            }
            "heritage_warmth" => {
                (0.040..=0.070).contains(&dwarm)
                    && (0.030..=0.060).contains(&dcontrast)
                    && (0.015..=0.050).contains(&dsat)
            }
            "clean_editorial" => {
                (0.030..=0.055).contains(&dl) && dwarm.abs() <= 0.006 && dsat.abs() <= 0.012 && dcontrast >= -0.04
            }
            "tropical_forest" => {
                (5.0..=12.0).contains(&green_hue)
                    && (-0.07..=-0.03).contains(&green_sat)
                    && (-0.040..=-0.015).contains(&dcontrast)
            }
            "concrete_steel" => {
                (0.035..=0.070).contains(&dcontrast)
                    && (-0.040..=-0.020).contains(&dwarm)
                    && (-0.050..=-0.020).contains(&dsat)
            }
            _ => true,
        } && dclip <= 0.010
            && sky_hue.abs() <= sky_limit;
        println!(
            "{preset_id},{dl:+.5},{dsat:+.5},{dwarm:+.5},{dcontrast:+.5},{dp5:+.5},{dp99:+.5},{dclip:+.5},{sky_hue:+.2},{green_hue:+.2},{green_sat:+.5},{}",
            if passes { "PASS" } else { "FAIL" },
        );
    }
    Ok(())
}
