//! Non-destructive color grading and the `grade_apply` use case.
//!
//! The pixel pipeline intentionally mirrors API_CONTRACTS section 12.3. Keep the
//! arithmetic in `f32`: the TypeScript implementation uses the same precision and
//! operation order for cross-language parity.

use std::fs;
use std::io::Cursor;

use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};

use crate::domain::AssetRole;
use crate::dto::AssetDto;
use crate::error::{AppError, AppResult, ErrorCode};
use crate::imaging;
use crate::repositories::{self as repo, AssetRow, VersionRow};
use crate::services::assets::{asset_dto, store_managed_image, Thumbnail};
use crate::services::{ensure_not_archived, AppCore};
use crate::util::{new_id, prefix};

fn zero() -> f32 {
    0.0
}

fn deserialize_non_null_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(String::deserialize(deserializer)?))
}

/// Mirrors `ColorGradeDNA`. Defaults are useful for callers that submit the parsed
/// Zod shape as well as for tests that only exercise one slider.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ColorGrade {
    pub schema_version: u32,
    #[serde(default = "zero")]
    pub exposure: f32,
    #[serde(default = "zero")]
    pub contrast: f32,
    #[serde(default = "zero")]
    pub highlights: f32,
    #[serde(default = "zero")]
    pub shadows: f32,
    #[serde(default = "zero")]
    pub whites: f32,
    #[serde(default = "zero")]
    pub blacks: f32,
    #[serde(default = "zero")]
    pub temperature: f32,
    #[serde(default = "zero")]
    pub tint: f32,
    #[serde(default = "zero")]
    pub vibrance: f32,
    #[serde(default = "zero")]
    pub saturation: f32,
    #[serde(default = "zero")]
    pub clarity: f32,
    #[serde(default = "zero")]
    pub dehaze: f32,
    #[serde(default, deserialize_with = "deserialize_non_null_string", skip_serializing_if = "Option::is_none")]
    pub look: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GradeApplyRequest {
    pub project_id: String,
    pub asset_id: String,
    pub grade: ColorGrade,
    pub label: Option<String>,
}

fn in_range(name: &str, value: f32, min: f32, max: f32) -> AppResult<()> {
    if !value.is_finite() || value < min || value > max {
        return Err(AppError::validation(format!("{name} must be between {min} and {max}.")));
    }
    Ok(())
}

pub fn validate_grade(grade: &ColorGrade) -> AppResult<()> {
    if grade.schema_version != 1 {
        return Err(AppError::validation("Color grade schemaVersion must be 1."));
    }
    in_range("exposure", grade.exposure, -100.0, 100.0)?;
    for (name, value) in [
        ("contrast", grade.contrast),
        ("highlights", grade.highlights),
        ("shadows", grade.shadows),
        ("whites", grade.whites),
        ("blacks", grade.blacks),
        ("temperature", grade.temperature),
        ("tint", grade.tint),
        ("vibrance", grade.vibrance),
        ("saturation", grade.saturation),
        ("clarity", grade.clarity),
        ("dehaze", grade.dehaze),
    ] {
        in_range(name, value, -100.0, 100.0)?;
    }
    Ok(())
}

fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(v: f32) -> f32 {
    if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = clamp01((x - edge0) / (edge1 - edge0));
    t * t * (3.0 - 2.0 * t)
}

