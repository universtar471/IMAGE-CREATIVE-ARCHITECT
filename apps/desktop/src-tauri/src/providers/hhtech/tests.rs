//! HHTECH gateway tests: config from an injected environment, and the adapter in gateway mode
//! against the shared local mock HTTP server (no network). The `#[ignore]` live tests at the
//! bottom call the real gateway and are run by hand only.

use std::collections::HashMap;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

use super::super::test_http::{MockServer, Reply};
use super::super::{
    GenerationParams, ImageProvider, PromptText, ProviderError, ProviderErrorKind, ProviderRequest, ReferenceImage,
};
use super::*;
use crate::secrets::FixedEnv;

const KEY: &str = "hh-TEST-secret-key-0123456789";
const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-1";

fn env(pairs: &[(&str, &str)]) -> FixedEnv {
    FixedEnv(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>())
}

fn serve(replies: Vec<Reply>) -> MockServer {
    MockServer::start("/v1", replies)
}

/// The gateway adapter pointed at `server`, with optional extra settings.
fn gateway(server: &MockServer, extra: &[(&str, &str)]) -> OpenAiProvider {
    let mut pairs = vec![(ENV_BASE_URL, server.base_url.as_str())];
    pairs.extend_from_slice(extra);
    provider(&env(&pairs))
}

fn b64_reply(images: &[&[u8]]) -> Reply {
    let data: Vec<Value> = images.iter().map(|b| json!({ "b64_json": B64.encode(b) })).collect();
    Reply::Json(200, json!({ "created": 1, "data": data }).to_string())
}

fn prompt() -> PromptText {
    PromptText {
        positive: "Villa at dusk.".into(),
        negative: String::new(),
        reference_instructions: String::new(),
        preservation_instructions: String::new(),
    }
}

fn reference(n: u8) -> ReferenceImage {
    ReferenceImage {
        asset_id: format!("AST_{n}"),
        role: "master_architecture".into(),
        mime_type: "image/png".into(),
        bytes: format!("reference-bytes-{n}").into_bytes(),
    }
}

fn request(references: Vec<ReferenceImage>) -> ProviderRequest {
    ProviderRequest {
        model_id: "gpt-image-2".into(),
        prompt: prompt(),
        references,
        params: GenerationParams {
            aspect_ratio: None,
            image_size: None,
            output_count: 1,
            seed: None,
            quality: None,
            enhance: None,
        },
        api_key: Some(KEY.into()),
    }
}

fn assert_key_free(error: &ProviderError) {
    assert!(!error.message.contains(KEY), "key leaked: {}", error.message);
    assert!(!format!("{error:?}").contains(KEY));
}

// ---------------------------------------------------------------- several outputs

fn request_n(n: u32) -> ProviderRequest {
    let mut r = request(vec![]);
    r.params.output_count = n;
    r
}

#[test]
fn several_outputs_run_as_parallel_single_image_calls() {
    let mut server = serve(vec![b64_reply(&[b"png-a"]), b64_reply(&[b"png-b"])]);
    let out = gateway(&server, &[]).generate(&request_n(2)).unwrap();
    assert_eq!(out.images.len(), 2);
    assert_eq!(out.meta["requested"], 2);
    assert_eq!(out.meta["returned"], 2);
    assert!(out.meta.get("failedCalls").is_none());
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    for r in &requests {
        let body: Value = serde_json::from_str(&r.body).unwrap();
        assert_eq!(body["n"], 1, "each call asks for one image: {body}");
    }
}

#[test]
fn a_failed_call_among_several_keeps_the_other_images() {
    let mut server = serve(vec![
        b64_reply(&[b"png-a"]),
        Reply::Json(500, json!({ "error": { "message": "upstream busy" } }).to_string()),
    ]);
    let out = gateway(&server, &[]).generate(&request_n(2)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.meta["failedCalls"], 1);
    assert_eq!(server.requests().len(), 2);
}

#[test]
fn all_calls_failing_returns_the_error_kind() {
    let reply = || Reply::Json(401, json!({ "error": { "message": "bad key" } }).to_string());
    let mut server = serve(vec![reply(), reply()]);
    let err = gateway(&server, &[]).generate(&request_n(2)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Auth, "{err:?}");
    assert_key_free(&err);
    assert_eq!(server.requests().len(), 2);
}

#[test]
fn a_200_without_an_image_quotes_what_the_gateway_said() {
    // Seen live: the gateway sends 200 headers and keep-alive newlines at once, so a failure
    // after a long render arrives as an error object inside a 200 body.
    let mut server = serve(vec![
        Reply::Json(
            200,
            format!(
                "

{}",
                json!({ "error": { "message": format!("upstream timed out {KEY}") } })
            ),
        ),
        Reply::Json(200, json!({ "created": 1, "data": [] }).to_string()),
    ]);
    let p = gateway(&server, &[]);
    let err = p.generate(&request(vec![])).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::BadResponse);
    assert!(err.message.contains("upstream timed out"), "{err:?}");
    assert_key_free(&err);
    let err = p.generate(&request(vec![])).unwrap_err();
    assert!(err.message.contains("empty"), "{err:?}");
    assert_eq!(server.requests().len(), 2);
}

