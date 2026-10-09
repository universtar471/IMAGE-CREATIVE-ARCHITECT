//! Adapter tests against a local mock HTTP server (std `TcpListener`, no network).

use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use serde_json::{json, Value};

use super::super::test_http::{closed_port, MockServer, Reply};
use super::super::{
    GenerationParams, ImageProvider, PromptText, ProviderError, ProviderErrorKind, ProviderRequest, ReferenceImage,
};
use super::{wire, GeminiProvider};

const KEY: &str = "AIzaTEST-secret-key-0123456789";
const PNG_BYTES: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-1";
const PNG_BYTES_2: &[u8] = b"\x89PNG\r\n\x1a\nfake-image-2";

/// The shared mock server, under the Gemini `/v1beta` prefix.
fn serve(replies: Vec<Reply>) -> MockServer {
    MockServer::start("/v1beta", replies)
}

/// `server.provider()`: the adapter pointed at the mock server.
trait MockProvider {
    fn provider(&self) -> GeminiProvider;
}

impl MockProvider for MockServer {
    fn provider(&self) -> GeminiProvider {
        GeminiProvider::with_base_url(&self.base_url)
    }
}

// ---------------------------------------------------------------- fixtures

fn image_response(bytes: &[u8]) -> Reply {
    Reply::Json(
        200,
        json!({
            "candidates": [{
                "content": { "role": "model", "parts": [
                    { "text": "Here is your render." },
                    { "inlineData": { "mimeType": "image/png", "data": B64.encode(bytes) } }
                ]},
                "finishReason": "STOP"
            }],
            "modelVersion": "gemini-nano-banana-2.1"
        })
        .to_string(),
    )
}

