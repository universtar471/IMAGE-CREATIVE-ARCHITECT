use std::env;
use std::error::Error;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use image::{DynamicImage, ImageFormat, RgbaImage};
use lightcraft_color::{REC2020, SRGB};
use lightcraft_develop::{controls, DevelopSettings, Preset, SettingsGroup, WbMode, Wheel};
use lightcraft_geom::Point;
use lightcraft_pipeline::{render, RenderRequest, SourceInfo};
use lightcraft_raster::Rgb32f;
use serde::Serialize;

const PREVIEW_EDGE: usize = 512;

#[derive(Clone, Copy)]
struct DemoPreset {
    name: &'static str,
    settings: fn() -> DevelopSettings,
    ours: ColorGrade,
}

#[derive(Clone, Copy)]
struct ColorGrade {
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    whites: f32,
    blacks: f32,
    temperature: f32,
    tint: f32,
    vibrance: f32,
    saturation: f32,
    clarity: f32,
    dehaze: f32,
}

impl ColorGrade {
    const fn neutral() -> Self {
        Self {
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
        }
    }
}

#[derive(Serialize)]
struct Report {
    input: String,
    width: u32,
    height: u32,
    presets: Vec<PresetReport>,
}

#[derive(Serialize)]
struct PresetReport {
    preset: String,
    output: String,
    full_size_ms: f64,
    preview_512_ms: f64,
    rendered_width: usize,
    rendered_height: usize,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut args = env::args_os().skip(1);
    let input = args
        .next()
        .map(PathBuf::from)
        .ok_or("usage: lightcraft-spike <input.jpg|png> <out_dir>")?;
    let out_dir = args
        .next()
        .map(PathBuf::from)
        .ok_or("usage: lightcraft-spike <input.jpg|png> <out_dir>")?;
    if args.next().is_some() {
        return Err("usage: lightcraft-spike <input.jpg|png> <out_dir>".into());
    }
    fs::create_dir_all(&out_dir)?;

    let source = image::open(&input)?;
    let (width, height) = (source.width(), source.height());
    let pixels = to_linear_rec2020(&source);
    let info = SourceInfo {
        relative_wb: true,
        ..SourceInfo::default()
    };

    let presets = demo_presets();
    let mut results = Vec::with_capacity(presets.len());
    for preset in presets {
        let settings = (preset.settings)();
        let actual_preset = Preset::from_settings(
            preset.name,
            preset.name,
            "Spike",
            &settings,
            &[
                SettingsGroup::WhiteBalance,
                SettingsGroup::Light,
                SettingsGroup::ToneCurve,
                SettingsGroup::Color,
                SettingsGroup::ColorGrading,
                SettingsGroup::Effects,
                SettingsGroup::Vignette,
                SettingsGroup::Grain,
            ],
        );
        let settings = actual_preset.apply(&DevelopSettings::default(), 1.0);

        let full_started = Instant::now();
        let full = render(
            &pixels,
            &info,
            &settings,
            &RenderRequest::fit(width as usize, height as usize),
        );
        let full_size_ms = elapsed_ms(full_started);
        let filename = format!("lightcraft_{}.jpg", preset.name);
        save_lightcraft_jpeg(&full.image, &out_dir.join(&filename))?;

        let preview_started = Instant::now();
        let preview = render(
            &pixels,
            &info,
            &settings,
            &RenderRequest::fit(PREVIEW_EDGE, PREVIEW_EDGE),
        );
        let preview_512_ms = elapsed_ms(preview_started);

        let ours = apply_ours(&source, preset.ours);
        DynamicImage::ImageRgba8(ours)
            .save_with_format(out_dir.join(format!("ours_{}.jpg", preset.name)), ImageFormat::Jpeg)?;

        println!(
            "{}: full {:.1} ms ({}x{}), 512 preview {:.1} ms ({}x{})",
            preset.name,
            full_size_ms,
            full.image.width,
            full.image.height,
            preview_512_ms,
            preview.image.width,
            preview.image.height
        );
        results.push(PresetReport {
            preset: preset.name.into(),
            output: filename,
            full_size_ms,
            preview_512_ms,
            rendered_width: full.image.width,
            rendered_height: full.image.height,
        });
    }

