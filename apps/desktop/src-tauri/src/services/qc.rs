use std::fs;
use std::io::Cursor;

use image::DynamicImage;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::dto::{
    QcArtifactDto, QcIssueDto, QcLocalDto, QcReportDto, QcScoresDto, QcSettingsDto, QcThresholdsDto, QcVisionDto,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::repositories as repo;
use crate::services::provider_settings::{find_provider, key_for, not_configured};
use crate::services::{ensure_not_archived, AppCore};
use crate::util::{new_id, prefix};

pub mod local;

impl Default for QcSettingsDto {
    fn default() -> Self {
        Self {
            schema_version: 1,
            pass_min: 70.0,
            category_min: 55.0,
            high_artifact_fails: true,
            auto_qc: "off".into(),
            auto_repair_max: 0,
            vision_provider_id: None,
            vision_model: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QcRunRequest {
    pub project_id: String,
    pub asset_id: String,
    pub vision: Option<QcVisionRequest>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QcVisionRequest {
    pub provider_id: String,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QcListRequest {
    pub project_id: String,
    pub asset_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QcSettingsSetRequest {
    pub project_id: String,
    pub settings: QcSettingsDto,
}

fn clamp_score(value: i64) -> i32 {
    value.clamp(0, 100) as i32
}

pub fn score_report(
    local: &QcLocalDto,
    vision: Option<&QcVisionDto>,
    thresholds: &QcThresholdsDto,
) -> (Option<f64>, String) {
    let Some(vision) = vision else {
        return local
            .edge_alignment
            .map(|value| (Some(value), if value >= thresholds.pass_min { "pass" } else { "warn" }.into()))
            .unwrap_or((None, "unscored".into()));
    };
    let values = [
        vision.scores.geometry,
        vision.scores.material,
        vision.scores.openings,
        vision.scores.context,
        vision.scores.lighting,
    ];
    let overall = values.iter().map(|v| *v as f64).sum::<f64>() / values.len() as f64;
    let high_artifact = vision.artifacts.iter().any(|a| a.severity == "high");
    let fail = values.iter().any(|v| (*v as f64) < thresholds.category_min)
        || overall < thresholds.pass_min
        || (thresholds.high_artifact_fails && high_artifact);
    let result = if fail {
        "fail"
    } else if overall < thresholds.pass_min + 10.0 {
        "warn"
    } else {
        "pass"
    };
    (Some(overall), result.into())
}

fn extract_json_object(text: &str) -> Option<&str> {
    let start = text.find('{')?;
    let mut depth = 0i32;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, ch) in text[start..].char_indices() {
        if quoted {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                quoted = false;
            }
            continue;
        }
        match ch {
            '"' => quoted = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..start + offset + 1]);
                }
            }
            _ => {}
        }
    }
    None
}

pub fn parse_vision_reply(text: &str, provider_id: &str, model: &str) -> AppResult<QcVisionDto> {
    let object = extract_json_object(text)
        .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision judge returned no JSON object."))?;
    let value: Value = serde_json::from_str(object)
        .map_err(|_| AppError::new(ErrorCode::ProviderError, "Vision judge returned invalid JSON."))?;
    let scores = value
        .get("scores")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision judge response is missing scores."))?;
    let score = |key: &str| {
        scores.get(key).and_then(Value::as_i64).map(clamp_score).ok_or_else(|| {
            AppError::new(ErrorCode::ProviderError, format!("Vision judge response is missing scores.{key}."))
        })
    };
    let artifacts = value
        .get("artifacts")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision judge response is missing artifacts."))?
        .iter()
        .map(|item| {
            let obj = item
                .as_object()
                .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact is not an object."))?;
            let severity = obj.get("severity").and_then(Value::as_str).unwrap_or_default();
            if !["low", "medium", "high"].contains(&severity) {
                return Err(AppError::new(ErrorCode::ProviderError, "Vision artifact severity is invalid."));
            }
            let box_ = match obj.get("box") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    let a = v
                        .as_array()
                        .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact box is invalid."))?;
                    if a.len() != 4 {
                        return Err(AppError::new(ErrorCode::ProviderError, "Vision artifact box is invalid."));
                    }
                    Some([
                        a[0].as_f64()
                            .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact box is invalid."))?
                            .clamp(0.0, 1.0),
                        a[1].as_f64()
                            .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact box is invalid."))?
                            .clamp(0.0, 1.0),
                        a[2].as_f64()
                            .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact box is invalid."))?
                            .clamp(0.0, 1.0),
                        a[3].as_f64()
                            .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact box is invalid."))?
                            .clamp(0.0, 1.0),
                    ])
                }
            };
            Ok(QcArtifactDto {
                label: obj.get("label").and_then(Value::as_str).unwrap_or("artifact").to_string(),
                severity: severity.into(),
                box_,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let issues = value
        .get("issues")
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision judge response is missing issues."))?
        .iter()
        .map(|item| {
            let obj = item
                .as_object()
                .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision issue is not an object."))?;
            let category = obj.get("category").and_then(Value::as_str).unwrap_or_default();
            if !["geometry", "material", "openings", "context", "lighting", "artifact"].contains(&category) {
                return Err(AppError::new(ErrorCode::ProviderError, "Vision issue category is invalid."));
            }
            Ok(QcIssueDto {
                category: category.into(),
                text: obj.get("text").and_then(Value::as_str).unwrap_or_default().into(),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok(QcVisionDto {
        provider_id: provider_id.into(),
        model: model.into(),
        scores: QcScoresDto {
            geometry: score("geometry")?,
            material: score("material")?,
            openings: score("openings")?,
            context: score("context")?,
            lighting: score("lighting")?,
        },
        artifacts,
        issues,
        repair_instruction: value.get("repairInstruction").and_then(Value::as_str).unwrap_or_default().into(),
    })
}

fn image_for(core: &AppCore, asset: &repo::AssetRow) -> AppResult<DynamicImage> {
    let path = core.storage.resolve(&asset.project_id, &asset.managed_rel_path)?;
    let bytes = fs::read(path).map_err(|e| AppError::invalid_state(format!("The image is not available: {e}")))?;
    let format = crate::imaging::inspect(&bytes, "QC image")?.format;
    crate::imaging::decode(&bytes, format)
        .map_err(|e| AppError::invalid_state(format!("The image cannot be decoded: {e}")))
}

fn jpeg_for_vision(image: &DynamicImage) -> AppResult<Vec<u8>> {
    let image = crate::services::qc::local::resize_long_edge(image, 1024).to_rgb8();
    let mut bytes = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(Cursor::new(&mut bytes), 85);
    encoder
        .encode_image(&DynamicImage::ImageRgb8(image))
        .map_err(|e| AppError::new(ErrorCode::IoError, format!("Could not encode QC image: {e}")))?;
    Ok(bytes)
}

fn defaults_or_loaded(core: &AppCore, project_id: &str) -> AppResult<QcSettingsDto> {
    let conn = core.conn()?;
    repo::get_project(&conn, project_id)?;
    let raw: Option<String> = conn
        .query_row("SELECT settings_json FROM qc_settings WHERE project_id = ?1", [project_id], |r| r.get(0))
        .optional()?;
    Ok(raw.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default())
}

pub fn settings_get(core: &AppCore, project_id: &str) -> AppResult<QcSettingsDto> {
    defaults_or_loaded(core, project_id)
}

pub fn settings_set(core: &AppCore, request: QcSettingsSetRequest) -> AppResult<QcSettingsDto> {
    let s = request.settings;
    if s.schema_version != 1
        || !s.pass_min.is_finite()
        || !(0.0..=100.0).contains(&s.pass_min)
        || !s.category_min.is_finite()
        || !(0.0..=100.0).contains(&s.category_min)
        || s.auto_repair_max > 2
        || !["off", "after_generation"].contains(&s.auto_qc.as_str())
    {
        return Err(AppError::validation("Invalid QC settings."));
    }
    let now = core.now_iso();
    let json = serde_json::to_string(&s).map_err(|e| AppError::new(ErrorCode::DbError, e.to_string()))?;
    let conn = core.conn()?;
    repo::get_project(&conn, &request.project_id)?;
    conn.execute("INSERT INTO qc_settings(project_id, settings_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET settings_json=excluded.settings_json, updated_at=excluded.updated_at", rusqlite::params![request.project_id, json, now])?;
    Ok(s)
}

pub fn run(core: &AppCore, request: QcRunRequest) -> AppResult<QcReportDto> {
    let (output, reference, reference_ids, thresholds, edge_allowed) = {
        let conn = core.conn()?;
        let project = repo::get_project(&conn, &request.project_id)?;
        ensure_not_archived(&project)?;
        if project.master_approved_at.is_none() {
            return Err(AppError::validation("Finish the step 'Master' (generate.master) before running QC."));
        }
        let output = repo::find_asset(&conn, &request.asset_id)?
            .ok_or_else(|| AppError::not_found("Asset", &request.asset_id))?;
        if output.project_id != request.project_id {
            return Err(AppError::not_found("Asset", &request.asset_id));
        }
        if output.status != "ready" {
            return Err(AppError::invalid_state("QC requires a ready image asset."));
        }
        let generation_refs = output
            .operation_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|value| value.get("generationId").and_then(Value::as_str).map(str::to_string))
            .and_then(|id| repo::find_generation(&conn, &id).ok().flatten())
            .and_then(|generation| serde_json::from_str::<Value>(&generation.request_json).ok())
            .and_then(|request| request.get("referenceAssetIds").and_then(Value::as_array).cloned())
            .map(|ids| ids.into_iter().filter_map(|id| id.as_str().map(str::to_string)).collect::<Vec<_>>())
            .filter(|ids| !ids.is_empty());
        let reference_ids =
            generation_refs.unwrap_or_else(|| project.active_master_asset_id.clone().into_iter().collect());
        let reference_id =
            reference_ids.first().cloned().ok_or_else(|| AppError::validation("QC needs a primary reference."))?;
        let reference = repo::find_asset(&conn, &reference_id)?
            .ok_or_else(|| AppError::not_found("Reference asset", &reference_id))?;
        let settings = conn
            .query_row("SELECT settings_json FROM qc_settings WHERE project_id = ?1", [&request.project_id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .and_then(|json| serde_json::from_str::<QcSettingsDto>(&json).ok())
            .unwrap_or_default();
        let edge_allowed = match output.operation.as_deref() {
            Some("color_grade") | Some("enhance") | Some("repair") => true,
            Some("generate") => output
                .operation_json
                .as_deref()
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|value| value.get("generationId").and_then(Value::as_str).map(str::to_string))
                .and_then(|id| repo::find_generation(&conn, &id).ok().flatten())
                .is_some_and(|generation| {
                    matches!(
                        generation.purpose,
                        crate::domain::GenerationPurpose::Variation
                            | crate::domain::GenerationPurpose::Enhance
                            | crate::domain::GenerationPurpose::Repair
                    )
                }),
            _ => false,
        };
        (
            output,
            reference,
            reference_ids,
            QcThresholdsDto {
                pass_min: settings.pass_min,
                category_min: settings.category_min,
                high_artifact_fails: settings.high_artifact_fails,
            },
            edge_allowed,
        )
    };
    let output_image = image_for(core, &output)?;
    let reference_image = image_for(core, &reference)?;
    let local = QcLocalDto {
        edge_alignment: if edge_allowed {
            Some(crate::services::qc::local::edge_alignment(&output_image, &reference_image) as f64)
        } else {
            None
        },
        sharpness: crate::services::qc::local::sharpness(&output_image) as f64,
        clipped_pct: crate::services::qc::local::clipped_pct(&output_image) as f64,
    };
    let vision = if let Some(requested) = request.vision {
        let provider = find_provider(core, &requested.provider_id)?;
        let info = provider.info();
        let model = requested
            .model
            .or_else(|| provider.vision_model())
            .or_else(|| provider.chat_model())
            .ok_or_else(|| AppError::validation("The selected provider has no vision chat model."))?;
        let key = key_for(core, provider.as_ref());
        if info.requires_api_key && key.is_none() {
            return Err(not_configured(provider.as_ref()));
        }
        let reply = provider.vision("You are a strict architectural image QC judge. Return JSON only.", "Score the image against the reference.", &[("image/jpeg", jpeg_for_vision(&output_image)?), ("image/jpeg", jpeg_for_vision(&reference_image)?)], Some(&model), key.as_ref().map(|k| k.value.as_str())).map_err(|e| AppError::new(ErrorCode::ProviderError, e.message).with_details(json!({"providerId": requested.provider_id, "kind": e.kind.as_str(), "retryable": e.kind.retryable()})))?;
        Some(parse_vision_reply(&reply, &requested.provider_id, &model).map_err(|e| {
            AppError::new(ErrorCode::ProviderError, e.message)
                .with_details(json!({"providerId": requested.provider_id, "kind": "bad_response", "retryable": false}))
        })?)
    } else {
        None
    };
    let (overall, result) = score_report(&local, vision.as_ref(), &thresholds);
    let report = QcReportDto {
        id: new_id(prefix::QC),
        project_id: request.project_id.clone(),
        asset_id: request.asset_id.clone(),
        reference_asset_ids: reference_ids,
        local,
        vision,
        overall,
        result,
        thresholds,
        created_at: core.now_iso(),
    };
    let json = serde_json::to_string(&report).map_err(|e| AppError::new(ErrorCode::DbError, e.to_string()))?;
    let conn = core.conn()?;
    conn.execute("INSERT INTO qc_reports(id, project_id, asset_id, report_json, result, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)", rusqlite::params![report.id, report.project_id, report.asset_id, json, report.result, report.created_at])?;
    Ok(report)
}

pub fn list(core: &AppCore, request: QcListRequest) -> AppResult<Vec<QcReportDto>> {
    let conn = core.conn()?;
    repo::get_project(&conn, &request.project_id)?;
    let mut stmt = conn.prepare("SELECT report_json FROM qc_reports WHERE project_id = ?1 AND (?2 IS NULL OR asset_id = ?2) ORDER BY created_at DESC, id DESC")?;
    let rows = stmt.query_map(rusqlite::params![request.project_id, request.asset_id], |r| r.get::<_, String>(0))?;
    rows.map(|row| {
        let raw = row?;
        serde_json::from_str(&raw)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))
    })
    .collect::<Result<Vec<_>, _>>()
    .map_err(AppError::from)
}