#[test]
fn the_gateway_timeouts_are_left_to_the_user_but_official_openai_retries() {
    let hhtech = provider(&env(&[(ENV_BASE_URL, "https://gw.example.com/v1")]));
    assert!(!hhtech.auto_retries_timeouts());
    assert!(OpenAiProvider::new().auto_retries_timeouts());
}

#[test]
fn timeout_defaults_to_ten_minutes_and_is_configurable() {
    let base = (ENV_BASE_URL, "https://gw.example.com/v1");
    assert_eq!(config(&env(&[base])).generate_timeout.as_secs(), 600);
    assert_eq!(config(&env(&[base, (ENV_TIMEOUT_SECS, " 900 ")])).generate_timeout.as_secs(), 900);
    for bad in ["5", "abc", "99999"] {
        let problem = config(&env(&[base, (ENV_TIMEOUT_SECS, bad)])).base_url.unwrap_err();
        assert!(problem.contains("HHTECH_TIMEOUT_SECS"), "{bad}: {problem}");
    }
}

// ---------------------------------------------------------------- config

#[test]
fn defaults_and_info() {
    let cfg = config(&env(&[(ENV_BASE_URL, " https://hhtechapi.com/v1/ ")]));
    assert_eq!(cfg.base_url.as_deref(), Ok("https://hhtechapi.com/v1"), "trimmed, no trailing slash");
    assert_eq!(cfg.default_size.as_deref(), Some("1024x1024"));
    assert_eq!(cfg.quality, "medium");
    assert_eq!(cfg.chat_model.as_deref(), Some("claude-sonnet-5"));
    let info = OpenAiProvider::from_config(cfg).info();
    assert_eq!((info.id, info.label), ("hhtech", "HHTECH (OpenAI-compatible)"));
    assert!(info.requires_api_key);
    assert_eq!(info.kind, super::super::ProviderKind::Remote);
    // Unset HHTECH_IMAGE_MODEL: the full catalog, best first.
    let ids: Vec<_> = info.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, catalog::CATALOG.iter().map(|e| e.id).collect::<Vec<_>>());
    assert_eq!(ids[0], "gpt-image-2.5-sunburst");
    let model = &info.models[0];
    assert_eq!(model.label, "GPT Image 2.5 Sunburst · 1K 280đ / 2K 600đ / 4K 900đ");
    assert_eq!(model.image_sizes, ["1K", "2K", "4K"], "real billed tiers on this gateway");
    assert_eq!(model.aspect_ratios.len(), 10);
    assert!(model.max_outputs <= 4 && model.max_outputs >= 1);
    assert!(!model.supports_seed && !model.supports_negative_prompt);
}

#[test]
fn the_image_model_setting_restricts_and_orders_the_catalog() {
    let base = (ENV_BASE_URL, "https://gw.example.com/v1");
    // Existing users' `.env` keeps working: one catalog model, now with tiers and prices.
    let cfg = config(&env(&[base, (ENV_IMAGE_MODEL, "gpt-image-2")]));
    assert!(cfg.base_url.is_ok());
    assert_eq!(cfg.models.len(), 1);
    assert_eq!(cfg.models[0].label, "GPT Image 2 · 1K 180đ / 2K 500đ / 4K 800đ");
    assert_eq!(cfg.models[0].quality_options, ["low", "medium", "high"]);

    let cfg = config(&env(&[base, (ENV_IMAGE_MODEL, "gemini-3-pro-image, my-custom-model ,gpt-image-2.5-flare")]));
    let ids: Vec<_> = cfg.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["gemini-3-pro-image", "my-custom-model", "gpt-image-2.5-flare"], "env order wins");
    let custom = &cfg.models[1];
    assert_eq!(custom.label, "my-custom-model");
    assert!(custom.image_sizes.is_empty() && custom.price_hint.is_none(), "unknown ids: no tiers, as before");
    assert!(cfg.models[0].quality_options.is_empty(), "no quality for Gemini");
    assert_eq!(cfg.routes["gemini-3-pro-image"].tiers, super::super::openai::TierStrategy::IdSuffix);
    assert_eq!(cfg.routes["my-custom-model"], Route::default());
}

#[test]
fn model_list_size_quality_and_chat_come_from_the_environment() {
    let cfg = config(&env(&[
        (ENV_BASE_URL, "https://gw.example.com/v1"),
        (ENV_IMAGE_MODEL, " gpt-image-2 , gpt-image-2.5-flare,,gpt-image-2 "),
        (ENV_IMAGE_SIZE, "1536x1024"),
        (ENV_IMAGE_QUALITY, "High"),
        (ENV_CHAT_MODEL, "gpt-5-mini"),
    ]));
    assert!(cfg.base_url.is_ok());
    let ids: Vec<_> = cfg.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["gpt-image-2", "gpt-image-2.5-flare"], "trimmed, deduplicated, in order");
    assert_eq!(cfg.default_size.as_deref(), Some("1536x1024"));
    assert_eq!(cfg.quality, "high");
    assert_eq!(cfg.chat_model.as_deref(), Some("gpt-5-mini"));
    assert_eq!(config(&env(&[(ENV_BASE_URL, "https://x.y/v1"), (ENV_IMAGE_SIZE, "auto")])).default_size, None);
}