fn luminance(c: [f32; 3]) -> f32 {
    0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

fn grade_rgb(mut c: [f32; 3], grade: &ColorGrade) -> [f32; 3] {
    let k_exposure = 2.0_f32.powf(grade.exposure / 100.0);
    for channel in &mut c {
        *channel = linear_to_srgb(clamp01(srgb_to_linear(*channel) * k_exposure));
    }

    let k_temperature = grade.temperature / 100.0;
    let k_tint = grade.tint / 100.0;
    c[0] += 0.10 * k_temperature;
    c[2] -= 0.10 * k_temperature;
    c[1] -= 0.10 * k_tint;

    c = c.map(|channel| (channel - 0.5) * (1.0 + grade.contrast / 100.0) + 0.5);

    let mut l = luminance(c);
    c = c.map(|channel| channel + 0.25 * (grade.highlights / 100.0) * smoothstep(0.5, 1.0, l));
    l = luminance(c);
    c = c.map(|channel| channel + 0.25 * (grade.shadows / 100.0) * (1.0 - smoothstep(0.0, 0.5, l)));
    l = luminance(c);
    c = c.map(|channel| channel + 0.15 * (grade.whites / 100.0) * l * l);
    l = luminance(c);
    c = c.map(|channel| channel + 0.15 * (grade.blacks / 100.0) * (1.0 - l) * (1.0 - l));

    l = luminance(c);
    c = c.map(|channel| channel + 0.8 * (grade.clarity / 100.0) * (channel - 0.5) * l * (1.0 - l));

    let d = 0.10 * (grade.dehaze / 100.0);
    c = c.map(|channel| (channel - d) / (1.0 - d));

    l = luminance(c);
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let spread = max - min;
    c = c.map(|channel| l + (channel - l) * (1.0 + (grade.vibrance / 100.0) * (1.0 - spread)));

    l = luminance(c);
    c = c.map(|channel| l + (channel - l) * (1.0 + grade.saturation / 100.0));
    c.map(clamp01)
}

/// Grade one RGBA image, preserving the alpha byte exactly.
pub fn apply_grade(image: &DynamicImage, grade: &ColorGrade) -> RgbaImage {
    let mut output = image.to_rgba8();
    for pixel in output.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let rgb = grade_rgb([r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0], grade);
        pixel.0 = [(rgb[0] * 255.0).round() as u8, (rgb[1] * 255.0).round() as u8, (rgb[2] * 255.0).round() as u8, a];
    }
    output
}

fn source_asset(core: &AppCore, project_id: &str, asset_id: &str) -> AppResult<AssetRow> {
    let conn = core.conn()?;
    let project = repo::get_project(&conn, project_id)?;
    ensure_not_archived(&project)?;
    let asset = repo::find_asset(&conn, asset_id)?.ok_or_else(|| AppError::not_found("Asset", asset_id))?;
    if asset.project_id != project_id {
        return Err(AppError::not_found("Asset", asset_id));
    }
    if asset.status != "ready" {
        return Err(AppError::invalid_state("The source asset is not ready."));
    }
    Ok(asset)
}

