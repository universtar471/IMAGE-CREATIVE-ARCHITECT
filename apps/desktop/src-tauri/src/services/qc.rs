use std::collections::HashMap;
use std::fs;
use std::io::Cursor;
use std::sync::{Arc, Mutex, OnceLock};

use image::DynamicImage;
use rusqlite::OptionalExtension;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::dto::{
    QcArtifactDto, QcIssueDto, QcLocalDto, QcReportDto, QcScoresDto, QcSettingsDto, QcThresholdsDto, QcVisionDto,
};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::providers::RepairParams;
use crate::repositories as repo;
use crate::services::generations::{self, SubmitRequest};
use crate::services::provider_settings::{find_provider, key_for, not_configured};
use crate::services::{ensure_not_archived, AppCore};
use crate::util::{new_id, prefix};

pub mod local;

static AUTOMATION_PROJECT_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

fn project_automation_lock(project_id: &str) -> Arc<Mutex<()>> {
    let locks = AUTOMATION_PROJECT_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.entry(project_id.to_string()).or_insert_with(|| Arc::new(Mutex::new(()))).clone()
}

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
            .map(|value| {
                let result = if value < thresholds.pass_min {
                    "fail"
                } else if value < thresholds.pass_min + 10.0 {
                    "warn"
                } else {
                    "pass"
                };
                (Some(value), result.into())
            })
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