#[test]
fn missing_or_unsafe_settings_make_the_provider_not_configured() {
    let problem = |pairs: &[(&str, &str)]| config(&env(pairs)).base_url.unwrap_err();
    assert!(problem(&[]).contains("HHTECH_BASE_URL"));
    assert!(problem(&[(ENV_BASE_URL, "   ")]).contains("HHTECH_BASE_URL"));
    assert!(problem(&[(ENV_BASE_URL, "http://gw.example.com/v1")]).contains("https"));
    assert!(problem(&[(ENV_BASE_URL, "ftp://gw.example.com/v1")]).contains("https"));
    assert!(problem(&[(ENV_BASE_URL, "not a url")]).contains("https"));
    assert!(problem(&[(ENV_BASE_URL, "https://user:pw@gw.example.com/v1")]).contains("https"));
    let ok = "https://gw.example.com/v1";
    assert!(problem(&[(ENV_BASE_URL, ok), (ENV_IMAGE_SIZE, "big")]).contains("HHTECH_IMAGE_SIZE"));
    assert!(problem(&[(ENV_BASE_URL, ok), (ENV_IMAGE_MODEL, "gpt image")]).contains("HHTECH_IMAGE_MODEL"));
    assert!(problem(&[(ENV_BASE_URL, ok), (ENV_CHAT_MODEL, "a b")]).contains("HHTECH_CHAT_MODEL"));
    assert!(problem(&[(ENV_BASE_URL, ok), (ENV_IMAGE_QUALITY, "very high")]).contains("HHTECH_IMAGE_QUALITY"));
    // Loopback http is allowed (tests, local gateways).
    assert!(config(&env(&[(ENV_BASE_URL, "http://127.0.0.1:9/v1")])).base_url.is_ok());
    assert!(config(&env(&[(ENV_BASE_URL, "http://localhost:8080/v1")])).base_url.is_ok());

    // A provider that is not set up never makes a request, and says why.
    let p = provider(&env(&[]));
    assert!(p.config_problem().unwrap().contains("HHTECH_BASE_URL"));
    let err = p.generate(&request(vec![])).unwrap_err();
    assert!(err.message.contains("HHTECH_BASE_URL"), "{err:?}");
    assert!(p.test_connection(Some(KEY)).unwrap_err().message.contains("HHTECH_BASE_URL"));
    assert!(p.chat("s", "u", Some(KEY)).unwrap_err().message.contains("HHTECH_BASE_URL"));
    assert_eq!(p.info().models.len(), catalog::CATALOG.len(), "still listed with the catalog");
}

// ---------------------------------------------------------------- images

#[test]
fn generations_post_the_gateway_json_shape() {
    let mut server = serve(vec![b64_reply(&[PNG_BYTES])]);
    let out = gateway(&server, &[]).generate(&request(vec![])).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].bytes, PNG_BYTES);
    assert_eq!(out.images[0].mime_type, "image/png");
    let recorded = server.requests();
    assert_eq!(recorded.len(), 1);
    let req = &recorded[0];
    assert_eq!((req.method.as_str(), req.path.as_str()), ("POST", "/v1/images/generations"));
    assert_eq!(req.headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
    let body: Value = serde_json::from_str(&req.body).unwrap();
    assert_eq!(
        body,
        json!({
            "model": "gpt-image-2",
            "prompt": "Villa at dusk.",
            "size": "1024x1024",
            "quality": "medium",
            "n": 1,
            "response_format": "b64_json"
        })
    );
    assert_eq!(out.meta["size"], "1024x1024");
    assert!(!out.meta.to_string().contains(KEY));
}

#[test]
fn aspect_ratio_picks_the_size_and_the_default_size_keeps_its_ratio() {
    let size_sent = |ratio: Option<&str>, extra: &[(&str, &str)]| {
        let mut server = serve(vec![b64_reply(&[PNG_BYTES])]);
        let mut req = request(vec![]);
        req.params.aspect_ratio = ratio.map(str::to_string);
        gateway(&server, extra).generate(&req).unwrap();
        let body: Value = serde_json::from_str(&server.requests()[0].body).unwrap();
        body.get("size").cloned()
    };
    assert_eq!(size_sent(Some("16:9"), &[]), Some(json!("1536x864")));
    assert_eq!(size_sent(Some("1:1"), &[(ENV_IMAGE_SIZE, "2048x2048")]), Some(json!("2048x2048")));
    assert_eq!(size_sent(None, &[(ENV_IMAGE_SIZE, "1536x1024")]), Some(json!("1536x1024")));
    assert_eq!(size_sent(Some("1:1"), &[(ENV_IMAGE_SIZE, "1536x1024")]), Some(json!("1024x1024")));
    assert_eq!(size_sent(None, &[(ENV_IMAGE_SIZE, "auto")]), None);
}

