//! Custom gateway (ADR-040): config from an injected environment and one generation through
//! the shared local mock HTTP server (no network).

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

use super::super::test_http::{MockServer, Reply};
use super::super::{GenerationParams, ImageProvider, PromptText, ProviderRequest};
use super::*;
use crate::secrets::FixedEnv;

const KEY: &str = "gw-TEST-secret-key-0123456789";
const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-1";

fn env(pairs: &[(&str, &str)]) -> FixedEnv {
    FixedEnv(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>())
}

fn request(model_id: &str) -> ProviderRequest {
    ProviderRequest {
        model_id: model_id.into(),
        prompt: PromptText {
            positive: "Townhouse at golden hour.".into(),
            negative: String::new(),
            reference_instructions: String::new(),
            preservation_instructions: String::new(),
        },
        references: vec![],
        params: GenerationParams {
            aspect_ratio: None,
            image_size: None,
            output_count: 1,
            seed: None,
            quality: None,
            enhance: None,
            repair: None,
            region: None,
        },
        api_key: Some(KEY.into()),
        mask: None,
    }
}

#[test]
fn needs_a_base_url_and_at_least_one_model() {
    let problem = |pairs: &[(&str, &str)]| config(&env(pairs)).base_url.unwrap_err();
    assert!(problem(&[]).contains("GATEWAY_BASE_URL"));
    let no_models = problem(&[(ENV_BASE_URL, "https://api.example.com/v1")]);
    assert!(no_models.contains("GATEWAY_IMAGE_MODEL"), "{no_models}");
    assert!(problem(&[(ENV_BASE_URL, "http://api.example.com/v1"), (ENV_IMAGE_MODEL, "m")]).contains("https"));
    assert!(problem(&[(ENV_BASE_URL, "https://a.b/v1"), (ENV_IMAGE_MODEL, "bad id")]).contains("GATEWAY_IMAGE_MODEL"));

    // Not set up: listed with no models, never makes a request, and says why.
    let p = provider(&env(&[]));
    assert!(p.config_problem().unwrap().contains("GATEWAY_BASE_URL"));
    assert!(p.info().models.is_empty());
    assert!(p.generate(&request("m")).unwrap_err().message.contains("GATEWAY_BASE_URL"));
}

#[test]
fn models_chat_and_defaults_come_from_the_environment() {
    let cfg = config(&env(&[
        (ENV_BASE_URL, " https://api.example.com/v1/ "),
        (ENV_IMAGE_MODEL, "gpt-image-2, flux-pro ,gpt-image-2"),
    ]));
    assert_eq!(cfg.base_url.as_deref(), Ok("https://api.example.com/v1"));
    let ids: Vec<_> = cfg.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["gpt-image-2", "flux-pro"], "in order, deduplicated");
    assert!(cfg.models.iter().all(|m| m.image_sizes.is_empty() && m.price_hint.is_none()), "no tiers, no prices");
    assert_eq!(cfg.chat_model, None, "Enhance prompt is off until GATEWAY_CHAT_MODEL is set");
    assert_eq!(cfg.default_size.as_deref(), Some("1024x1024"));
    let info = OpenAiProvider::from_config(cfg).info();
    assert_eq!((info.id, info.label), ("gateway", "Custom gateway (OpenAI-compatible)"));
    assert!(info.requires_api_key);

    let with_chat = config(&env(&[
        (ENV_BASE_URL, "https://api.example.com/v1"),
        (ENV_IMAGE_MODEL, "flux-pro"),
        (ENV_CHAT_MODEL, "claude-sonnet-5"),
        (ENV_IMAGE_SIZE, "auto"),
    ]));
    assert_eq!(with_chat.chat_model.as_deref(), Some("claude-sonnet-5"));
    assert_eq!(with_chat.default_size, None);
}

#[test]
fn generates_through_the_openai_images_endpoint() {
    let data: Vec<Value> = vec![json!({ "b64_json": B64.encode(PNG_BYTES) })];
    let mut server =
        MockServer::start("/v1", vec![Reply::Json(200, json!({ "created": 1, "data": data }).to_string())]);
    let p = provider(&env(&[(ENV_BASE_URL, server.base_url.as_str()), (ENV_IMAGE_MODEL, "flux-pro")]));
    let out = p.generate(&request("flux-pro")).unwrap();
    assert_eq!(out.images[0].bytes, PNG_BYTES);
    let recorded = server.requests();
    assert_eq!(recorded[0].path, "/v1/images/generations");
    assert_eq!(recorded[0].headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
    let body: Value = serde_json::from_str(&recorded[0].body).unwrap();
    assert_eq!(body["model"], "flux-pro");
}