fn error_reply(status: u16, google_status: &str, message: &str, reason: Option<&str>) -> Reply {
    let mut error = json!({ "code": status, "message": message, "status": google_status });
    if let Some(reason) = reason {
        error["details"] = json!([{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": reason }]);
    }
    Reply::Json(status, json!({ "error": error }).to_string())
}

fn request(outputs: u32) -> ProviderRequest {
    ProviderRequest {
        model_id: "gemini-nano-banana-2.1".into(),
        prompt: PromptText {
            positive: "Hero exterior view of the villa at golden hour.".into(),
            negative: "warped lines".into(),
            reference_instructions: "Image 1 is the master.".into(),
            preservation_instructions: "Keep the roof form.".into(),
        },
        references: vec![
            ReferenceImage {
                asset_id: "AST_1".into(),
                role: "master_architecture".into(),
                mime_type: "image/png".into(),
                bytes: vec![1, 2, 3, 4],
            },
            ReferenceImage {
                asset_id: "AST_2".into(),
                role: "material_reference".into(),
                mime_type: "image/jpeg".into(),
                bytes: vec![9, 8, 7],
            },
        ],
        params: GenerationParams {
            aspect_ratio: Some("16:9".into()),
            image_size: Some("2K".into()),
            output_count: outputs,
            seed: None,
            quality: None,
            enhance: None,
        },
        api_key: Some(KEY.into()),
    }
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

// ---------------------------------------------------------------- request shape

#[test]
fn request_has_model_path_key_header_parts_and_image_config() {
    let mut server = serve(vec![image_response(PNG_BYTES)]);
    server.provider().generate(&request(1)).unwrap();
    let recorded = server.requests();
    assert_eq!(recorded.len(), 1);
    let req = &recorded[0];

    assert_eq!(req.method, "POST");
    assert_eq!(req.path, "/v1beta/models/gemini-nano-banana-2.1:generateContent");
    assert!(!req.path.contains(KEY), "key must not be in the URL");
    assert_eq!(req.headers.get("x-goog-api-key").map(String::as_str), Some(KEY));
    assert!(req.headers.get("content-type").unwrap().starts_with("application/json"));

    let body: Value = serde_json::from_str(&req.body).unwrap();
    let parts = body["contents"][0]["parts"].as_array().unwrap();
    assert_eq!(parts.len(), 5, "prompt + (label, image) per reference");
    assert_eq!(
        parts[0]["text"],
        "Hero exterior view of the villa at golden hour.\n\nImage 1 is the master.\n\nKeep the roof form.\n\nAvoid: \
         warped lines"
    );
    assert_eq!(parts[1]["text"], "Reference 1 — master architecture: preserve massing, openings and proportions");
    assert_eq!(parts[2]["inlineData"]["mimeType"], "image/png");
    assert_eq!(parts[2]["inlineData"]["data"], B64.encode([1, 2, 3, 4]));
    assert_eq!(parts[3]["text"], "Reference 2 — material reference: use only for materials, textures and finishes");
    assert_eq!(parts[4]["inlineData"]["mimeType"], "image/jpeg");
    assert_eq!(parts[4]["inlineData"]["data"], B64.encode([9, 8, 7]));

    let config = &body["generationConfig"];
    assert_eq!(config["responseModalities"], json!(["TEXT", "IMAGE"]));
    assert_eq!(config["imageConfig"], json!({ "aspectRatio": "16:9", "imageSize": "2K" }));
    assert!(!req.body.contains(KEY));
}

#[test]
fn image_config_is_omitted_when_nothing_is_set() {
    let mut params = request(1).params;
    params.aspect_ratio = None;
    params.image_size = None;
    let body = wire::build_request(&request(1).prompt, &[], &params);
    assert!(body["generationConfig"].get("imageConfig").is_none());
    assert_eq!(body["contents"][0]["parts"].as_array().unwrap().len(), 1);
}

// ---------------------------------------------------------------- success

#[test]
fn parses_one_image_and_meta() {
    let server = serve(vec![image_response(PNG_BYTES)]);
    let out = server.provider().generate(&request(1)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].mime_type, "image/png");
    assert_eq!(out.images[0].bytes, PNG_BYTES);
    assert_eq!(out.meta["requested"], 1);
    assert_eq!(out.meta["returned"], 1);
    assert_eq!(out.meta["failed"], 0);
    assert_eq!(out.meta["modelVersion"], "gemini-nano-banana-2.1");
    assert_eq!(out.meta["finishReasons"], json!(["STOP"]));
    assert_eq!(out.meta["text"], "Here is your render.");
}

#[test]
fn several_outputs_are_sequential_calls() {
    let mut server = serve(vec![image_response(PNG_BYTES), image_response(PNG_BYTES_2)]);
    let out = server.provider().generate(&request(2)).unwrap();
    assert_eq!(out.images.iter().map(|i| i.bytes.as_slice()).collect::<Vec<_>>(), vec![PNG_BYTES, PNG_BYTES_2]);
    assert_eq!(out.meta["returned"], 2);
    let recorded = server.requests();
    assert_eq!(recorded.len(), 2);
    assert_eq!(recorded[0].body, recorded[1].body, "every call sends the same request");
}

#[test]
fn thought_images_are_skipped_and_extra_images_capped() {
    let thought = B64.encode(b"thought");
    let body = json!({
        "candidates": [{
            "content": { "parts": [
                { "inlineData": { "mimeType": "image/png", "data": thought }, "thought": true },
                { "inlineData": { "mimeType": "image/png", "data": B64.encode(PNG_BYTES) } },
                { "inlineData": { "mimeType": "image/png", "data": B64.encode(PNG_BYTES_2) } }
            ]},
            "finishReason": "STOP"
        }]
    });
    let server = serve(vec![Reply::Json(200, body.to_string())]);
    let out = server.provider().generate(&request(1)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].bytes, PNG_BYTES);
}

#[test]
fn partial_failure_returns_successes_and_counts_failures() {
    let server = serve(vec![
        image_response(PNG_BYTES),
        error_reply(503, "UNAVAILABLE", "The model is overloaded.", None),
        image_response(PNG_BYTES_2),
    ]);
    let out = server.provider().generate(&request(3)).unwrap();
    assert_eq!(out.images.len(), 2);
    assert_eq!(out.meta["requested"], 3);
    assert_eq!(out.meta["returned"], 2);
    assert_eq!(out.meta["failed"], 1);
    assert_eq!(out.meta["errors"][0]["kind"], "network");
    assert!(!out.meta.to_string().contains(KEY));
}

#[test]
fn all_outputs_failing_returns_the_error() {
    let server =
        serve(vec![error_reply(500, "INTERNAL", "boom", None), error_reply(503, "UNAVAILABLE", "overloaded", None)]);
    let err = server.provider().generate(&request(2)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Network);
}

#[test]
fn auth_failure_stops_further_calls() {
    let mut server =
        serve(vec![error_reply(403, "PERMISSION_DENIED", "Permission denied.", None), image_response(PNG_BYTES)]);
    let err = server.provider().generate(&request(2)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Auth);
    assert_eq!(server.requests().len(), 1);
}

// ---------------------------------------------------------------- error mapping

#[test]
fn maps_http_errors_to_kinds() {
    use ProviderErrorKind::*;
    let cases = [
        (error_reply(401, "UNAUTHENTICATED", "Request had invalid authentication credentials.", None), Auth),
        (error_reply(403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers.", None), Auth),
        (
            error_reply(
                400,
                "INVALID_ARGUMENT",
                "API key not valid. Please pass a valid API key.",
                Some("API_KEY_INVALID"),
            ),
            Auth,
        ),
        (error_reply(400, "INVALID_ARGUMENT", "Unsupported aspect ratio.", None), InvalidRequest),
        (error_reply(404, "NOT_FOUND", "models/x is not found.", None), InvalidRequest),
        (error_reply(429, "RESOURCE_EXHAUSTED", "Quota exceeded.", None), RateLimited),
        (error_reply(500, "INTERNAL", "Internal error.", None), Network),
        (error_reply(503, "UNAVAILABLE", "Overloaded.", None), Network),
        (Reply::Json(502, "<html>bad gateway</html>".into()), Network),
    ];
    for (reply, expected) in cases {
        let err = generate_error(vec![reply]);
        assert_eq!(err.kind, expected, "{err:?}");
        assert!(err.message.len() < 400, "message too long: {}", err.message);
        assert!(!err.message.contains("<html>"), "raw body leaked: {}", err.message);
        assert_key_free(&err);
    }
}

fn quota_reply(violations: Value) -> Reply {
    Reply::Json(
        429,
        json!({ "error": {
            "code": 429,
            "message": "You exceeded your current quota, please check your plan and billing details.",
            "status": "RESOURCE_EXHAUSTED",
            "details": [
                { "@type": "type.googleapis.com/google.rpc.QuotaFailure", "violations": violations },
                { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "21s" }
            ]
        }})
        .to_string(),
    )
}

#[test]
fn exhausted_or_free_tier_quota_is_not_retryable_and_says_billing() {
    let cases = [
        // Image models have no free tier: the free-tier quota is 0.
        json!([{
            "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            "quotaValue": "0"
        }]),
        // A daily quota does not come back within the queue's 15 s / 60 s backoff.
        json!([{
            "quotaMetric": "generativelanguage.googleapis.com/generate_content_paid_tier_requests",
            "quotaId": "GenerateRequestsPerDayPerProjectPerModel",
            "quotaValue": "250"
        }]),
    ];
    for violations in cases {
        let mut server = serve(vec![quota_reply(violations.clone()), image_response(PNG_BYTES)]);
        let err = server.provider().generate(&request(2)).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::Auth, "{violations}");
        assert!(!err.kind.retryable());
        assert!(err.message.contains("billing"), "{}", err.message);
        assert!(err.message.contains("aistudio.google.com"), "{}", err.message);
        assert_key_free(&err);
        assert_eq!(server.requests().len(), 1, "an exhausted quota stops the remaining outputs");
    }
}

#[test]
fn per_minute_paid_quota_and_bare_429_stay_retryable() {
    let per_minute = json!([{
        "quotaMetric": "generativelanguage.googleapis.com/generate_content_paid_tier_requests",
        "quotaId": "GenerateRequestsPerMinutePerProjectPerModel",
        "quotaValue": "10"
    }]);
    for reply in [quota_reply(per_minute), error_reply(429, "RESOURCE_EXHAUSTED", "Resource has been exhausted.", None)]
    {
        let err = generate_error(vec![reply]);
        assert_eq!(err.kind, ProviderErrorKind::RateLimited, "{err:?}");
        assert!(err.kind.retryable());
    }
}

#[test]
fn invalid_request_message_carries_short_vendor_detail() {
    let err = generate_error(vec![error_reply(400, "INVALID_ARGUMENT", "Unsupported aspect ratio.", None)]);
    assert!(err.message.contains("Unsupported aspect ratio."), "{}", err.message);
}

#[test]
fn echoed_key_is_redacted_and_long_messages_truncated() {
    let echoed = format!("API key {KEY} is not allowed. {}", "x".repeat(1000));
    let err = generate_error(vec![error_reply(400, "INVALID_ARGUMENT", &echoed, None)]);
    assert_key_free(&err);
    assert!(err.message.contains("[redacted]"));
    assert!(err.message.chars().count() < 320, "{}", err.message);
}

#[test]
fn connection_failure_is_network() {
    let provider = GeminiProvider::with_base_url(format!("http://127.0.0.1:{}/v1beta", closed_port()));
    let err = provider.generate(&request(1)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Network);
    assert_key_free(&err);
}

#[test]
fn one_response_with_two_images_fills_two_outputs_in_one_request() {
    let candidates = json!([{
        "content": { "parts": [image_part(PNG_BYTES), image_part(PNG_BYTES_2)] },
        "finishReason": "STOP"
    }]);
    let mut server = serve(vec![ok_body(candidates, "v1"), image_response(b"never-requested")]);
    let out = server.provider().generate(&request(2)).unwrap();
    assert_eq!(out.images.iter().map(|i| i.bytes.as_slice()).collect::<Vec<_>>(), vec![PNG_BYTES, PNG_BYTES_2]);
    assert_eq!(out.meta["returned"], 2);
    assert_eq!(server.requests().len(), 1, "no second call once outputCount is reached");
}

#[test]
fn default_timeouts_are_180s_generate_and_15s_test() {
    let provider = GeminiProvider::new();
    assert_eq!(provider.generate_timeout, Duration::from_secs(180));
    assert_eq!(provider.test_timeout, Duration::from_secs(15));
    let local = GeminiProvider::with_base_url("http://127.0.0.1:9/v1beta");
    assert_eq!((local.generate_timeout, local.test_timeout), (Duration::from_secs(180), Duration::from_secs(15)));
}

#[test]
fn test_connection_timeout_is_timeout() {
    let body = json!({ "name": "models/gemini-nano-banana-2.1" }).to_string();
    let server = serve(vec![Reply::Slow(Duration::from_millis(1500), 200, body)]);
    let mut provider = server.provider();
    provider.test_timeout = Duration::from_millis(300);
    let err = provider.test_connection(Some(KEY)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Timeout);
    assert_key_free(&err);
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
fn prompt_block_reason_is_blocked() {
    let body = json!({ "promptFeedback": { "blockReason": "PROHIBITED_CONTENT" } });
    let err = generate_error(vec![Reply::Json(200, body.to_string())]);
    assert_eq!(err.kind, ProviderErrorKind::Blocked);
    assert!(err.message.contains("PROHIBITED_CONTENT"));
}

#[test]
fn safety_finish_reasons_are_blocked() {
    for reason in ["SAFETY", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT", "PROHIBITED_CONTENT"] {
        let body = json!({ "candidates": [{ "content": { "parts": [] }, "finishReason": reason }] });
        let err = generate_error(vec![Reply::Json(200, body.to_string())]);
        assert_eq!(err.kind, ProviderErrorKind::Blocked, "{reason}");
    }
}

#[test]
fn no_image_is_bad_response_with_trimmed_text() {
    let long_text = format!("I cannot draw that because {}", "reasons ".repeat(100));
    let body = json!({
        "candidates": [{ "content": { "parts": [{ "text": long_text }] }, "finishReason": "STOP" }]
    });
    let err = generate_error(vec![Reply::Json(200, body.to_string())]);
    assert_eq!(err.kind, ProviderErrorKind::BadResponse);
    assert!(err.message.contains("I cannot draw that"));
    assert!(err.message.contains("STOP"));
    assert!(err.message.chars().count() < 320, "{}", err.message);
}

#[test]
fn non_json_success_body_is_bad_response() {
    let err = generate_error(vec![Reply::Json(200, "not json".into())]);
    assert_eq!(err.kind, ProviderErrorKind::BadResponse);
}

// ---------------------------------------------------------------- key redaction on HTTP 200 (review round 1)

fn image_part(bytes: &[u8]) -> Value {
    json!({ "inlineData": { "mimeType": "image/png", "data": B64.encode(bytes) } })
}

fn ok_body(candidates: Value, model_version: &str) -> Reply {
    Reply::Json(200, json!({ "candidates": candidates, "modelVersion": model_version }).to_string())
}

#[test]
fn key_echoed_in_no_image_text_is_redacted() {
    let candidates =
        json!([{ "content": { "parts": [{ "text": format!("Your key {KEY} was used.") }] }, "finishReason": "STOP" }]);
    let err = generate_error(vec![ok_body(candidates, "v1")]);
    assert_eq!(err.kind, ProviderErrorKind::BadResponse);
    assert_key_free(&err);
    assert!(err.message.contains("[redacted]"), "{}", err.message);
}

#[test]
fn key_echoed_in_finish_reason_or_block_reason_is_redacted() {
    let candidates = json!([{ "content": { "parts": [] }, "finishReason": format!("ODD_{KEY}") }]);
    assert_key_free(&generate_error(vec![ok_body(candidates, "v1")]));

    let blocked = json!({ "promptFeedback": { "blockReason": format!("SAFETY {KEY}") } });
    let err = generate_error(vec![Reply::Json(200, blocked.to_string())]);
    assert_eq!(err.kind, ProviderErrorKind::Blocked);
    assert_key_free(&err);
}

#[test]
fn key_echoed_in_success_fields_never_reaches_meta() {
    let candidates = json!([{
        "content": { "parts": [{ "text": format!("note {KEY}") }, image_part(PNG_BYTES)] },
        "finishReason": format!("STOP{KEY}")
    }]);
    let server = serve(vec![ok_body(candidates, &format!("model-{KEY}"))]);
    let out = server.provider().generate(&request(1)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert!(!out.meta.to_string().contains(KEY), "{}", out.meta);
}

#[test]
fn key_echoed_during_partial_failure_never_reaches_meta() {
    let good = json!([{ "content": { "parts": [{ "text": format!("ok {KEY}") }, image_part(PNG_BYTES)] }, "finishReason": "STOP" }]);
    let bad = json!([{ "content": { "parts": [{ "text": format!("no image, key {KEY}") }] }, "finishReason": "STOP" }]);
    let server = serve(vec![ok_body(good, "v1"), ok_body(bad, &format!("v-{KEY}"))]);
    let out = server.provider().generate(&request(2)).unwrap();
    assert_eq!(out.meta["failed"], 1);
    assert_eq!(out.meta["errors"][0]["kind"], "bad_response");
    assert!(!out.meta.to_string().contains(KEY), "{}", out.meta);
}

#[test]
fn validation_errors_never_echo_the_key() {
    let provider = GeminiProvider::with_base_url("http://127.0.0.1:9/v1beta");
    let mutations: [&dyn Fn(&mut ProviderRequest); 3] =
        [&|r| r.model_id = format!("gemini-{KEY}"), &|r| r.params.aspect_ratio = Some(KEY.into()), &|r| {
            r.params.image_size = Some(KEY.into())
        }];
    for mutate in mutations {
        let mut req = request(1);
        mutate(&mut req);
        let err = provider.generate(&req).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::InvalidRequest);
        assert_key_free(&err);
    }
}

// ---------------------------------------------------------------- per-candidate finish reasons (review round 1)

#[test]
fn block_reason_on_a_later_candidate_without_images_is_blocked() {
    let candidates = json!([
        { "content": { "parts": [{ "text": "thinking" }] }, "finishReason": "STOP" },
        { "content": { "parts": [] }, "finishReason": "IMAGE_SAFETY" }
    ]);
    let err = generate_error(vec![ok_body(candidates, "v1")]);
    assert_eq!(err.kind, ProviderErrorKind::Blocked, "{err:?}");
    assert!(err.message.contains("IMAGE_SAFETY"));
}

#[test]
fn images_from_blocked_candidates_are_dropped() {
    let candidates = json!([
        { "content": { "parts": [image_part(b"unsafe")] }, "finishReason": "IMAGE_SAFETY" },
        { "content": { "parts": [image_part(PNG_BYTES)] }, "finishReason": "STOP" }
    ]);
    let server = serve(vec![ok_body(candidates, "v1")]);
    let out = server.provider().generate(&request(1)).unwrap();
    assert_eq!(out.images.len(), 1);
    assert_eq!(out.images[0].bytes, PNG_BYTES);

    let only_blocked = json!([{ "content": { "parts": [image_part(b"unsafe")] }, "finishReason": "IMAGE_SAFETY" }]);
    let err = generate_error(vec![ok_body(only_blocked, "v1")]);
    assert_eq!(err.kind, ProviderErrorKind::Blocked);
}

// ---------------------------------------------------------------- validation (no network)

#[test]
fn validation_rejects_before_calling_the_api() {
    // Base URL points nowhere: any network attempt would surface as Network, not InvalidRequest.
    let provider = GeminiProvider::with_base_url("http://127.0.0.1:9/v1beta");
    let check = |mutate: &dyn Fn(&mut ProviderRequest), kind: ProviderErrorKind| {
        let mut req = request(1);
        mutate(&mut req);
        let err = provider.generate(&req).unwrap_err();
        assert_eq!(err.kind, kind, "{err:?}");
        assert_key_free(&err);
    };
    use ProviderErrorKind::*;
    check(&|r| r.api_key = None, Auth);
    check(&|r| r.api_key = Some("  ".into()), Auth);
    check(&|r| r.model_id = "gemini-made-up".into(), InvalidRequest);
    check(&|r| r.params.output_count = 0, InvalidRequest);
    check(&|r| r.params.output_count = 5, InvalidRequest);
    check(&|r| r.params.aspect_ratio = Some("7:3".into()), InvalidRequest);
    check(&|r| r.params.image_size = Some("2k".into()), InvalidRequest);
    check(
        &|r| {
            r.model_id = "gemini-2.5-flash-image".into();
            r.params.aspect_ratio = None;
        },
        InvalidRequest, // image size set on a fixed-size model
    );
    check(
        &|r| {
            r.model_id = "gemini-2.5-flash-image".into();
            r.params.image_size = None;
            r.params.aspect_ratio = None;
            let extra = r.references[0].clone();
            r.references.extend([extra.clone(), extra]);
        },
        InvalidRequest, // 4 references > 3
    );
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
    let info = GeminiProvider::new().info();
    assert_eq!(info.id, "gemini");
    assert!(info.requires_api_key);
    let ids: Vec<_> = info.models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(
        ids,
        [
            "gemini-nano-banana-2.1",
            "gemini-3-pro-image",
            "gemini-3.1-flash-image",
            "gemini-3.1-flash-lite-image",
            "gemini-2.5-flash-image"
        ]
    );
    for model in &info.models {
        assert_eq!(model.max_outputs, 4);
        assert!(!model.supports_negative_prompt);
        assert!(!model.supports_seed);
        assert!(model.quality_options.is_empty() && model.price_hint.is_none());
        assert!(model.aspect_ratios.contains(&"1:1".to_string()));
    }
    let pro = info.model("gemini-3-pro-image").unwrap();
    assert_eq!(pro.image_sizes, ["1K", "2K", "4K"]);
    assert_eq!(pro.max_reference_images, 14);
    assert!(info.model("gemini-2.5-flash-image").unwrap().image_sizes.is_empty());
    assert_eq!(info.model("gemini-3.1-flash-image").unwrap().aspect_ratios.len(), 14);
}

// ---------------------------------------------------------------- test_connection

#[test]
fn test_connection_gets_model_metadata_with_header() {
    let body = json!({ "name": "models/gemini-nano-banana-2.1", "displayName": "Nano Banana 2.1" });
    let mut server = serve(vec![Reply::Json(200, body.to_string())]);
    let status = server.provider().test_connection(Some(KEY)).unwrap();
    assert!(status.contains("Nano Banana 2.1"), "{status}");
    let recorded = server.requests();
    assert_eq!(recorded[0].method, "GET");
    assert_eq!(recorded[0].path, "/v1beta/models/gemini-nano-banana-2.1");
    assert_eq!(recorded[0].headers.get("x-goog-api-key").map(String::as_str), Some(KEY));
}

#[test]
fn test_connection_maps_errors_without_leaking_the_key() {
    let server = serve(vec![error_reply(
        400,
        "INVALID_ARGUMENT",
        "API key not valid. Please pass a valid API key.",
        Some("API_KEY_INVALID"),
    )]);
    let err = server.provider().test_connection(Some(KEY)).unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Auth);
    assert_key_free(&err);

    let missing = GeminiProvider::new().test_connection(None).unwrap_err();
    assert_eq!(missing.kind, ProviderErrorKind::Auth);
}

#[test]
fn test_connection_rejects_bodies_that_are_not_model_metadata() {
    for body in ["<html>Sign in to your proxy</html>", "{}", r#"{"name": 42}"#, r#"{"name": "something-else"}"#] {
        let server = serve(vec![Reply::Json(200, body.into())]);
        let err = server.provider().test_connection(Some(KEY)).unwrap_err();
        assert_eq!(err.kind, ProviderErrorKind::BadResponse, "{body}");
        assert_key_free(&err);
    }
}

// ---------------------------------------------------------------- live smoke test

/// Manual only: `ARCH_STUDIO_GEMINI_API_KEY=... cargo test gemini_live -- --ignored --nocapture`.
/// Costs one image generation. Never prints the key.
#[test]
#[ignore = "calls the real Gemini API; needs ARCH_STUDIO_GEMINI_API_KEY"]
fn gemini_live_smoke() {
    let key = std::env::var("ARCH_STUDIO_GEMINI_API_KEY").expect("set ARCH_STUDIO_GEMINI_API_KEY");
    let provider = GeminiProvider::new();
    let status = provider.test_connection(Some(&key)).unwrap_or_else(|e| panic!("test_connection: {e}"));
    println!("{status}");

    let model = std::env::var("ARCH_STUDIO_GEMINI_MODEL").unwrap_or_else(|_| super::DEFAULT_MODEL.into());
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
        },
        api_key: Some(key),
    };
    let out = provider.generate(&req).unwrap_or_else(|e| panic!("generate: {e}"));
    assert_eq!(out.images.len(), 1);
    assert!(out.images[0].mime_type.starts_with("image/"));
    assert!(out.images[0].bytes.len() > 1000);
    // `meta` is built from sanitized strings only; print just the counts anyway.
    println!("returned {} image(s), failed {}", out.meta["returned"], out.meta["failed"]);
}