/// What one generate call sent: path, the `model` / `size` / `quality` fields (JSON body or
/// multipart parts) and the output meta.
struct Sent {
    path: String,
    model: Option<String>,
    size: Option<String>,
    quality: Option<String>,
    meta: Value,
}

/// The value of a multipart text part, e.g. `name="model"` → `gemini-3-pro-image-2k`.
fn form_field(body: &str, name: &str) -> Option<String> {
    let start = body.find(&format!("name=\"{name}\""))?;
    let value = &body[start..];
    let value = &value[value.find("\r\n\r\n")? + 4..];
    Some(value[..value.find("\r\n")?].to_string())
}

fn send_with(
    model: &str,
    ratio: Option<&str>,
    tier: Option<&str>,
    quality: Option<&str>,
    references: Vec<ReferenceImage>,
    extra: &[(&str, &str)],
) -> Sent {
    let mut server = serve(vec![b64_reply(&[PNG_BYTES])]);
    let mut req = request(references);
    req.model_id = model.into();
    req.params.aspect_ratio = ratio.map(str::to_string);
    req.params.image_size = tier.map(str::to_string);
    req.params.quality = quality.map(str::to_string);
    let out = gateway(&server, extra).generate(&req).unwrap();
    let recorded = &server.requests()[0];
    let (model, size, quality) = if recorded.path.ends_with("/edits") {
        (form_field(&recorded.body, "model"), form_field(&recorded.body, "size"), form_field(&recorded.body, "quality"))
    } else {
        let body: Value = serde_json::from_str(&recorded.body).unwrap();
        let field = |name: &str| body.get(name).and_then(Value::as_str).map(str::to_string);
        (field("model"), field("size"), field("quality"))
    };
    Sent { path: recorded.path.clone(), model, size, quality, meta: out.meta }
}

#[test]
fn gpt_tiers_set_the_size_from_ratio_and_tier_with_the_base_id() {
    let cases = [
        (Some("1:1"), "1K", "1024x1024"),
        (Some("1:1"), "2K", "2048x2048"),
        (Some("1:1"), "4K", "3840x3840"),
        (Some("16:9"), "1K", "1024x576"),
        (Some("16:9"), "2K", "2048x1152"),
        (Some("16:9"), "4K", "3840x2160"),
        (Some("2:3"), "2K", "1360x2048"),
        (Some("21:9"), "4K", "3840x1648"),
        // No ratio: the default size's ratio (1:1 for 1024x1024).
        (None, "2K", "2048x2048"),
    ];
    for (ratio, tier, size) in cases {
        let sent = send_with("gpt-image-2.5-sunburst", ratio, Some(tier), None, vec![], &[]);
        assert_eq!(sent.path, "/v1/images/generations");
        assert_eq!(sent.model.as_deref(), Some("gpt-image-2.5-sunburst"), "no suffix for GPT");
        assert_eq!(sent.size.as_deref(), Some(size), "{ratio:?} {tier}");
        assert_eq!(sent.meta["tier"], tier);
        assert_eq!(sent.meta["requestModel"], "gpt-image-2.5-sunburst");
    }
    // Edits use the same base id and the computed size.
    let sent = send_with("gpt-image-2", Some("4:3"), Some("4K"), None, vec![reference(1)], &[]);
    assert_eq!(sent.path, "/v1/images/edits");
    assert_eq!((sent.model.as_deref(), sent.size.as_deref()), (Some("gpt-image-2"), Some("3840x2880")));
    // Without a ratio the tier keeps the ratio of HHTECH_IMAGE_SIZE.
    let sent = send_with("gpt-image-2", None, Some("2K"), None, vec![], &[(ENV_IMAGE_SIZE, "1536x1024")]);
    assert_eq!(sent.size.as_deref(), Some("2048x1360"));
}

#[test]
fn no_tier_falls_back_to_the_configured_size() {
    let sent = send_with("gpt-image-2", None, None, None, vec![], &[(ENV_IMAGE_SIZE, "1536x1024")]);
    assert_eq!(sent.size.as_deref(), Some("1536x1024"));
    assert_eq!(sent.meta["tier"], Value::Null);
    assert_eq!(sent.meta["requestModel"], "gpt-image-2");
}

#[test]
fn gemini_tiers_are_id_suffixes_on_both_endpoints_and_size_keeps_the_aspect() {
    for references in [vec![], vec![reference(1)]] {
        let endpoint = if references.is_empty() { "/v1/images/generations" } else { "/v1/images/edits" };
        for (tier, model, size) in
            [("2K", "gemini-3-pro-image-2k", "2048x1152"), ("4K", "gemini-3-pro-image-4k", "3840x2160")]
        {
            let sent = send_with("gemini-3-pro-image", Some("16:9"), Some(tier), None, references.clone(), &[]);
            assert_eq!(sent.path, endpoint);
            assert_eq!(sent.model.as_deref(), Some(model), "{endpoint} {tier}");
            assert!(!model.contains("-edit"), "-edit ids returned 502 live");
            assert_eq!(sent.size.as_deref(), Some(size));
            assert_eq!(sent.quality, None, "quality is never sent to Gemini");
            assert_eq!(sent.meta["requestModel"], model);
            assert_eq!(sent.meta["model"], "gemini-3-pro-image");
            assert_eq!(sent.meta["tier"], tier);
            assert_eq!(sent.meta["quality"], Value::Null);
        }
    }
}

