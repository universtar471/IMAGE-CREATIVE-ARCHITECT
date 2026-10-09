//! Adapter tests against the shared local mock HTTP server (no network).

use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

use super::super::test_http::{closed_port, MockServer, Reply};
use super::super::{
    GenerationParams, ImageProvider, PromptText, ProviderError, ProviderErrorKind, ProviderRequest, ReferenceImage,
};
use super::OpenAiProvider;

const KEY: &str = "sk-proj-TEST-secret-key-0123456789";
const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-1";
const PNG_BYTES_2: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-2";

/// The shared mock server, under the OpenAI `/v1` prefix.
fn serve(replies: Vec<Reply>) -> MockServer {
    MockServer::start("/v1", replies)
}

/// `server.provider()`: the adapter pointed at the mock server.
trait MockProvider {
    fn provider(&self) -> OpenAiProvider;
}

impl MockProvider for MockServer {
    fn provider(&self) -> OpenAiProvider {
        OpenAiProvider::with_base_url(&self.base_url)
    }
}

// ---------------------------------------------------------------- fixtures

fn images_response(images: &[&[u8]]) -> Reply {
    let data: Vec<Value> = images.iter().map(|b| json!({ "b64_json": B64.encode(b) })).collect();
    Reply::Json(
        200,
        json!({
            "created": 1_760_000_000,
            "background": "opaque",
            "data": data,
            "output_format": "png",
            "quality": "high",
            "size": "1536x864",
            "usage": { "input_tokens": 50, "output_tokens": 50, "total_tokens": 100 }
        })
        .to_string(),
    )
}

fn error_reply(status: u16, kind: &str, code: Option<&str>, message: &str) -> Reply {
    Reply::Json(
        status,
        json!({ "error": { "message": message, "type": kind, "param": null, "code": code } }).to_string(),
    )
}

fn prompt() -> PromptText {
    PromptText {
        positive: "Hero exterior view of the villa at golden hour.".into(),
        negative: "warped lines".into(),
        reference_instructions: "Image 1 is the master.".into(),
        preservation_instructions: "Keep the roof form.".into(),
    }
}

fn references() -> Vec<ReferenceImage> {
    vec![
        ReferenceImage {
            asset_id: "AST_1".into(),
            role: "master_architecture".into(),
            mime_type: "image/png".into(),
            bytes: b"first-reference-bytes".to_vec(),
        },
        ReferenceImage {
            asset_id: "AST_2".into(),
            role: "material_reference".into(),
            mime_type: "image/jpeg".into(),
            bytes: b"second-reference-bytes".to_vec(),
        },
    ]
}

/// Text-to-image request (generations endpoint).
fn request(outputs: u32) -> ProviderRequest {
    ProviderRequest {
        model_id: "gpt-image-2.5-sunburst".into(),
        prompt: prompt(),
        references: vec![],
        params: GenerationParams {
            aspect_ratio: Some("16:9".into()),
            image_size: None,
            output_count: outputs,
            seed: None,
            quality: None,
            enhance: None,
            repair: None,
        },
        api_key: Some(KEY.into()),
    }
}

fn with_references(outputs: u32) -> ProviderRequest {
    ProviderRequest { references: references(), ..request(outputs) }
}

fn generate_error(replies: Vec<Reply>) -> ProviderError {
    let server = serve(replies);
    server.provider().generate(&request(1)).unwrap_err()
}

fn assert_key_free(error: &ProviderError) {
    assert!(!error.message.contains(KEY), "key leaked into message: {}", error.message);
    assert!(!format!("{error}").contains(KEY));
    assert!(!format!("{error:?}").contains(KEY));
}

const COMPOSED: &str =
    "Hero exterior view of the villa at golden hour.\n\nImage 1 is the master.\n\nKeep the roof form.\n\nAvoid: warped lines";

// ---------------------------------------------------------------- request shape