fn extract_json_objects(text: &str) -> Vec<&str> {
    let mut candidates = Vec::new();
    for (start, _) in text.match_indices('{') {
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
                        let candidate = &text[start..start + offset + 1];
                        candidates.push(candidate);
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    candidates
}

fn parse_vision_object(object: &str, provider_id: &str, model: &str) -> AppResult<QcVisionDto> {
    let value: Value = serde_json::from_str(object)
        .map_err(|_| AppError::new(ErrorCode::ProviderError, "Vision judge returned invalid JSON."))?;
    let scores = value
        .get("scores")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision judge response is missing scores."))?;
    let score = |key: &str| {
        scores.get(key).and_then(Value::as_f64).map(|value| clamp_score(value.round() as i64)).ok_or_else(|| {
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
                label: obj
                    .get("label")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision artifact label is invalid."))?
                    .to_string(),
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
                text: obj
                    .get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision issue text is invalid."))?
                    .into(),
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
        repair_instruction: value
            .get("repairInstruction")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::new(ErrorCode::ProviderError, "Vision repairInstruction is invalid."))?
            .into(),
    })
}

pub fn parse_vision_reply(text: &str, provider_id: &str, model: &str) -> AppResult<QcVisionDto> {
    let mut last_error = AppError::new(ErrorCode::ProviderError, "Vision judge returned no JSON object.");
    for candidate in extract_json_objects(text) {
        match parse_vision_object(candidate, provider_id, model) {
            Ok(reply) => return Ok(reply),
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn stable_json(value: &Value) -> String {
    match value {
        Value::Object(object) => {
            let mut keys = object.keys().collect::<Vec<_>>();
            keys.sort();
            format!(
                "{{{}}}",
                keys.into_iter()
                    .map(|key| format!("{}:{}", serde_json::to_string(key).unwrap(), stable_json(&object[key])))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
        Value::Array(items) => format!("[{}]", items.iter().map(stable_json).collect::<Vec<_>>().join(",")),
        Value::Number(number) => number.as_f64().map(|value| value.to_string()).unwrap_or_else(|| number.to_string()),
        _ => value.to_string(),
    }
}

fn dna_facts(dna: &Value) -> String {
    let value = |key: &str| dna.get(key).cloned().unwrap_or(Value::Null);
    format!(
        "Building DNA: {}\nContext DNA: {}\nCamera DNA: {}\nLighting DNA: {}\nWeather DNA: {}\nMood DNA: {}",
        stable_json(&value("building")),
        stable_json(&value("context")),
        stable_json(&value("cameras")),
        stable_json(&value("lighting")),
        stable_json(&value("weather")),
        stable_json(&value("mood")),
    )
}

const VISION_SYSTEM_PROMPT: &str = r#"You are a strict architectural image quality-control judge. Compare the evaluated image with its reference images and the supplied project DNA facts.

Score exactly these five categories from 0 to 100:
- geometry: building massing, proportions, floor count, roof form, perspective and structural consistency.
- material: specified facade, roof and surface materials, colors, texture fidelity and finish consistency.
- openings: window and door count, placement, rhythm, frames, glazing and alignment.
- context: site layout, streets, neighbouring buildings, landscape, vegetation and background consistency.
- lighting: time of day, direction, intensity, shadows, artificial lights, weather and atmosphere consistency.

List visible image-generation artifacts separately. Artifact severity must be low, medium or high. Each box must be [x,y,w,h] normalized to 0..1, or null when no useful box can be given. Issue category must be geometry, material, openings, context, lighting or artifact.

Return JSON only, without markdown or prose, using exactly these top-level keys:
{"scores":{"geometry":0,"material":0,"openings":0,"context":0,"lighting":0},"artifacts":[{"label":"","severity":"low","box":null}],"issues":[{"category":"geometry","text":""}],"repairInstruction":""}"#;

/// Rust mirror of `packages/domain/src/qc/prompts.ts::buildVisionPrompt`.
pub fn build_vision_prompt(dna: &Value, purpose: &str) -> (String, String) {
    let same_view = if ["enhance", "variation", "repair", "color_grade"].contains(&purpose) {
        "This output must keep the same viewpoint, camera, framing and composition as its primary reference. Treat any drift as a geometry issue."
    } else {
        "Judge the requested viewpoint on its own terms; do not require it to match the primary reference camera."
    };
    (
        VISION_SYSTEM_PROMPT.to_string(),
        format!("Generation purpose: {purpose}.\n{same_view}\nProject DNA facts:\n{}", dna_facts(dna)),
    )
}

/// Rust mirror of `packages/domain/src/qc/prompts.ts::buildRepairPrompt`.
/// Keep the line order and JSON compactness stable: the shared test vector compares both sides.
pub fn build_repair_prompt(dna: &Value, report: &QcReportDto) -> String {
    let facts = |dna: &Value| dna_facts(dna);
    let (issues, artifacts, instruction) = match report.vision.as_ref() {
        Some(vision) => {
            let issues = if vision.issues.is_empty() {
                "None listed.".to_string()
            } else {
                vision
                    .issues
                    .iter()
                    .enumerate()
                    .map(|(index, issue)| format!("{}. [{}] {}", index + 1, issue.category, issue.text))
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let artifacts = if vision.artifacts.is_empty() {
                "None listed.".to_string()
            } else {
                vision
                    .artifacts
                    .iter()
                    .enumerate()
                    .map(|(index, artifact)| {
                        format!(
                            "{}. [{}] {}; box: {}",
                            index + 1,
                            artifact.severity,
                            artifact.label,
                            artifact.box_.map(|b| json!(b).to_string()).unwrap_or_else(|| "null".into())
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            let instruction = if vision.repair_instruction.is_empty() {
                "No additional repair instruction.".to_string()
            } else {
                vision.repair_instruction.clone()
            };
            (issues, artifacts, instruction)
        }
        None => ("None listed.".into(), "None listed.".into(), "No additional repair instruction.".into()),
    };
    format!(
        "Repair this architectural image. Fix only the QC issues and artifacts listed below.\nQC issues:\n{}\nQC artifacts:\n{}\nRepair instruction: {}\nKeep the architecture, camera and composition unchanged. Keep every element not explicitly listed above unchanged, including geometry, materials, openings, context, lighting, weather and mood.\nDo not redesign, restyle, reframe, crop, add or remove anything else.\nProject facts to preserve:\n{}",
        issues,
        artifacts,
        instruction,
        facts(dna)
    )
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
    let (output, reference, reference_ids, thresholds, edge_allowed, dna, purpose) = {
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
        let generation = output
            .operation_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
            .and_then(|value| value.get("generationId").and_then(Value::as_str).map(str::to_string))
            .and_then(|id| repo::find_generation(&conn, &id).ok().flatten());
        let generation_refs = generation
            .as_ref()
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
        let purpose = match output.operation.as_deref() {
            Some("enhance") | Some("repair") | Some("color_grade") => output.operation.clone(),
            _ => generation.as_ref().map(|row| row.purpose.as_str().to_string()).or_else(|| output.operation.clone()),
        }
        .unwrap_or_else(|| "generate".into());
        let dna = repo::get_dna(&conn, &request.project_id)?;
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
            dna,
            purpose,
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
        let (system_prompt, user_prompt) = build_vision_prompt(&dna, &purpose);
        let reply = provider.vision(&system_prompt, &user_prompt, &[("image/jpeg", jpeg_for_vision(&output_image)?), ("image/jpeg", jpeg_for_vision(&reference_image)?)], Some(&model), key.as_ref().map(|k| k.value.as_str())).map_err(|e| AppError::new(ErrorCode::ProviderError, e.message).with_details(json!({"providerId": requested.provider_id, "kind": e.kind.as_str(), "retryable": e.kind.retryable()})))?;
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

/// Schedule post-generation QC without extending the generation job's critical path.
/// Errors are deliberately logged and discarded; the original generation is already committed.
pub(crate) fn spawn_after_generation(core: Arc<AppCore>, generation_id: String) {
    let thread_name = format!("qc-{generation_id}");
    let generation_label = generation_id.clone();
    if let Err(error) = std::thread::Builder::new().name(thread_name).spawn(move || {
        if let Err(error) = automation_after_generation(&core, &generation_id) {
            eprintln!("[qc] automatic QC failed generation={generation_id}: {}", error.message);
        }
    }) {
        eprintln!("[qc] could not start automatic QC thread generation={generation_label}: {error}");
    }
}

pub(crate) fn automation_for_test(core: &AppCore, job_id: &str) {
    if let Err(error) = automation_after_generation(core, job_id) {
        eprintln!("[qc] automatic QC failed generation_or_job={job_id}: {}", error.message);
    }
}

fn automation_after_generation(core: &AppCore, generation_id: &str) -> AppResult<()> {
    let (generation, output_ids, settings, dna) = {
        let conn = core.conn()?;
        let generation_id = repo::get_job(&conn, generation_id)?.generation_id;
        let generation = repo::find_generation(&conn, &generation_id)?
            .ok_or_else(|| AppError::not_found("Generation", &generation_id))?;
        // Repair outputs are QC'd as well; the depth check below controls only the next repair.
        let settings = conn
            .query_row("SELECT settings_json FROM qc_settings WHERE project_id = ?1", [&generation.project_id], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .and_then(|raw| serde_json::from_str::<QcSettingsDto>(&raw).ok())
            .unwrap_or_default();
        if settings.auto_qc != "after_generation" {
            return Ok(());
        }
        let output_ids = repo::list_generation_outputs(&conn, &generation.id)?;
        let dna = repo::get_dna(&conn, &generation.project_id)?;
        (generation, output_ids, settings, dna)
    };
    let lock = project_automation_lock(&generation.project_id);
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let vision = settings
        .vision_provider_id
        .clone()
        .map(|provider_id| QcVisionRequest { provider_id, model: settings.vision_model.clone() });
    let original_request = {
        let conn = core.conn()?;
        generations::request_of(&conn, &generation.id)?
    };
    for asset_id in output_ids {
        let report = match run(
            core,
            QcRunRequest {
                project_id: generation.project_id.clone(),
                asset_id: asset_id.clone(),
                vision: vision.clone(),
            },
        ) {
            Ok(report) => report,
            Err(error) => {
                eprintln!(
                    "[qc] automatic QC failed project={} asset={asset_id}: {}",
                    generation.project_id, error.message
                );
                continue;
            }
        };
        if report.result != "fail" || settings.auto_repair_max == 0 {
            continue;
        }
        let repair_depth = {
            let conn = core.conn()?;
            repo::find_asset(&conn, &asset_id)?
                .and_then(|asset| asset.operation_json)
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
                .and_then(|value| value.get("repairDepth").and_then(Value::as_u64))
                .unwrap_or(0)
        };
        if repair_depth >= u64::from(settings.auto_repair_max) {
            continue;
        }
        let Some(primary_reference) = report.reference_asset_ids.first().cloned() else { continue };
        let prompt = build_repair_prompt(&dna, &report);
        let request = SubmitRequest {
            project_id: generation.project_id.clone(),
            provider_id: generation.provider_id.clone(),
            model_id: generation.model_id.clone(),
            purpose: "repair".into(),
            prompt: crate::dto::PromptBundle {
                compiler_version: "qc-domain".into(),
                positive_prompt: prompt,
                negative_prompt: String::new(),
                reference_instructions: "Use the first reference as the primary comparison.".into(),
                preservation_instructions: "Keep everything not explicitly listed in the QC repair prompt unchanged."
                    .into(),
                metadata: serde_json::Map::new(),
            },
            reference_asset_ids: vec![asset_id.clone(), primary_reference],
            params: crate::providers::GenerationParams {
                repair: Some(RepairParams { qc_report_id: report.id }),
                enhance: None,
                ..original_request.params.clone()
            },
            camera_id: generation.camera_id.clone(),
        };
        if let Err(error) = generations::submit(core, request) {
            eprintln!(
                "[qc] automatic repair failed project={} asset={asset_id}: {}",
                generation.project_id, error.message
            );
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::generations;
    use crate::services::projects;
    use crate::services::provider_settings;
    use crate::services::tests_support::{
        queue_harness, run_queue, test_create_villa, test_import, test_request, GOOD_KEY, TEST_PROVIDER,
    };

    fn automatic_repair_chain(max_repairs: u8) -> (usize, Vec<i64>, Vec<String>) {
        let h = queue_harness();
        provider_settings::set_api_key(&h.core, TEST_PROVIDER, GOOD_KEY).unwrap();
        let project = test_create_villa(&h.core, "QC automation");
        test_import(&h.core, h.tmp.path(), &project.id, "master.png", "master_architecture");
        projects::approve_master(&h.core, &project.id, true).unwrap();

        let mut settings = settings_get(&h.core, &project.id).unwrap();
        settings.auto_qc = "after_generation".into();
        settings.auto_repair_max = max_repairs;
        settings.vision_provider_id = Some(TEST_PROVIDER.into());
        settings.vision_model = Some("full".into());
        settings_set(&h.core, QcSettingsSetRequest { project_id: project.id.clone(), settings }).unwrap();

        generations::submit(&h.core, test_request(&project.id, TEST_PROVIDER, "full", &[], None)).unwrap();
        run_queue(&h.core);

        let reports = list(&h.core, QcListRequest { project_id: project.id.clone(), asset_id: None }).unwrap();
        let conn = h.core.conn().unwrap();
        let depths = {
            let mut stmt = conn
                .prepare("SELECT operation_json FROM assets WHERE project_id = ?1 AND operation = 'repair' ORDER BY id")
                .unwrap();
            stmt.query_map([&project.id], |row| row.get::<_, String>(0))
                .unwrap()
                .map(|row| {
                    let raw = row.unwrap();
                    serde_json::from_str::<Value>(&raw).unwrap()["repairDepth"].as_i64().unwrap()
                })
                .collect::<Vec<_>>()
        };
        let repaired_asset_ids = {
            let mut stmt = conn
                .prepare("SELECT id FROM assets WHERE project_id = ?1 AND operation = 'repair' ORDER BY id")
                .unwrap();
            stmt.query_map([&project.id], |row| row.get::<_, String>(0))
                .unwrap()
                .map(|row| row.unwrap())
                .collect::<Vec<_>>()
        };
        (reports.len(), depths, repaired_asset_ids)
    }

    #[test]
    fn automatic_qc_continues_repair_outputs_until_the_configured_depth() {
        let (reports, depths, repair_assets) = automatic_repair_chain(2);
        assert_eq!(reports, 3, "original plus both repair outputs are QC'd");
        assert_eq!(depths, vec![1, 2]);
        assert_eq!(repair_assets.len(), 2, "depth two output is QC'd but not repaired");

        let (reports, depths, repair_assets) = automatic_repair_chain(1);
        assert_eq!(reports, 2);
        assert_eq!(depths, vec![1]);
        assert_eq!(repair_assets.len(), 1);

        let (reports, depths, repair_assets) = automatic_repair_chain(0);
        assert_eq!(reports, 1);
        assert!(depths.is_empty());
        assert!(repair_assets.is_empty());
    }

    #[test]
    fn repair_prompt_matches_domain_snapshot() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/domain/test-vectors/repair-prompt.json");
        let vector: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let report: QcReportDto = serde_json::from_value(vector["report"].clone()).unwrap();
        assert_eq!(build_repair_prompt(&vector["dna"], &report), vector["expected"].as_str().unwrap());
    }

    #[test]
    fn vision_prompt_matches_domain_snapshot() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/domain/test-vectors/vision-prompt.json");
        let vector: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let purpose = vector["purpose"].as_str().unwrap();
        let (system, user) = build_vision_prompt(&vector["dna"], purpose);
        assert_eq!(system, vector["expected"]["system"].as_str().unwrap());
        assert_eq!(user, vector["expected"]["user"].as_str().unwrap());
    }

    #[test]
    fn vision_parser_skips_invalid_object_and_normalizes_values() {
        let text = r#"prefix {"scores":{"geometry":1}} actual {"scores":{"geometry":120.4,"material":-2,"openings":50.5,"context":75,"lighting":99},"artifacts":[{"label":"edge","severity":"high","box":[-1,0.25,2,0.5]}],"issues":[],"repairInstruction":"Fix it."}"#;
        let parsed = parse_vision_reply(text, "mock", "vision-1").unwrap();
        assert_eq!(parsed.scores.geometry, 100);
        assert_eq!(parsed.scores.material, 0);
        assert_eq!(parsed.scores.openings, 51);
        assert_eq!(parsed.artifacts[0].box_, Some([0.0, 0.25, 1.0, 0.5]));
    }
}