#[test]
fn gemini_without_a_tier_still_sends_the_2k_id_never_the_bare_base_id() {
    for references in [vec![], vec![reference(1)]] {
        let sent = send_with("gemini-3.1-flash-image", Some("1:1"), None, None, references, &[]);
        assert_eq!(sent.model.as_deref(), Some("gemini-3.1-flash-image-2k"));
        assert_eq!(sent.size.as_deref(), Some("2048x2048"));
        assert_eq!(sent.meta["tier"], "2K");
    }
}

#[test]
fn gpt_quality_is_the_choice_else_the_configured_default() {
    let sent = send_with("gpt-image-2.5-flare", Some("1:1"), Some("1K"), Some("high"), vec![], &[]);
    assert_eq!(sent.quality.as_deref(), Some("high"));
    assert_eq!(sent.meta["quality"], "high");
    let sent = send_with("gpt-image-2.5-flare", Some("1:1"), Some("1K"), None, vec![], &[]);
    assert_eq!(sent.quality.as_deref(), Some("medium"), "HHTECH_IMAGE_QUALITY default");
    let sent = send_with("gpt-image-2", None, None, None, vec![reference(1)], &[(ENV_IMAGE_QUALITY, "low")]);
    assert_eq!(sent.quality.as_deref(), Some("low"));
    let sent = send_with("gpt-image-2", None, None, Some("medium"), vec![reference(1)], &[(ENV_IMAGE_QUALITY, "low")]);
    assert_eq!(sent.quality.as_deref(), Some("medium"));
}

#[test]
fn tiers_and_quality_the_model_lacks_are_rejected_before_any_call() {
    let reject = |model: &str, tier: Option<&str>, quality: Option<&str>, extra: &[(&str, &str)]| {
        let server = serve(vec![]);
        let mut req = request(vec![]);
        req.model_id = model.into();
        req.params.image_size = tier.map(str::to_string);
        req.params.quality = quality.map(str::to_string);
        let err = gateway(&server, extra).generate(&req).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::InvalidRequest, "{err:?}");
    };
    reject("gemini-3-pro-image", None, Some("high"), &[]);
    reject("gemini-3-pro-image", Some("1K"), None, &[]);
    reject("gpt-image-2", Some("8K"), None, &[]);
    reject("gpt-image-2", None, Some("ultra"), &[]);
    reject("my-model", Some("2K"), None, &[(ENV_IMAGE_MODEL, "my-model")]);
}

#[test]
fn one_reference_is_uploaded_as_image_and_several_as_image_array() {
    let mut server = serve(vec![b64_reply(&[PNG_BYTES])]);
    gateway(&server, &[]).generate(&request(vec![reference(1)])).unwrap();
    let req = &server.requests()[0];
    assert_eq!(req.path, "/v1/images/edits");
    assert!(req.headers.get("content-type").unwrap().starts_with("multipart/form-data"));
    for field in ["model", "prompt", "size", "quality", "n", "response_format"] {
        assert!(req.body.contains(&format!("name=\"{field}\"")), "missing {field}");
    }
    assert!(req.body.contains("b64_json"));
    assert!(req.body.contains("name=\"image\"; filename=\"reference-1.png\""), "{}", req.body);
    assert!(!req.body.contains("name=\"image[]\""));
    assert!(req.body.contains("reference-bytes-1"));
    assert!(!req.body.contains(KEY));

    let mut server = serve(vec![b64_reply(&[PNG_BYTES])]);
    gateway(&server, &[]).generate(&request(vec![reference(1), reference(2)])).unwrap();
    let body = &server.requests()[0].body;
    assert_eq!(body.matches("name=\"image[]\"").count(), 2);
    assert!(!body.contains("name=\"image\";"));
    let (first, second) = (body.find("reference-bytes-1").unwrap(), body.find("reference-bytes-2").unwrap());
    assert!(first < second, "request order");
}

#[test]
fn a_rejected_response_format_is_retried_once_without_it() {
    let rejected = Reply::Json(
        400,
        json!({ "error": { "message": "Unknown parameter: 'response_format'.", "type": "invalid_request_error" } })
            .to_string(),
    );
    let mut server = serve(vec![rejected, b64_reply(&[PNG_BYTES])]);
    let out = gateway(&server, &[]).generate(&request(vec![])).unwrap();
    assert_eq!(out.images.len(), 1);
    let recorded = server.requests();
    assert_eq!(recorded.len(), 2);
    assert!(recorded[0].body.contains("response_format"));
    assert!(!recorded[1].body.contains("response_format"));
}