#[test]
fn text_only_request_posts_json_to_generations_with_bearer_key() {
    let mut server = serve(vec![images_response(&[PNG_BYTES])]);
    server.provider().generate(&request(1)).unwrap();
    let recorded = server.requests();
    assert_eq!(recorded.len(), 1);
    let req = &recorded[0];

    assert_eq!(req.method, "POST");
    assert_eq!(req.path, "/v1/images/generations");
    assert!(!req.path.contains(KEY), "key must not be in the URL");
    assert_eq!(req.headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
    assert!(req.headers.get("content-type").unwrap().starts_with("application/json"));

    let body: Value = serde_json::from_str(&req.body).unwrap();
    assert_eq!(
        body,
        json!({
            "model": "gpt-image-2.5-sunburst",
            "prompt": COMPOSED,
            "n": 1,
            "quality": "high",
            "output_format": "png",
            "size": "1536x864"
        })
    );
    assert!(!req.body.contains(KEY));
}

#[test]
fn size_is_omitted_without_a_ratio_and_follows_the_ratio_otherwise() {
    let mut req = request(1);
    req.params.aspect_ratio = None;
    let mut server = serve(vec![images_response(&[PNG_BYTES])]);
    server.provider().generate(&req).unwrap();
    let body: Value = serde_json::from_str(&server.requests()[0].body).unwrap();
    assert!(body.get("size").is_none(), "{body}");

    let mut req = request(1);
    req.params.aspect_ratio = Some("3:2".into());
    let mut server = serve(vec![images_response(&[PNG_BYTES])]);
    server.provider().generate(&req).unwrap();
    let body: Value = serde_json::from_str(&server.requests()[0].body).unwrap();
    assert_eq!(body["size"], "1536x1024");
}

#[test]
fn references_go_to_edits_as_multipart_image_parts_in_request_order() {
    let mut server = serve(vec![images_response(&[PNG_BYTES])]);
    server.provider().generate(&with_references(1)).unwrap();
    let recorded = server.requests();
    assert_eq!(recorded.len(), 1);
    let req = &recorded[0];

    assert_eq!(req.method, "POST");
    assert_eq!(req.path, "/v1/images/edits");
    assert_eq!(req.headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
    assert!(req.headers.get("content-type").unwrap().starts_with("multipart/form-data; boundary="));

    let body = &req.body;
    let field = |name: &str, value: &str| {
        let header = format!("name=\"{name}\"\r\n\r\n{value}\r\n");
        assert!(body.contains(&header), "missing field {name}={value} in:\n{body}");
    };
    field("model", "gpt-image-2.5-sunburst");
    field("n", "1");
    field("quality", "high");
    field("output_format", "png");
    field("size", "1536x864");
    let expected_prompt = format!(
        "{COMPOSED}\n\nInput images, in the order they are attached:\n\
         1. master architecture: preserve massing, openings and proportions\n\
         2. material reference: use only for materials, textures and finishes"
    );
    field("prompt", &expected_prompt);

    let first = body
        .find("name=\"image[]\"; filename=\"reference-1.png\"\r\nContent-Type: image/png\r\n\r\nfirst-reference-bytes")
        .expect("first reference part");
    let second = body
        .find(
            "name=\"image[]\"; filename=\"reference-2.jpg\"\r\nContent-Type: image/jpeg\r\n\r\nsecond-reference-bytes",
        )
        .expect("second reference part");
    assert!(first < second, "references must keep request order");
    assert_eq!(body.matches("name=\"image[]\"").count(), 2);
    assert!(!body.contains(KEY));
}

// ---------------------------------------------------------------- success

#[test]
fn parses_images_and_meta_from_one_call() {
    let mut server = serve(vec![images_response(&[PNG_BYTES, PNG_BYTES_2])]);
    let out = server.provider().generate(&request(2)).unwrap();
    assert_eq!(out.images.iter().map(|i| i.bytes.as_slice()).collect::<Vec<_>>(), vec![PNG_BYTES, PNG_BYTES_2]);
    assert!(out.images.iter().all(|i| i.mime_type == "image/png"));
    assert_eq!(server.requests().len(), 1, "n images come from one request");
    assert_eq!(out.meta["requested"], 2);
    assert_eq!(out.meta["returned"], 2);
    assert_eq!(out.meta["endpoint"], "generations");
    assert_eq!(out.meta["size"], "1536x864");
    assert_eq!(out.meta["quality"], "high");
    assert_eq!(out.meta["outputFormat"], "png");
}

#[test]
fn extra_images_are_capped_and_output_format_sets_the_mime_type() {
    let body = json!({
        "data": [{ "b64_json": B64.encode(PNG_BYTES) }, { "b64_json": B64.encode(PNG_BYTES_2) }],
        "output_format": "webp"
    });
    let server = serve(vec![Reply::Json(200, body.to_string())]);
    let out = server.provider().generate(&request(1)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].mime_type, "image/webp");
}

#[test]
fn fewer_images_than_requested_are_returned_and_counted() {
    let server = serve(vec![images_response(&[PNG_BYTES])]);
    let out = server.provider().generate(&request(3)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!((out.meta["requested"].as_u64(), out.meta["returned"].as_u64()), (Some(3), Some(1)));
}

#[test]
fn ok_without_an_image_or_with_bad_data_is_bad_response() {
    for body in [
        json!({ "created": 1, "data": [] }).to_string(),
        json!({ "created": 1 }).to_string(),
        json!({ "data": [{ "url": "https://example.com/x.png" }] }).to_string(),
        json!({ "data": [{ "b64_json": "%%% not base64 %%%" }] }).to_string(),
        "not json".to_string(),
    ] {
        let err = generate_error(vec![Reply::Json(200, body.clone())]);
        assert_eq!(err.kind, ProviderErrorKind::BadResponse, "{body}");
        assert_key_free(&err);
    }
}

#[test]
fn key_echoed_in_success_fields_never_reaches_meta() {
    let body = json!({
        "data": [{ "b64_json": B64.encode(PNG_BYTES) }],
        "size": format!("1024x1024 {KEY}"),
        "quality": KEY,
        "output_format": format!("png{KEY}")
    });
    let server = serve(vec![Reply::Json(200, body.to_string())]);
    let out = server.provider().generate(&request(1)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert!(!out.meta.to_string().contains(KEY), "{}", out.meta);
}

// ---------------------------------------------------------------- error mapping

#[test]
fn maps_http_errors_to_kinds() {
    use ProviderErrorKind::*;
    let cases = [
        (error_reply(401, "invalid_request_error", Some("invalid_api_key"), "Incorrect API key provided."), Auth),
        (
            error_reply(403, "invalid_request_error", None, "Your organization must be verified to use this model."),
            Auth,
        ),
        (
            error_reply(429, "requests", Some("rate_limit_exceeded"), "Rate limit reached for images per minute."),
            RateLimited,
        ),
        (error_reply(429, "rate_limit_error", Some("slow_down"), "Slow down."), RateLimited),
        (error_reply(429, "insufficient_quota", Some("insufficient_quota"), "You exceeded your current quota."), Auth),
        (error_reply(429, "insufficient_quota", Some("credit_balance_exhausted"), "No credits."), Auth),
        (error_reply(429, "insufficient_quota", Some("organization_spend_limit_exceeded"), "Spend limit."), Auth),
        (error_reply(429, "insufficient_quota", Some("project_spend_limit_exceeded"), "Spend limit."), Auth),
        (error_reply(429, "insufficient_quota", Some("organization_usage_limit_exceeded"), "Usage limit."), Auth),
        (error_reply(400, "image_generation_user_error", Some("moderation_blocked"), "Request blocked."), Blocked),
        (error_reply(400, "invalid_request_error", Some("content_policy_violation"), "Rejected by safety."), Blocked),
        (error_reply(400, "invalid_request_error", Some("invalid_value"), "Invalid size '7x7'."), InvalidRequest),
        (
            error_reply(404, "invalid_request_error", Some("model_not_found"), "The model does not exist."),
            InvalidRequest,
        ),
        (error_reply(500, "server_error", None, "The server had an error."), Network),
        (error_reply(503, "service_unavailable_error", Some("server_is_overloaded"), "Overloaded."), Network),
        (Reply::Json(502, "<html>bad gateway</html>".into()), Network),
    ];
    for (reply, expected) in cases {
        let err = generate_error(vec![reply]);
        assert_eq!(err.kind, expected, "{err:?}");
        assert!(err.message.len() < 420, "message too long: {}", err.message);
        assert!(!err.message.contains("<html>"), "raw body leaked: {}", err.message);
        assert_key_free(&err);
    }
}

#[test]
fn billing_429_is_not_retryable_and_tells_the_user_to_add_credits() {
    let err = generate_error(vec![error_reply(
        429,
        "insufficient_quota",
        Some("insufficient_quota"),
        "You exceeded your current quota, please check your plan and billing details.",
    )]);
    assert!(!err.kind.retryable());
    assert!(err.message.contains("platform.openai.com/settings/organization/billing"), "{}", err.message);
    assert!(err.message.contains("insufficient_quota"), "{}", err.message);

    let rate = generate_error(vec![error_reply(429, "requests", Some("rate_limit_exceeded"), "Too fast.")]);
    assert!(rate.kind.retryable());
}

#[test]
fn auth_messages_point_to_keys_and_verification() {
    let err = generate_error(vec![error_reply(401, "invalid_request_error", Some("invalid_api_key"), "Bad key.")]);
    assert!(err.message.contains("platform.openai.com/api-keys"), "{}", err.message);
    let err = generate_error(vec![error_reply(403, "invalid_request_error", None, "Verify your organization.")]);
    assert!(err.message.contains("Organization Verification"), "{}", err.message);
    assert!(err.message.contains("Verify your organization."), "{}", err.message);
}

#[test]
fn invalid_request_message_carries_short_vendor_detail() {
    let err = generate_error(vec![error_reply(400, "invalid_request_error", Some("invalid_value"), "Invalid size.")]);
    assert!(err.message.contains("Invalid size."), "{}", err.message);
}

#[test]
fn echoed_key_is_redacted_and_long_messages_truncated() {
    let echoed = format!("Incorrect API key provided: {KEY}. {}", "x".repeat(1000));
    for status in [400, 401, 403] {
        let err = generate_error(vec![error_reply(status, "invalid_request_error", Some("invalid_api_key"), &echoed)]);
        assert_key_free(&err);
        assert!(err.message.contains("[redacted]"), "{}", err.message);
        assert!(err.message.chars().count() < 450, "{}", err.message);
    }
    let odd_code = error_reply(429, "insufficient_quota", Some("insufficient_quota"), &echoed);
    assert_key_free(&generate_error(vec![odd_code]));
}

#[test]
fn connection_failure_is_network() {
    let provider = OpenAiProvider::with_base_url(format!("http://127.0.0.1:{}/v1", closed_port()));
    let err = provider.generate(&with_references(1)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Network);
    assert_key_free(&err);
}

#[test]
fn default_timeouts_are_300s_generate_and_15s_test() {
    let provider = OpenAiProvider::new();
    assert_eq!(provider.generate_timeout, Duration::from_secs(300));
    assert_eq!(provider.test_timeout, Duration::from_secs(15));
    assert_eq!(provider.base_url().unwrap(), "https://api.openai.com/v1");
}

#[test]
fn client_timeout_is_timeout() {
    let server = serve(vec![Reply::Slow(Duration::from_millis(1500), 200, "{}".into())]);
    let mut provider = server.provider();
    provider.generate_timeout = Duration::from_millis(300);
    let err = provider.generate(&request(1)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Timeout);
    assert_key_free(&err);
}

#[test]
fn test_connection_timeout_is_timeout() {
    let body = json!({ "id": "gpt-image-2.5-sunburst", "object": "model" }).to_string();
    let server = serve(vec![Reply::Slow(Duration::from_millis(1500), 200, body)]);
    let mut provider = server.provider();
    provider.test_timeout = Duration::from_millis(300);
    let err = provider.test_connection(Some(KEY)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Timeout);
}

// ---------------------------------------------------------------- validation (no network)

#[test]
fn validation_rejects_before_calling_the_api() {
    // Base URL points nowhere: any network attempt would surface as Network, not InvalidRequest.
    let provider = OpenAiProvider::with_base_url("http://127.0.0.1:9/v1");
    let check = |mutate: &dyn Fn(&mut ProviderRequest), kind: ProviderErrorKind| {
        let mut req = with_references(1);
        mutate(&mut req);
        let err = provider.generate(&req).unwrap_err();
        assert_eq!(err.kind, kind, "{err:?}");
        assert_key_free(&err);
    };
    use ProviderErrorKind::*;
    check(&|r| r.api_key = None, Auth);
    check(&|r| r.api_key = Some("  ".into()), Auth);
    check(&|r| r.model_id = "dall-e-3".into(), InvalidRequest);
    check(&|r| r.model_id = format!("gpt-{KEY}"), InvalidRequest);
    check(&|r| r.params.output_count = 0, InvalidRequest);
    check(&|r| r.params.output_count = 5, InvalidRequest);
    check(&|r| r.params.aspect_ratio = Some("7:3".into()), InvalidRequest);
    check(&|r| r.params.aspect_ratio = Some(KEY.into()), InvalidRequest);
    check(&|r| r.params.image_size = Some("1K".into()), InvalidRequest);
    check(&|r| r.params.image_size = Some("4K".into()), InvalidRequest);
    // Official OpenAI keeps its fixed `high`: no quality choice.
    check(&|r| r.params.quality = Some("low".into()), InvalidRequest);
    check(&|r| r.references = (0..17).map(|_| references()[0].clone()).collect(), InvalidRequest);
    check(&|r| r.prompt.positive = "x".repeat(32_001), InvalidRequest);
    check(
        &|r| {
            r.prompt = PromptText {
                positive: " ".into(),
                negative: String::new(),
                reference_instructions: String::new(),
                preservation_instructions: String::new(),
            }
        },
        InvalidRequest,
    );
}

// ---------------------------------------------------------------- info

#[test]
fn info_lists_verified_models_with_honest_capabilities() {
    let info = OpenAiProvider::new().info();
    assert_eq!((info.id, info.label), ("openai", "OpenAI (GPT Image)"));
    assert!(info.requires_api_key);
    assert_eq!(info.kind, super::super::ProviderKind::Remote);
    let ids: Vec<_> = info.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-2"]);
    for model in &info.models {
        assert!(model.text_to_image && model.image_to_image);
        assert_eq!(model.max_outputs, 4);
        assert_eq!(model.max_reference_images, 16);
        assert!(!model.supports_negative_prompt);
        assert!(!model.supports_seed);
        assert!(model.image_sizes.is_empty(), "no invented resolution tiers");
        assert!(model.quality_options.is_empty(), "fixed quality, no choice");
        assert_eq!(model.price_hint, None);
        assert_eq!(model.aspect_ratios.len(), 10);
        assert!(model.aspect_ratios.contains(&"3:2".to_string()));
    }
}

// ---------------------------------------------------------------- test_connection

#[test]
fn test_connection_gets_the_default_model_with_bearer_key() {
    let body = json!({ "id": "gpt-image-2.5-sunburst", "object": "model", "created": 1, "owned_by": "system" });
    let mut server = serve(vec![Reply::Json(200, body.to_string())]);
    let status = server.provider().test_connection(Some(KEY)).unwrap();
    assert!(status.contains("gpt-image-2.5-sunburst"), "{status}");
    let recorded = server.requests();
    assert_eq!(recorded[0].method, "GET");
    assert_eq!(recorded[0].path, "/v1/models/gpt-image-2.5-sunburst");
    assert_eq!(recorded[0].headers.get("authorization").map(String::as_str), Some(format!("Bearer {KEY}").as_str()));
}

#[test]
fn test_connection_maps_errors_without_leaking_the_key() {
    let server = serve(vec![error_reply(
        401,
        "invalid_request_error",
        Some("invalid_api_key"),
        &format!("Incorrect API key provided: {KEY}."),
    )]);
    let err = server.provider().test_connection(Some(KEY)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Auth);
    assert_key_free(&err);

    let missing = OpenAiProvider::new().test_connection(None).unwrap_err();
    assert_eq!(missing.kind, ProviderErrorKind::Auth);
}

#[test]
fn test_connection_rejects_bodies_that_are_not_model_metadata() {
    for body in [
        "<html>Sign in to your proxy</html>",
        "{}",
        r#"{"id": 42, "object": "model"}"#,
        r#"{"id": "gpt-image-2.5-sunburst", "object": "list"}"#,
    ] {
        let server = serve(vec![Reply::Json(200, body.into())]);
        let err = server.provider().test_connection(Some(KEY)).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::BadResponse, "{body}");
        assert_key_free(&err);
    }
}

// ---------------------------------------------------------------- live smoke test

/// Manual only: `ARCH_STUDIO_OPENAI_API_KEY=... cargo test openai_live -- --ignored --nocapture`.
/// Costs one image (1024x1024, quality high). Never prints the key.
#[test]
#[ignore = "calls the real OpenAI API; needs ARCH_STUDIO_OPENAI_API_KEY"]
fn openai_live_smoke() {
    let key = std::env::var("ARCH_STUDIO_OPENAI_API_KEY").expect("set ARCH_STUDIO_OPENAI_API_KEY");
    let provider = OpenAiProvider::new();
    let status = provider.test_connection(Some(&key)).unwrap_or_else(|e| panic!("test_connection: {e}"));
    println!("{status}");

    let model = std::env::var("ARCH_STUDIO_OPENAI_MODEL").unwrap_or_else(|_| super::DEFAULT_MODEL.into());
    let req = ProviderRequest {
        model_id: model,
        prompt: PromptText {
            positive: "A small white concrete pavilion in a green meadow, architectural photograph, overcast light."
                .into(),
            negative: "people, text".into(),
            reference_instructions: String::new(),
            preservation_instructions: String::new(),
        },
        references: vec![],
        params: GenerationParams {
            aspect_ratio: Some("1:1".into()),
            image_size: None,
            output_count: 1,
            seed: None,
            quality: None,
            enhance: None,
            repair: None,
        },
        api_key: Some(key),
    };
    let out = provider.generate(&req).unwrap_or_else(|e| panic!("generate: {e}"));
    assert_eq!(out.images.len(), 1);
    assert!(out.images[0].mime_type.starts_with("image/"));
    assert!(out.images[0].bytes.len() > 1000);
    // `meta` is built from sanitized strings only; print just the counts anyway.
    println!("returned {} image(s), size {}", out.meta["returned"], out.meta["size"]);
}