    let report = Report {
        input: input.display().to_string(),
        width,
        height,
        presets: results,
    };
    fs::write(
        out_dir.join("report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    Ok(())
}

fn elapsed_ms(started: Instant) -> f64 {
    started.elapsed().as_secs_f64() * 1000.0
}

fn to_linear_rec2020(image: &DynamicImage) -> Rgb32f {
    let rgb = image.to_rgb8();
    let matrix = SRGB.to_space(&REC2020);
    Rgb32f::from_fn(rgb.width() as usize, rgb.height() as usize, |x, y| {
        let p = rgb.get_pixel(x as u32, y as u32).0;
        let linear = p.map(|v| {
            let value = v as f32 / 255.0;
            if value <= 0.04045 {
                value / 12.92
            } else {
                ((value + 0.055) / 1.055).powf(2.4)
            }
        });
        matrix.apply_f32(linear)
    })
}

fn save_lightcraft_jpeg(image: &lightcraft_raster::Rgba8, path: &Path) -> Result<(), Box<dyn Error>> {
    let bytes = image
        .data
        .iter()
        .flat_map(|pixel| pixel.iter().copied())
        .collect();
    let rgba = RgbaImage::from_raw(image.width as u32, image.height as u32, bytes)
        .ok_or("LightCraft returned a malformed RGBA buffer")?;
    DynamicImage::ImageRgba8(rgba).save_with_format(path, ImageFormat::Jpeg)?;
    Ok(())
}

fn set(settings: &mut DevelopSettings, id: &str, value: f64) {
    let _ = controls::set(settings, id, value);
}

fn demo_presets() -> [DemoPreset; 6] {
    [
        DemoPreset {
            name: "neutral",
            settings: neutral,
            ours: ColorGrade::neutral(),
        },
        DemoPreset {
            name: "arch_clean",
            settings: arch_clean,
            ours: ColorGrade {
                highlights: -40.0,
                shadows: 30.0,
                whites: 10.0,
                blacks: -10.0,
                clarity: 15.0,
                dehaze: 10.0,
                vibrance: 15.0,
                ..ColorGrade::neutral()
            },
        },
        DemoPreset {
            name: "warm_dusk",
            settings: warm_dusk,
            ours: ColorGrade {
                highlights: -30.0,
                temperature: 40.0,
                tint: 4.0,
                ..ColorGrade::neutral()
            },
        },
        DemoPreset {
            name: "cool_editorial",
            settings: cool_editorial,
            ours: ColorGrade {
                contrast: 15.0,
                saturation: -10.0,
                temperature: -20.0,
                clarity: 10.0,
                ..ColorGrade::neutral()
            },
        },
        DemoPreset {
            name: "sky_recover",
            settings: sky_recover,
            ours: ColorGrade {
                highlights: -80.0,
                dehaze: 25.0,
                ..ColorGrade::neutral()
            },
        },
        DemoPreset {
            name: "cinematic",
            settings: cinematic,
            ours: ColorGrade {
                contrast: 12.0,
                saturation: -8.0,
                temperature: 10.0,
                ..ColorGrade::neutral()
            },
        },
    ]
}

fn neutral() -> DevelopSettings {
    DevelopSettings::default()
}

fn arch_clean() -> DevelopSettings {
    let mut s = DevelopSettings::default();
    for (id, value) in [
        ("light.highlights", -40.0),
        ("light.shadows", 30.0),
        ("light.whites", 10.0),
        ("light.blacks", -10.0),
        ("effects.clarity", 15.0),
        ("effects.dehaze", 10.0),
        ("color.vibrance", 15.0),
    ] {
        set(&mut s, id, value);
    }
    s
}

fn warm_dusk() -> DevelopSettings {
    let mut s = DevelopSettings::default();
    s.wb.mode = WbMode::Custom;
    s.wb.temp = 7300.0;
    s.light.highlights = -30.0;
    s.grading.highlights = Wheel {
        hue: 35.0,
        sat: 24.0,
        lum: 0.0,
    };
    s.grading.shadows = Wheel {
        hue: 195.0,
        sat: 18.0,
        lum: 0.0,
    };
    s.vignette.amount = -15.0;
    s
}

fn cool_editorial() -> DevelopSettings {
    let mut s = DevelopSettings::default();
    s.wb.mode = WbMode::Custom;
    s.wb.temp = 5900.0;
    s.light.contrast = 15.0;
    s.color.saturation = -10.0;
    s.effects.texture = 10.0;
    s
}

fn sky_recover() -> DevelopSettings {
    let mut s = DevelopSettings::default();
    s.light.highlights = -80.0;
    s.effects.dehaze = 25.0;
    s
}

fn cinematic() -> DevelopSettings {
    let mut s = DevelopSettings::default();
    s.curve.master = vec![
        Point::new(0.0, 0.0),
        Point::new(0.25, 0.20),
        Point::new(0.75, 0.80),
        Point::new(1.0, 1.0),
    ];
    s.grading.shadows = Wheel {
        hue: 195.0,
        sat: 18.0,
        lum: 0.0,
    };
    s.grading.highlights = Wheel {
        hue: 32.0,
        sat: 20.0,
        lum: 0.0,
    };
    s.grain.amount = 12.0;
    s
}

fn apply_ours(image: &DynamicImage, grade: ColorGrade) -> RgbaImage {
    let mut output = image.to_rgba8();
    for pixel in output.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let rgb = grade_rgb(
            [r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0],
            grade,
        );
        pixel.0 = [
            (rgb[0] * 255.0).round() as u8,
            (rgb[1] * 255.0).round() as u8,
            (rgb[2] * 255.0).round() as u8,
            a,
        ];
    }
    output
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn srgb_to_linear(value: f32) -> f32 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(value: f32) -> f32 {
    if value <= 0.0031308 {
        value * 12.92
    } else {
        1.055 * value.powf(1.0 / 2.4) - 0.055
    }
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = clamp01((value - edge0) / (edge1 - edge0));
    t * t * (3.0 - 2.0 * t)
}

fn luminance(color: [f32; 3]) -> f32 {
    0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]
}

fn grade_rgb(mut color: [f32; 3], grade: ColorGrade) -> [f32; 3] {
    let exposure = 2.0_f32.powf(grade.exposure / 100.0);
    for channel in &mut color {
        *channel = linear_to_srgb(clamp01(srgb_to_linear(*channel) * exposure));
    }
    color[0] += 0.10 * grade.temperature / 100.0;
    color[2] -= 0.10 * grade.temperature / 100.0;
    color[1] -= 0.10 * grade.tint / 100.0;
    color = color.map(|c| (c - 0.5) * (1.0 + grade.contrast / 100.0) + 0.5);
    let mut l = luminance(color);
    color = color.map(|c| c + 0.25 * (grade.highlights / 100.0) * smoothstep(0.5, 1.0, l));
    l = luminance(color);
    color = color.map(|c| c + 0.25 * (grade.shadows / 100.0) * (1.0 - smoothstep(0.0, 0.5, l)));
    l = luminance(color);
    color = color.map(|c| c + 0.15 * (grade.whites / 100.0) * l * l);
    l = luminance(color);
    color = color.map(|c| c + 0.15 * (grade.blacks / 100.0) * (1.0 - l) * (1.0 - l));
    l = luminance(color);
    color = color.map(|c| c + 0.8 * (grade.clarity / 100.0) * (c - 0.5) * l * (1.0 - l));
    let d = 0.10 * (grade.dehaze / 100.0);
    color = color.map(|c| (c - d) / (1.0 - d));
    l = luminance(color);
    let spread = color[0].max(color[1]).max(color[2]) - color[0].min(color[1]).min(color[2]);
    color = color.map(|c| l + (c - l) * (1.0 + (grade.vibrance / 100.0) * (1.0 - spread)));
    l = luminance(color);
    color = color.map(|c| l + (c - l) * (1.0 + grade.saturation / 100.0));
    color.map(clamp01)
}