#[test]
fn url_only_answers_are_downloaded_without_the_key() {
    // The file comes from a second mock server (a separate file host, as with real gateways).
    let mut files = MockServer::start("", vec![Reply::Raw(200, "image/png", PNG_BYTES.to_vec())]);
    let url = format!("{}/files/out.png", files.base_url);
    let mut api = serve(vec![Reply::Json(200, json!({ "data": [{ "url": url }] }).to_string())]);
    let out = gateway(&api, &[]).generate(&request(vec![])).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].bytes, PNG_BYTES);
    assert_eq!(out.meta["downloaded"], 1);
    let download = &files.requests()[0];
    assert_eq!((download.method.as_str(), download.path.as_str()), ("GET", "/files/out.png"));
    assert!(!download.headers.contains_key("authorization"), "the key never goes to a file host");
    assert_eq!(api.requests().len(), 1);
}

#[test]
fn bad_download_links_and_empty_answers_are_bad_response() {
    for data in [
        json!([{ "url": "http://cdn.example.com/a.png" }]),
        json!([{ "url": "file:///etc/passwd" }]),
        json!([]),
        json!([{}]),
    ] {
        let server = serve(vec![Reply::Json(200, json!({ "data": data }).to_string())]);
        let err = gateway(&server, &[]).generate(&request(vec![])).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::BadResponse, "{data}: {err:?}");
    }
    let files = MockServer::start("", vec![Reply::Raw(200, "text/html", b"<html>login</html>".to_vec())]);
    let url = format!("{}/x", files.base_url);
    let server = serve(vec![Reply::Json(200, json!({ "data": [{ "url": url }] }).to_string())]);
    let err = gateway(&server, &[]).generate(&request(vec![])).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::BadResponse);
}

#[test]
fn errors_name_the_status_and_quote_the_gateway_with_the_key_redacted() {
    let generate_err = |reply: Reply| {
        let server = serve(vec![reply]);
        let err = gateway(&server, &[]).generate(&request(vec![])).unwrap_err();
        assert_key_free(&err);
        err
    };
    let openai_shape = |status: u16, code: &str, message: &str| {
        Reply::Json(status, json!({ "error": { "message": message, "type": "x", "code": code } }).to_string())
    };
    use ProviderErrorKind::*;

    let e = generate_err(openai_shape(401, "invalid_api_key", &format!("bad key {KEY}")));
    assert_eq!(e.kind, Auth);
    assert!(
        e.message.contains("HTTP 401") && e.message.contains("HHTECH says: \"bad key [redacted]\""),
        "{}",
        e.message
    );

    let e = generate_err(Reply::Raw(502, "text/plain", b"upstream timed out".to_vec()));
    assert_eq!(e.kind, Network);
    assert!(e.message.contains("HTTP 502") && e.message.contains("upstream timed out"), "{}", e.message);

    let e = generate_err(Reply::Raw(400, "text/plain", format!("model not allowed for {KEY}").into_bytes()));
    assert_eq!(e.kind, InvalidRequest);
    assert!(e.message.contains("HTTP 400") && e.message.contains("model not allowed for [redacted]"));

    let e = generate_err(Reply::Json(422, json!({ "detail": "size must be 1024x1024" }).to_string()));
    assert!(e.message.contains("HTTP 422") && e.message.contains("size must be 1024x1024"));

    let e = generate_err(Reply::Json(400, json!({ "error": "quota exceeded for model" }).to_string()));
    assert!(e.message.contains("quota exceeded for model"));

    let e = generate_err(Reply::Raw(503, "text/html", b"<html><body>Bad gateway</body></html>".to_vec()));
    assert!(e.message.contains("HTTP 503") && e.message.contains("HTML error page"), "{}", e.message);

    assert_eq!(generate_err(openai_shape(429, "rate_limit_exceeded", "slow down")).kind, RateLimited);
    assert_eq!(generate_err(openai_shape(429, "insufficient_quota", "no credit")).kind, Auth);
    assert_eq!(generate_err(openai_shape(400, "moderation_blocked", "blocked")).kind, Blocked);
    let e = generate_err(openai_shape(404, "model_not_found", "no such model"));
    assert_eq!(e.kind, InvalidRequest);
    assert!(e.message.contains("HHTECH_BASE_URL"), "404 points at the settings: {}", e.message);
    assert!(!e.message.contains("platform.openai.com"), "no OpenAI-specific hints for a gateway");
}

// ---------------------------------------------------------------- test_connection

