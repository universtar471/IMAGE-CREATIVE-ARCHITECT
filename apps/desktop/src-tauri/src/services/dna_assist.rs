//! Proposal-only AI DNA assistance through the HHTECH chat gateway (ADR-030), including the
//! source-image analysis of mode `source` (ADR-040, UI-5).
use std::io::Cursor;
use std::time::Instant;

use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::domain::{AssetRole, GenerationPurpose, GenerationStatus};
use crate::error::{AppError, AppResult, ErrorCode};
use crate::providers::{hhtech, ChatRequest, ProviderError, ProviderErrorKind};
use crate::repositories as repo;
use crate::services::{provider_settings, AppCore};
use crate::util::{self, prefix};

pub const MAX_BRIEF_CHARS: usize = 1_000;
pub const MAX_REFERENCES: usize = 3;
pub const MODES: [&str; 5] = ["brief", "images", "master", "translate", "source"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistRequest {
    pub project_id: String,
    pub mode: String,
    pub scope: String,
    pub brief: Option<String>,
    #[serde(default)]
    pub reference_asset_ids: Vec<String>,
    pub catalog: Value,
    pub system_prompt: String,
    #[serde(default)]
    pub translate: Vec<TranslateItem>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslateItem {
    pub path: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistResult {
    pub raw: String,
    pub model_id: String,
    /// Omitted when the gateway reports none: the webview schema has `usage?`, not `null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<AssistUsage>,
    pub generation_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

pub fn run(core: &AppCore, request: AssistRequest) -> AppResult<AssistResult> {
    validate_request(&request)?;
    let (project, refs) = {
        let conn = core.conn()?;
        let project = repo::get_project(&conn, &request.project_id)?;
        let requested = if request.mode == "master" {
            let Some(asset_id) = project.active_master_asset_id.clone() else {
                return Err(AppError::invalid_state(
                    "Approve a master image before using AI DNA assist in master mode.",
                ));
            };
            if project.master_approved_at.is_none() {
                return Err(AppError::invalid_state(
                    "Approve a master image before using AI DNA assist in master mode.",
                ));
            }
            vec![asset_id]
        } else {
            request.reference_asset_ids.clone()
        };
        let mut refs = Vec::new();
        for id in requested {
            let asset = repo::find_asset(&conn, &id)?.ok_or_else(|| AppError::not_found("Asset", &id))?;
            if asset.project_id != request.project_id {
                return Err(AppError::validation("Reference image must belong to this project."));
            }
            if request.mode == "master" && asset.role != AssetRole::MasterArchitecture {
                return Err(AppError::invalid_state("The approved master asset is unavailable."));
            }
            refs.push(asset);
        }
        (project, refs)
    };

    let provider = core.providers.get(hhtech::ID).ok_or_else(|| AppError::not_found("Provider", hhtech::ID))?;
    let model = hhtech::assist_model(core.env.as_ref())
        .map_err(|message| AppError::new(ErrorCode::ProviderNotConfigured, message))?;
    if provider.config_problem().is_some() {
        return Err(provider_settings::not_configured(provider.as_ref()));
    }
    let key = provider_settings::key_for(core, provider.as_ref())
        .ok_or_else(|| provider_settings::not_configured(provider.as_ref()))?;
    let images = refs
        .iter()
        .map(|asset| {
            let path = core.storage.resolve(&request.project_id, &asset.managed_rel_path)?;
            let bytes = std::fs::read(path)
                .map_err(|_| AppError::new(ErrorCode::IoError, "Could not read a managed reference image."))?;
            downscale_jpeg(&bytes)
                .map_err(|_| AppError::new(ErrorCode::UnsupportedFile, "Reference asset is not a readable image."))
        })
        .collect::<AppResult<Vec<_>>>()?;

    let generation_id = util::new_id(prefix::GENERATION);
    let now = core.now_iso();
    let safe_request = json!({"mode":request.mode,"scope":request.scope,"referenceCount":images.len(),"modelId":model});
    let row = repo::GenerationRow {
        id: generation_id.clone(),
        project_id: project.id,
        provider_id: hhtech::ID.into(),
        model_id: model.clone(),
        purpose: GenerationPurpose::Assist,
        status: GenerationStatus::Running,
        request_json: safe_request.to_string(),
        parent_asset_id: None,
        error_kind: None,
        error_message: None,
        error_retryable: None,
        started_at: now.clone(),
        finished_at: None,
        duration_ms: None,
        created_at: now.clone(),
        updated_at: now,
        camera_id: None,
        batch_id: None,
        job_id: None,
        job_started_at: None,
        enhance_check_json: None,
    };
    repo::insert_generation(&*core.conn()?, &row)?;
    let started = Instant::now();
    let result = call_provider(provider.as_ref(), &key.value, &model, &request, &images);
    let duration = started.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let now = core.now_iso();
    match result {
        Ok((raw, usage)) => {
            repo::finish_generation(
                &*core.conn()?,
                &generation_id,
                GenerationStatus::Completed,
                None,
                &now,
                Some(duration),
            )?;
            Ok(AssistResult { raw, model_id: model, usage, generation_id })
        }
        Err(error) => {
            let kind = if error.code == ErrorCode::ProviderQuota { "quota" } else { "provider_error" };
            let generation_error =
                repo::GenerationErrorRow { kind: kind.into(), message: error.message.clone(), retryable: false };
            let _ = repo::finish_generation(
                &*core.conn()?,
                &generation_id,
                GenerationStatus::Failed,
                Some(&generation_error),
                &now,
                Some(duration),
            );
            Err(error)
        }
    }
}

fn validate_request(request: &AssistRequest) -> AppResult<()> {
    if !MODES.contains(&request.mode.as_str())
        || !["interior", "building", "context", "lighting"].contains(&request.scope.as_str())
    {
        return Err(AppError::validation("Unknown AI assist mode or scope."));
    }
    if request.brief.as_ref().is_some_and(|s| s.chars().count() > MAX_BRIEF_CHARS) {
        return Err(AppError::validation("Brief is longer than 1000 characters."));
    }
    if request.reference_asset_ids.len() > MAX_REFERENCES {
        return Err(AppError::validation("Choose no more than 3 reference images."));
    }
    if request.mode == "source" && request.reference_asset_ids.len() != 1 {
        return Err(AppError::validation("Source-image analysis takes exactly one image."));
    }
    if request.system_prompt.chars().count() > 20_000
        || request.translate.iter().any(|t| t.text.chars().count() > 2_000)
    {
        return Err(AppError::validation("AI assist prompt is too long."));
    }
    Ok(())
}

fn downscale_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes).map_err(|e| e.to_string())?.thumbnail(1024, 1024).to_rgb8();
    let mut output = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image).write_to(&mut output, ImageFormat::Jpeg).map_err(|e| e.to_string())?;
    Ok(output.into_inner())
}

fn call_provider(
    provider: &dyn crate::providers::ImageProvider,
    key: &str,
    model: &str,
    request: &AssistRequest,
    images: &[Vec<u8>],
) -> AppResult<(String, Option<AssistUsage>)> {
    let chat = ChatRequest {
        model: model.into(),
        system: request.system_prompt.clone(),
        user: user_text(request),
        images: images.iter().map(|image| ("image/jpeg".into(), image.clone())).collect(),
        json_object: true,
        temperature: 0.2,
    };
    let raw = provider.chat_with_model(&chat, Some(key)).map_err(map_provider_error)?;
    if serde_json::from_str::<Value>(&raw).is_err() && !raw.trim_start().starts_with("```") {
        return Err(AppError::new(ErrorCode::ProviderError, "AI DNA assist provider returned an invalid reply."));
    }
    Ok((raw, None))
}

fn map_provider_error(error: ProviderError) -> AppError {
    let lower = error.message.to_ascii_lowercase();
    let code = if matches!(error.kind, ProviderErrorKind::Auth)
        || lower.contains("credit")
        || lower.contains("quota")
        || lower.contains("http 402")
    {
        ErrorCode::ProviderQuota
    } else {
        ErrorCode::ProviderError
    };
    AppError::new(code, error.message)
}

fn user_text(request: &AssistRequest) -> String {
    let brief = request.brief.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if request.mode == "source" {
        return match brief {
            Some(wish) => format!("Analyse the attached source image.\n\nUser wish:\n{wish}"),
            None => "Analyse the attached source image. The user gave no wish: keep the design as it is.".into(),
        };
    }
    let mut parts = Vec::new();
    if let Some(brief) = brief {
        parts.push(format!("Brief:\n{brief}"));
    }
    if !request.translate.is_empty() {
        parts.push(format!(
            "Translate only these paths:\n{}",
            serde_json::to_string(&request.translate).unwrap_or_default()
        ));
    }
    if parts.is_empty() {
        "Infer suggestions from the attached reference images.".into()
    } else {
        parts.join("\n\n")
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::providers::{
        ModelCapabilities, ProviderInfo, ProviderKind, ProviderOutput, ProviderRegistry, ProviderRequest,
    };
    use crate::secrets::MemorySecretStore;
    use crate::services::tests_support::{test_create_villa, test_import};

    pub(crate) const SOURCE_REPLY: &str = r#"{"observed":["two-storey villa"],"inferred":[{"text":"rear terrace","confidence":0.4}],"fields":[],"requestEn":"Make it warmer","keepEn":["massing"]}"#;

    /// Stands in for the HHTECH gateway: records the chat request, answers a canned reply.
    #[derive(Default)]
    pub(crate) struct FakeGateway {
        last: Mutex<Option<(String, String, usize, bool)>>,
    }

    impl crate::providers::ImageProvider for FakeGateway {
        fn info(&self) -> ProviderInfo {
            ProviderInfo {
                id: hhtech::ID,
                label: "HHTECH (test)",
                kind: ProviderKind::Remote,
                requires_api_key: true,
                models: Vec::<ModelCapabilities>::new(),
            }
        }

        fn generate(&self, _request: &ProviderRequest) -> Result<ProviderOutput, ProviderError> {
            Err(ProviderError::new(ProviderErrorKind::InvalidRequest, "not used"))
        }

        fn test_connection(&self, _api_key: Option<&str>) -> Result<String, ProviderError> {
            Ok("ok".into())
        }

        fn chat_with_model(&self, request: &ChatRequest, api_key: Option<&str>) -> Result<String, ProviderError> {
            assert_eq!(api_key, Some("fake-gateway-key"));
            *self.last.lock().unwrap() =
                Some((request.system.clone(), request.user.clone(), request.images.len(), request.json_object));
            Ok(SOURCE_REPLY.into())
        }
    }

    pub(crate) fn source_request(project_id: &str, ids: &[&str], brief: Option<&str>) -> AssistRequest {
        serde_json::from_value(json!({
            "projectId": project_id, "mode": "source", "scope": "building", "brief": brief,
            "referenceAssetIds": ids, "catalog": { "scope": "building", "fields": [] },
            "systemPrompt": "Analyse the source image."
        }))
        .unwrap()
    }

    #[test]
    fn source_mode_takes_exactly_one_image() {
        for ids in [vec![], vec!["AST_1", "AST_2"]] {
            let err = validate_request(&source_request("PRJ_1", &ids, Some("warmer"))).unwrap_err();
            assert_eq!(err.code, ErrorCode::ValidationError, "{ids:?}");
        }
        assert!(validate_request(&source_request("PRJ_1", &["AST_1"], Some("warmer"))).is_ok());
        assert!(validate_request(&source_request("PRJ_1", &["AST_1"], None)).is_ok());
    }

    #[test]
    fn source_user_text_carries_the_wish() {
        let text = user_text(&source_request("PRJ_1", &["AST_1"], Some("  Ấm hơn  ")));
        assert!(text.contains("source image") && text.ends_with("User wish:\nẤm hơn"), "{text}");
        assert!(user_text(&source_request("PRJ_1", &["AST_1"], None)).contains("no wish"));
    }

    #[test]
    fn source_request_roundtrips_through_the_gateway() {
        let tmp = tempfile::tempdir().unwrap();
        let gateway = Arc::new(FakeGateway::default());
        let registry = ProviderRegistry::new(vec![gateway.clone()]);
        let core =
            AppCore::open_with(&tmp.path().join("data"), registry, Arc::new(MemorySecretStore::default())).unwrap();
        let project = test_create_villa(&core, "Source villa");
        let asset = test_import(&core, tmp.path(), &project.id, "source.png", "master_architecture");
        provider_settings::set_api_key(&core, hhtech::ID, "fake-gateway-key").unwrap();

        let result = run(&core, source_request(&project.id, &[&asset.id], Some("Make it warmer"))).unwrap();
        assert_eq!(result.raw, SOURCE_REPLY);
        let (system, user, images, json_object) = gateway.last.lock().unwrap().clone().unwrap();
        assert_eq!(system, "Analyse the source image.");
        assert!(user.ends_with("User wish:\nMake it warmer"));
        assert_eq!((images, json_object), (1, true));

        let rows = repo::list_generations(&core.conn().unwrap(), &project.id).unwrap();
        let row = rows.into_iter().find(|g| g.id == result.generation_id).unwrap();
        assert_eq!(row.purpose, GenerationPurpose::Assist);
        assert_eq!(row.status, GenerationStatus::Completed);
        assert!(!row.request_json.contains("fake-gateway-key") && !row.request_json.contains("warmer"));
        assert!(row.request_json.contains(r#""mode":"source""#));

        // An asset of another project is refused before any call.
        let other = test_create_villa(&core, "Other villa");
        let err = run(&core, source_request(&other.id, &[&asset.id], None)).unwrap_err();
        assert_eq!(err.code, ErrorCode::ValidationError);
    }
}