pub fn apply(core: &AppCore, request: GradeApplyRequest) -> AppResult<AssetDto> {
    validate_grade(&request.grade)?;
    let source = source_asset(core, &request.project_id, &request.asset_id)?;
    let source_path = core.storage.resolve(&source.project_id, &source.managed_rel_path)?;
    let source_bytes = fs::read(&source_path)
        .map_err(|e| AppError::invalid_state(format!("The source image is not available: {e}")))?;
    let source_info = imaging::inspect(&source_bytes, "source image")
        .map_err(|e| AppError::invalid_state(format!("The source image is not readable: {}", e.message)))?;
    let source_image = imaging::decode(&source_bytes, source_info.format)
        .map_err(|e| AppError::new(ErrorCode::InvalidState, format!("The source image cannot be decoded: {e}")))?;

    let graded = apply_grade(&source_image, &request.grade);
    let mut output_bytes = Vec::new();
    DynamicImage::ImageRgba8(graded)
        .write_to(&mut Cursor::new(&mut output_bytes), ImageFormat::Png)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("Could not encode the graded image: {e}")))?;
    let info = imaging::inspect(&output_bytes, "graded image")?;
    let decoded = imaging::decode(&output_bytes, info.format)
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("Could not decode the graded image: {e}")))?;

    let asset_id = new_id(prefix::ASSET);
    let stored = store_managed_image(
        &core.storage,
        &request.project_id,
        &asset_id,
        &output_bytes,
        &info,
        Thumbnail::Required(&decoded),
    )?;
    let label =
        request.label.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or("Color grade").to_string();
    let operation_json = serde_json::to_string(&request.grade)
        .map_err(|e| AppError::new(ErrorCode::DbError, format!("Cannot record the color grade: {e}")))?;
    let now = core.now_iso();
    let result = (|| -> AppResult<AssetRow> {
        let mut conn = core.conn()?;
        let tx = conn.transaction()?;
        let project = repo::get_project(&tx, &request.project_id)?;
        ensure_not_archived(&project)?;
        let current =
            repo::find_asset(&tx, &request.asset_id)?.ok_or_else(|| AppError::not_found("Asset", &request.asset_id))?;
        if current.project_id != request.project_id {
            return Err(AppError::not_found("Asset", &request.asset_id));
        }
        if current.status != "ready" {
            return Err(AppError::invalid_state("The source asset is not ready."));
        }
        let parent_version_id = repo::latest_version_id(&tx, &current.id)?;
        let row = AssetRow {
            id: asset_id.clone(),
            project_id: request.project_id.clone(),
            source: current.source,
            role: AssetRole::RegularImage,
            status: "ready".into(),
            original_name: Some(label.clone()),
            managed_rel_path: stored.managed_rel.clone(),
            thumbnail_rel_path: stored.thumbnail_rel.clone(),
            mime_type: Some("image/png".into()),
            file_size_bytes: Some(info.size_bytes as i64),
            width_px: Some(info.width as i64),
            height_px: Some(info.height as i64),
            sha256: Some(info.sha256.clone()),
            parent_asset_id: Some(current.id.clone()),
            operation: Some("color_grade".into()),
            operation_json: Some(operation_json.clone()),
            created_at: now.clone(),
            updated_at: now.clone(),
        };
        repo::insert_asset(&tx, &row)?;
        repo::insert_version(
            &tx,
            &VersionRow {
                id: new_id(prefix::VERSION),
                project_id: request.project_id.clone(),
                asset_id: asset_id.clone(),
                parent_version_id,
                label: Some(label),
                operation: "color_grade".into(),
                operation_json: Some(operation_json),
                generation_id: None,
                created_at: now,
            },
        )?;
        tx.commit()?;
        Ok(row)
    })();

    match result {
        Ok(row) => asset_dto(&core.storage, &row),
        Err(error) => {
            stored.remove_files();
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::assets;
    use crate::services::tests_support::{core, test_create_villa, test_import};
    use image::{Rgba, RgbaImage};
    use serde_json::json;
    use serde_json::Value;
    use std::path::Path;

    fn neutral() -> ColorGrade {
        serde_json::from_value(serde_json::json!({ "schemaVersion": 1 })).unwrap()
    }

    #[test]
    fn neutral_grade_preserves_pixels_and_alpha() {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(1, 1, Rgba([12, 34, 56, 78])));
        let out = apply_grade(&image, &neutral());
        assert_eq!(out.get_pixel(0, 0).0, [12, 34, 56, 78]);
    }

    #[test]
    fn rejects_values_outside_zod_ranges() {
        let mut grade = neutral();
        grade.exposure = 101.0;
        assert_eq!(validate_grade(&grade).unwrap_err().code, ErrorCode::ValidationError);
        grade.exposure = 0.0;
        grade.saturation = -101.0;
        assert_eq!(validate_grade(&grade).unwrap_err().code, ErrorCode::ValidationError);
    }

    #[test]
    fn rejects_grade_apply_request_without_schema_version() {
        let parsed = serde_json::from_value::<GradeApplyRequest>(json!({
            "projectId": "PRJ_X",
            "assetId": "AST_X",
            "grade": { "temperature": 40 }
        }));
        assert!(parsed.is_err());
    }

    #[test]
    fn rejects_grade_apply_request_with_null_look() {
        let parsed = serde_json::from_value::<GradeApplyRequest>(json!({
            "projectId": "PRJ_X",
            "assetId": "AST_X",
            "grade": { "schemaVersion": 1, "look": null }
        }));
        assert!(parsed.is_err());
    }

    #[test]
    fn apply_creates_new_asset_and_version_without_changing_source() {
        let (tmp, core) = core();
        let project = test_create_villa(&core, "Grade");
        let source = test_import(&core, tmp.path(), &project.id, "source.png", "regular_image");
        let before = std::fs::read(&source.absolute_path).unwrap();
        let graded = apply(
            &core,
            GradeApplyRequest {
                project_id: project.id.clone(),
                asset_id: source.id.clone(),
                grade: serde_json::from_value(json!({ "schemaVersion": 1, "temperature": 40 })).unwrap(),
                label: Some("Warm look".into()),
            },
        )
        .unwrap();
        assert_ne!(graded.id, source.id);
        assert_eq!(graded.parent_asset_id.as_deref(), Some(source.id.as_str()));
        assert_eq!(graded.operation.as_deref(), Some("color_grade"));
        assert_eq!(std::fs::read(&source.absolute_path).unwrap(), before);
        let versions = assets::list_versions(&core, &project.id).unwrap();
        let version = versions.iter().find(|v| v.asset_id == graded.id).unwrap();
        assert_eq!(version.operation, "color_grade");
        assert_eq!(
            version.parent_version_id.as_deref(),
            Some(versions.iter().find(|v| v.asset_id == source.id).unwrap().id.as_str())
        );
    }

    #[test]
    fn parity_vectors_use_domain_file_when_available() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let path = manifest.join("../../../packages/domain/test-vectors/grade.json");
        assert!(path.is_file(), "domain grade vectors missing: {}", path.display());
        let vectors: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for vector in vectors {
            let grade: ColorGrade = serde_json::from_value(vector["grade"].clone()).unwrap();
            validate_grade(&grade).unwrap();
            let input = vector["input"].as_array().unwrap();
            let expected = vector["output"].as_array().unwrap();
            assert_eq!(input.len(), expected.len(), "grade vector input/output length mismatch");
            for (pixel, wanted) in input.iter().zip(expected) {
                let rgb = pixel.as_array().unwrap();
                let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
                    1,
                    1,
                    Rgba([
                        rgb[0].as_u64().unwrap() as u8,
                        rgb[1].as_u64().unwrap() as u8,
                        rgb[2].as_u64().unwrap() as u8,
                        255,
                    ]),
                ));
                let got = apply_grade(&image, &grade).get_pixel(0, 0).0;
                for (actual, expected) in got[..3].iter().zip(wanted.as_array().unwrap()) {
                    let expected = expected.as_i64().unwrap() as i16;
                    assert!(
                        (*actual as i16 - expected).abs() <= 1,
                        "grade {:?}: got {:?}, want {:?}",
                        grade,
                        got,
                        wanted
                    );
                }
            }
        }
    }

    #[test]
    fn grades_a_4096_square_without_allocating_per_pixel_state() {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(4096, 4096, Rgba([80, 120, 160, 255])));
        let started = std::time::Instant::now();
        let output = apply_grade(
            &image,
            &ColorGrade {
                schema_version: 1,
                exposure: 0.5,
                contrast: 15.0,
                highlights: -10.0,
                shadows: 20.0,
                whites: 5.0,
                blacks: -5.0,
                temperature: 10.0,
                tint: -3.0,
                vibrance: 20.0,
                saturation: 8.0,
                clarity: 12.0,
                dehaze: 5.0,
                look: None,
            },
        );
        eprintln!("grade 4096x4096: {:?}", started.elapsed());
        assert_eq!((output.width(), output.height()), (4096, 4096));
    }
}