#[test]
fn test_connection_lists_models_and_reports_the_configured_ones() {
    let list = json!({ "object": "list", "data": [
        { "id": "gpt-image-2", "object": "model", "owned_by": "x" },
        { "id": "claude-sonnet-5", "object": "model", "owned_by": "y" },
        { "id": "gpt-image-2-2k", "object": "model", "owned_by": "x" },
    ]});
    let mut server = serve(vec![Reply::Json(200, list.to_string())]);
    let status = gateway(&server, &[(ENV_IMAGE_MODEL, "gpt-image-2,gpt-image-9")]).test_connection(Some(KEY)).unwrap();
    assert!(status.contains("3 models listed"), "{status}");
    assert!(status.contains("gpt-image-2 listed") && status.contains("gpt-image-9 not listed"), "{status}");
    assert!(status.contains("chat claude-sonnet-5 listed"), "{status}");
    let req = &server.requests()[0];
    assert_eq!((req.method.as_str(), req.path.as_str()), ("GET", "/v1/models"));
    assert_eq!(req.headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
}

#[test]
fn test_connection_without_a_models_endpoint_still_succeeds_and_explains() {
    let server = serve(vec![Reply::Raw(404, "text/plain", b"Not Found".to_vec())]);
    let status = gateway(&server, &[]).test_connection(Some(KEY)).unwrap();
    assert!(status.contains("no /models endpoint"), "{status}");
}

#[test]
fn test_connection_errors_and_odd_bodies() {
    let server = serve(vec![Reply::Json(401, json!({ "error": { "message": format!("bad {KEY}") } }).to_string())]);
    let err = gateway(&server, &[]).test_connection(Some(KEY)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Auth);
    assert_key_free(&err);
    for body in ["<html>proxy</html>", "{}", r#"{"data": 3}"#] {
        let server = serve(vec![Reply::Json(200, body.into())]);
        let err = gateway(&server, &[]).test_connection(Some(KEY)).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::BadResponse, "{body}");
    }
    let server = serve(vec![]);
    assert_eq!(gateway(&server, &[]).test_connection(None).unwrap_err().kind, ProviderErrorKind::Auth);
}

// ---------------------------------------------------------------- chat

#[test]
fn chat_posts_system_and_user_messages_and_reads_the_first_choice() {
    let answer =
        json!({ "choices": [{ "index": 0, "message": { "role": "assistant", "content": "  Better prompt.  " } }] });
    let mut server = serve(vec![Reply::Json(200, answer.to_string())]);
    let p = gateway(&server, &[]);
    assert_eq!(p.chat_model().as_deref(), Some("claude-sonnet-5"));
    assert_eq!(p.chat("SYSTEM", "USER", Some(KEY)).unwrap(), "Better prompt.");
    let req = &server.requests()[0];
    assert_eq!((req.method.as_str(), req.path.as_str()), ("POST", "/v1/chat/completions"));
    assert_eq!(req.headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
    let body: Value = serde_json::from_str(&req.body).unwrap();
    assert_eq!(
        body,
        json!({ "model": "claude-sonnet-5", "messages": [
            { "role": "system", "content": "SYSTEM" },
            { "role": "user", "content": "USER" },
        ]})
    );
}

#[test]
fn chat_accepts_content_parts_and_maps_errors() {
    let parts = json!({ "choices": [{ "message": { "content": [{ "type": "text", "text": "A " }, { "type": "text", "text": "B" }] } }] });
    let server = serve(vec![Reply::Json(200, parts.to_string())]);
    assert_eq!(gateway(&server, &[]).chat("s", "u", Some(KEY)).unwrap(), "A B");

    for body in [json!({ "choices": [] }), json!({ "choices": [{ "message": { "content": "   " } }] }), json!({})] {
        let server = serve(vec![Reply::Json(200, body.to_string())]);
        assert_eq!(gateway(&server, &[]).chat("s", "u", Some(KEY)).unwrap_err().kind, ProviderErrorKind::BadResponse);
    }
    let server = serve(vec![Reply::Raw(500, "text/plain", format!("boom {KEY}").into_bytes())]);
    let err = gateway(&server, &[]).chat("s", "u", Some(KEY)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Network);
    assert!(err.message.contains("HTTP 500") && err.message.contains("boom [redacted]"));
    assert_key_free(&err);

    let echoed = json!({ "choices": [{ "message": { "content": format!("prompt {KEY}") } }] });
    let server = serve(vec![Reply::Json(200, echoed.to_string())]);
    assert_eq!(gateway(&server, &[]).chat("s", "u", Some(KEY)).unwrap(), "prompt [redacted]");

    let server = serve(vec![]);
    assert_eq!(gateway(&server, &[]).chat("s", "u", None).unwrap_err().kind, ProviderErrorKind::Auth);
}

#[test]
fn openai_offers_no_chat() {
    let openai = super::super::openai::OpenAiProvider::with_base_url("http://127.0.0.1:9/v1");
    assert_eq!(openai.chat_model(), None);
    assert_eq!(openai.chat("s", "u", Some(KEY)).unwrap_err().kind, ProviderErrorKind::InvalidRequest);
    assert_eq!(openai.config_problem(), None);
}

// ---------------------------------------------------------------- live smoke tests

/// Live setup: `.env` (loaded without overriding the environment), the key from the OS
/// credential store or `HHTECH_API_KEY` / `ARCH_STUDIO_HHTECH_API_KEY`. Never prints the key.
#[cfg(test)]
fn live() -> (OpenAiProvider, String) {
    for path in crate::env_file::load_dotenv() {
        println!("loaded {}", path.display());
    }
    let provider = provider(&crate::secrets::ProcessEnv);
    if let Some(problem) = provider.config_problem() {
        panic!("{problem}");
    }
    let key = crate::secrets::resolve_key(&crate::secrets::KeyringSecretStore, &crate::secrets::ProcessEnv, ID)
        .expect("no HHTECH key: set HHTECH_API_KEY in .env or save one in provider settings");
    println!("base URL {} (key from {:?})", provider.config().base_url.as_deref().unwrap_or("?"), key.source);
    (provider, key.value)
}

/// Writes the images to a fresh temp folder (kept) and prints the paths.
fn save(name: &str, out: &super::super::ProviderOutput) {
    let dir = std::env::temp_dir().join(format!("hhtech-live-{}", ulid::Ulid::generate()));
    std::fs::create_dir_all(&dir).unwrap();
    for (i, image) in out.images.iter().enumerate() {
        let path = dir.join(format!("{name}-{}.png", i + 1));
        std::fs::write(&path, &image.bytes).unwrap();
        println!("saved {} ({} bytes, {})", path.display(), image.bytes.len(), image.mime_type);
    }
    println!("meta {}", out.meta);
}

fn live_request(key: &str, references: Vec<ReferenceImage>) -> ProviderRequest {
    ProviderRequest {
        model_id: std::env::var(ENV_IMAGE_MODEL)
            .ok()
            .and_then(|m| m.split(',').next().map(|s| s.trim().to_string()))
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| catalog::CATALOG[0].id.into()),
        prompt: PromptText {
            positive: "A small white concrete pavilion in a green meadow, architectural photograph, overcast light."
                .into(),
            negative: "people, text".into(),
            reference_instructions: String::new(),
            preservation_instructions: String::new(),
        },
        references,
        params: GenerationParams {
            aspect_ratio: Some("1:1".into()),
            image_size: None,
            output_count: 1,
            seed: None,
            quality: None,
            enhance: None,
        },
        api_key: Some(key.to_string()),
    }
}

/// A 64x64 PNG (two-tone) generated in memory, used as the edit reference.
fn small_png() -> Vec<u8> {
    let img =
        image::RgbImage::from_fn(
            64,
            64,
            |x, _| if x < 32 { image::Rgb([200, 200, 190]) } else { image::Rgb([60, 90, 60]) },
        );
    let mut bytes = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Png).unwrap();
    bytes
}

#[test]
#[ignore = "calls the real HHTECH gateway (chat); needs HHTECH_BASE_URL + key"]
fn hhtech_live_chat() {
    let (provider, key) = live();
    match provider.chat(crate::services::prompt_enhance::SYSTEM_PROMPT, "modern villa at dusk", Some(&key)) {
        Ok(text) => println!("chat ok:\n{text}"),
        Err(e) => panic!("chat failed ({:?}): {}", e.kind, e.message),
    }
}

#[test]
#[ignore = "calls the real HHTECH gateway (one 1024x1024 image, ~100 s); needs HHTECH_BASE_URL + key"]
fn hhtech_live_generate() {
    let (provider, key) = live();
    match provider.generate(&live_request(&key, vec![])) {
        Ok(out) => save("generate", &out),
        Err(e) => panic!("generate failed ({:?}): {}", e.kind, e.message),
    }
}

#[test]
#[ignore = "calls the real HHTECH gateway (one edit with a small generated PNG); needs HHTECH_BASE_URL + key"]
fn hhtech_live_edit() {
    let (provider, key) = live();
    let reference = ReferenceImage {
        asset_id: "AST_LIVE".into(),
        role: "master_architecture".into(),
        mime_type: "image/png".into(),
        bytes: small_png(),
    };
    match provider.generate(&live_request(&key, vec![reference])) {
        Ok(out) => save("edit", &out),
        Err(e) => panic!("edit failed ({:?}): {}", e.kind, e.message),
    }
}

#[test]
#[ignore = "calls the real HHTECH gateway (one enhancement edit); needs HHTECH_BASE_URL + key"]
fn hhtech_live_enhance() {
    let (provider, key) = live();
    let reference = ReferenceImage {
        asset_id: "AST_LIVE".into(),
        role: "master_architecture".into(),
        mime_type: "image/png".into(),
        bytes: small_png(),
    };
    let mut request = live_request(&key, vec![reference]);
    request.model_id = "gemini-3-pro-image".into();
    request.prompt.positive = "Architecture Preserve: keep geometry, openings, proportions, materials, camera and composition exactly; add only fine detail and texture.".into();
    request.params.image_size = Some(catalog::enhance_tier(Some(2048)).into());
    request.params.enhance = Some(super::super::EnhanceParams {
        mode: super::super::EnhanceMode::Generative,
        target_long_edge: Some(2048),
        detail_strength: 40,
        architecture_preserve: true,
    });
    match provider.generate(&request) {
        Ok(out) => save("enhance", &out),
        Err(e) => panic!("enhance failed ({:?}): {}", e.kind, e.message),
    }
}
