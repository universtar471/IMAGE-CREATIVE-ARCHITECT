//! Mock-HTTP tests of the video adapters (ADR-043). No vendor is called.

use std::collections::{BTreeMap, HashMap};

use base64::Engine;
use serde_json::{json, Value};

use super::super::test_http::{MockServer, Reply};
use super::*;
use crate::secrets::FixedEnv;

const MP4: &[u8] = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2mp41";

fn frame() -> ReferenceImage {
    ReferenceImage {
        asset_id: "AST_01".into(),
        role: "master_architecture".into(),
        mime_type: "image/png".into(),
        bytes: vec![0x89, b'P', b'N', b'G', 1, 2, 3],
    }
}

fn request(model: &str) -> VideoRequest {
    VideoRequest {
        model_id: model.into(),
        prompt: "Slow dolly in toward the entrance.".into(),
        negative_prompt: "warped walls".into(),
        image: frame(),
        duration_sec: 5,
        aspect_ratio: None,
    }
}

fn body(server_body: &str) -> Value {
    serde_json::from_str(server_body).unwrap()
}

fn env(pairs: &[(&str, &str)]) -> FixedEnv {
    FixedEnv(pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<HashMap<_, _>>())
}

// ---------------------------------------------------------------- shared helpers

#[test]
fn video_signatures() {
    assert_eq!(video_mime(MP4), Some(("video/mp4", "mp4")));
    assert_eq!(video_mime(b"\x00\x00\x00\x14ftypqt  \x00\x00"), Some(("video/quicktime", "mov")));
    assert_eq!(video_mime(&[0x1A, 0x45, 0xDF, 0xA3, 0]), Some(("video/webm", "webm")));
    assert_eq!(video_mime(b"\x89PNG\r\n\x1a\n...."), None);
    assert_eq!(parse_duration(Some("10s")), Some(10));
    assert_eq!(parse_duration(Some("10")), None);
}

#[test]
fn download_rejects_plain_http_and_non_video() {
    let err = download_video("V", "http://example.com/a.mp4", &[], "k").unwrap_err();
    assert!(err.message.contains("not https"));
    let server = MockServer::start("", vec![Reply::Raw(200, "video/mp4", b"<html>nope</html>".to_vec())]);
    let err = download_video("V", &format!("{}/clip", server.base_url), &[], "k").unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::BadResponse);
}

#[test]
fn download_drops_the_key_on_redirect() {
    // Two replies on one port: the redirect, then the clip.
    let mut server = MockServer::start(
        "",
        vec![Reply::Redirect("/signed/clip.mp4".into()), Reply::Raw(200, "video/mp4", MP4.to_vec())],
    );
    let bytes = download_video(
        "V",
        &format!("{}/api/view?filename=a.mp4", server.base_url),
        &[("X-API-Key", "secret-key")],
        "secret-key",
    )
    .unwrap();
    assert_eq!(bytes, MP4);
    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].headers.get("x-api-key").map(String::as_str), Some("secret-key"));
    assert_eq!(requests[1].path, "/signed/clip.mp4");
    assert!(!requests[1].headers.contains_key("x-api-key"));
}

#[test]
fn errors_never_quote_the_key() {
    let err = status_error("V", 401, "bad key ACCESS123:SECRET456 sent", "ACCESS123:SECRET456");
    assert_eq!(err.kind, ProviderErrorKind::Auth);
    assert!(!err.message.contains("ACCESS123") && !err.message.contains("SECRET456"));
    assert_eq!(status_error("V", 429, "", "k").kind, ProviderErrorKind::RateLimited);
    assert_eq!(status_error("V", 503, "", "k").kind, ProviderErrorKind::Network);
}

#[test]
fn hmac_matches_rfc_4231() {
    // RFC 4231 test case 2.
    let mac = hmac_sha256(b"Jefe", b"what do ya want for nothing?");
    let hex: String = mac.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
}

#[test]
fn env_models_and_base_urls() {
    let make = |id: &str| video_model(id, id, &[5], &[]);
    let (models, problem) = env_models(&env(&[("M", "a, b,a")]), "M", &["d"], make);
    assert_eq!(models.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["a", "b"]);
    assert!(problem.is_none());
    let (_, problem) = env_models(&env(&[("M", "bad id!")]), "M", &["d"], make);
    assert!(problem.is_some());
    assert!(env_base_url(&env(&[("U", "http://example.com")]), "U", "https://x").is_err());
    assert_eq!(env_base_url(&env(&[("U", "http://127.0.0.1:9/")]), "U", "https://x").unwrap(), "http://127.0.0.1:9");
}

#[test]
fn video_providers_report_video_and_refuse_images() {
    let p = kling::provider(&FixedEnv::default());
    assert_eq!(p.output_kind(), OutputKind::Video);
    assert!(p.video().is_some());
    assert!(!p.auto_retries_timeouts());
    assert_eq!(p.info().models[0].image_sizes, ["5s", "10s"]);
    assert!(p.test_connection(None).is_err());
    assert!(p.test_connection(Some("a:b")).unwrap().contains("no clip is made"));
}

// ---------------------------------------------------------------- Kling

#[test]
fn kling_token_is_a_signed_jwt() {
    let token = kling::token("AK:SK", 1_700_000_000).unwrap();
    let parts: Vec<&str> = token.split('.').collect();
    assert_eq!(parts.len(), 3);
    let claims: Value =
        serde_json::from_slice(&base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1]).unwrap()).unwrap();
    assert_eq!(claims, json!({"exp": 1_700_001_800, "iss": "AK", "nbf": 1_699_999_995}));
    let expected = jwt_hs256(
        &BTreeMap::from([("iss", json!("AK")), ("exp", json!(1_700_001_800)), ("nbf", json!(1_699_999_995))]),
        "SK",
    );
    assert_eq!(token, expected);
    assert_eq!(kling::token("no-colon", 0).unwrap_err().kind, ProviderErrorKind::Auth);
}

#[test]
fn kling_submit_poll_download() {
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(200, json!({"code": 0, "data": {"task_id": "T1", "task_status": "submitted"}}).to_string()),
            Reply::Json(200, json!({"code": 0, "data": {"task_status": "processing"}}).to_string()),
            Reply::Json(
                200,
                json!({"code": 0, "data": {"task_status": "succeed", "task_result": {"videos": [{"url": "https://cdn/x.mp4"}]}}})
                    .to_string(),
            ),
        ],
    );
    let api = kling::KlingApi { base_url: server.base_url.clone() };
    let task = api.submit(&request("kling-v2-1"), "AK:SK").unwrap();
    assert_eq!(task.id, "T1");
    assert_eq!(api.poll(&task, "AK:SK").unwrap(), VideoPoll::Pending);
    assert_eq!(api.poll(&task, "AK:SK").unwrap(), VideoPoll::Done { url: "https://cdn/x.mp4".into() });
    let requests = server.requests();
    assert_eq!(requests[0].path, "/v1/videos/image2video");
    assert!(requests[0].headers["authorization"].starts_with("Bearer ey"));
    let sent = body(&requests[0].body);
    assert_eq!(sent["model_name"], "kling-v2-1");
    assert_eq!(sent["duration"], "5");
    assert_eq!(sent["negative_prompt"], "warped walls");
    assert_eq!(sent["image"], base64_of(&frame().bytes));
    assert_eq!(requests[1].path, "/v1/videos/image2video/T1");
}

#[test]
fn kling_failures() {
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(200, json!({"code": 1301, "message": "content risk"}).to_string()),
            Reply::Json(
                200,
                json!({"code": 0, "data": {"task_status": "failed", "task_status_msg": "Risk control"}}).to_string(),
            ),
        ],
    );
    let api = kling::KlingApi { base_url: server.base_url.clone() };
    assert_eq!(api.submit(&request("m"), "AK:SK").unwrap_err().kind, ProviderErrorKind::Blocked);
    let task = VideoTask { id: "T".into(), extra: Value::Null };
    assert!(matches!(api.poll(&task, "AK:SK").unwrap(), VideoPoll::Failed { blocked: true, .. }));
    server.requests();
}

// ---------------------------------------------------------------- Veo

#[test]
fn veo_submit_poll_download_with_key_header() {
    let op = "models/veo-3.1-generate-preview/operations/abc123";
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(200, json!({"name": op}).to_string()),
            Reply::Json(200, json!({"name": op, "done": false}).to_string()),
            Reply::Json(
                200,
                json!({"done": true, "response": {"generateVideoResponse": {"generatedSamples": [{"video": {"uri": "https://g/v.mp4"}}]}}})
                    .to_string(),
            ),
        ],
    );
    let api = veo::VeoApi { base_url: server.base_url.clone() };
    let mut req = request("veo-3.1-generate-preview");
    req.duration_sec = 8;
    req.aspect_ratio = Some("16:9".into());
    let task = api.submit(&req, "g-key").unwrap();
    assert_eq!(task.id, op);
    assert_eq!(api.poll(&task, "g-key").unwrap(), VideoPoll::Pending);
    assert_eq!(api.poll(&task, "g-key").unwrap(), VideoPoll::Done { url: "https://g/v.mp4".into() });
    let requests = server.requests();
    assert_eq!(requests[0].path, "/v1beta/models/veo-3.1-generate-preview:predictLongRunning");
    assert_eq!(requests[0].headers["x-goog-api-key"], "g-key");
    let sent = body(&requests[0].body);
    assert_eq!(
        sent["parameters"],
        json!({"durationSeconds": 8, "sampleCount": 1, "aspectRatio": "16:9", "negativePrompt": "warped walls"})
    );
    assert_eq!(sent["instances"][0]["image"]["mimeType"], "image/png");
    assert_eq!(requests[1].path, format!("/v1beta/{op}"));
}

#[test]
fn veo_safety_filter_and_error() {
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(
                200,
                json!({"done": true, "response": {"generateVideoResponse": {"raiMediaFilteredReasons": ["people"]}}})
                    .to_string(),
            ),
            Reply::Json(200, json!({"done": true, "error": {"message": "quota"}}).to_string()),
        ],
    );
    let api = veo::VeoApi { base_url: server.base_url.clone() };
    let task = VideoTask { id: "models/m/operations/x".into(), extra: Value::Null };
    assert!(matches!(api.poll(&task, "k").unwrap(), VideoPoll::Failed { blocked: true, .. }));
    assert!(matches!(api.poll(&task, "k").unwrap(), VideoPoll::Failed { blocked: false, .. }));
    server.requests();
    let bad = VideoTask { id: "../../etc".into(), extra: Value::Null };
    assert!(api.poll(&bad, "k").is_err());
}

// ---------------------------------------------------------------- Seedance

#[test]
fn seedance_submit_poll() {
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(200, json!({"id": "cgt-2026"}).to_string()),
            Reply::Json(200, json!({"id": "cgt-2026", "status": "running"}).to_string()),
            Reply::Json(200, json!({"status": "succeeded", "content": {"video_url": "https://b/v.mp4"}}).to_string()),
        ],
    );
    let api = seedance::SeedanceApi { base_url: server.base_url.clone() };
    let task = api.submit(&request("seedance-1-0-pro-250528"), "ark").unwrap();
    assert_eq!(api.poll(&task, "ark").unwrap(), VideoPoll::Pending);
    assert_eq!(api.poll(&task, "ark").unwrap(), VideoPoll::Done { url: "https://b/v.mp4".into() });
    let requests = server.requests();
    assert_eq!(requests[0].path, "/api/v3/contents/generations/tasks");
    assert_eq!(requests[0].headers["authorization"], "Bearer ark");
    let sent = body(&requests[0].body);
    assert_eq!(
        sent["content"][0]["text"],
        "Slow dolly in toward the entrance. Avoid: warped walls. --duration 5 --ratio adaptive"
    );
    assert!(sent["content"][1]["image_url"]["url"].as_str().unwrap().starts_with("data:image/png;base64,"));
    assert_eq!(requests[1].path, "/api/v3/contents/generations/tasks/cgt-2026");
}

#[test]
fn seedance_failure_and_http_error() {
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(401, json!({"error": {"message": "bad key ark-secret"}}).to_string()),
            Reply::Json(
                200,
                json!({"status": "failed", "error": {"code": "InputImageSensitiveContentDetected", "message": "x"}})
                    .to_string(),
            ),
        ],
    );
    let api = seedance::SeedanceApi { base_url: server.base_url.clone() };
    let err = api.submit(&request("m"), "ark-secret").unwrap_err();
    assert_eq!(err.kind, ProviderErrorKind::Auth);
    assert!(!err.message.contains("ark-secret"));
    let task = VideoTask { id: "cgt-1".into(), extra: Value::Null };
    assert!(matches!(api.poll(&task, "ark-secret").unwrap(), VideoPoll::Failed { blocked: true, .. }));
    server.requests();
}

// ---------------------------------------------------------------- Comfy Cloud

const WORKFLOW: &str = r#"{
  "1": {"class_type": "LoadImage", "inputs": {"image": "{{image}}"}},
  "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{prompt}}"}},
  "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "{{negative_prompt}}"}},
  "4": {"class_type": "WanImageToVideo", "inputs": {"length_seconds": "{{duration}}"}}
}"#;

#[test]
fn comfy_workflow_checks_and_fill() {
    assert!(comfy::parse_workflow("[]").is_err());
    assert!(comfy::parse_workflow(r#"{"nodes": [], "links": []}"#).is_err());
    assert!(comfy::parse_workflow(r#"{"1": {"class_type": "LoadImage", "inputs": {"image": "x.png"}}}"#)
        .unwrap_err()
        .contains("{{image}}"));
    let workflow = comfy::parse_workflow(WORKFLOW).unwrap();
    let filled = comfy::fill(&workflow, &request("workflow"), "in/a.png");
    assert_eq!(filled["1"]["inputs"]["image"], "in/a.png");
    assert_eq!(filled["2"]["inputs"]["text"], "Slow dolly in toward the entrance.");
    assert_eq!(filled["3"]["inputs"]["text"], "warped walls");
    assert_eq!(filled["4"]["inputs"]["length_seconds"], 5);
}

#[test]
fn comfy_needs_a_workflow_file() {
    let p = comfy::provider(&FixedEnv::default());
    assert!(p.config_problem().unwrap().contains(comfy::ENV_WORKFLOW));
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("wf.json");
    std::fs::write(&path, WORKFLOW).unwrap();
    let p = comfy::provider(&env(&[(comfy::ENV_WORKFLOW, path.to_str().unwrap())]));
    assert!(p.config_problem().is_none());
}

#[test]
fn comfy_upload_submit_poll_download() {
    let mut server = MockServer::start(
        "",
        vec![
            Reply::Json(200, json!({"name": "AST_01.png", "subfolder": "", "type": "input"}).to_string()),
            Reply::Json(200, json!({"prompt_id": "5f1c-22", "number": 1}).to_string()),
            Reply::Json(200, json!({}).to_string()),
            Reply::Json(
                200,
                json!({"5f1c-22": {"status": {"status_str": "success", "completed": true},
                    "outputs": {"9": {"images": [{"filename": "clip_00001.mp4", "subfolder": "video", "type": "output"}]}}}})
                .to_string(),
            ),
            Reply::Raw(200, "video/mp4", MP4.to_vec()),
        ],
    );
    let api = comfy::ComfyApi { base_url: server.base_url.clone(), workflow: comfy::parse_workflow(WORKFLOW).unwrap() };
    let task = api.submit(&request("workflow"), "comfy-key").unwrap();
    assert_eq!(task.id, "5f1c-22");
    assert_eq!(api.poll(&task, "comfy-key").unwrap(), VideoPoll::Pending);
    let VideoPoll::Done { url } = api.poll(&task, "comfy-key").unwrap() else { panic!("not done") };
    assert!(url.contains("/api/view?filename=clip_00001.mp4&subfolder=video&type=output"));
    assert_eq!(api.download(&url, "comfy-key").unwrap(), MP4);
    assert!(api.download("https://elsewhere/api/view?x", "comfy-key").is_err());
    let requests = server.requests();
    assert_eq!(requests[0].path, "/api/upload/image");
    assert_eq!(requests[0].headers["x-api-key"], "comfy-key");
    let sent = body(&requests[1].body);
    assert_eq!(sent["prompt"]["1"]["inputs"]["image"], "AST_01.png");
    assert_eq!(requests[2].path, "/api/history/5f1c-22");
}

#[test]
fn comfy_execution_error() {
    let mut server = MockServer::start(
        "",
        vec![Reply::Json(
            200,
            json!({"p1": {"status": {"status_str": "error", "completed": false,
                "messages": [["execution_start", {}], ["execution_error", {"exception_message": "Out of memory"}]]}}})
            .to_string(),
        )],
    );
    let api = comfy::ComfyApi { base_url: server.base_url.clone(), workflow: Value::Null };
    let task = VideoTask { id: "p1".into(), extra: Value::Null };
    let VideoPoll::Failed { message, .. } = api.poll(&task, "k").unwrap() else { panic!("not failed") };
    assert!(message.contains("Out of memory"));
    server.requests();
    assert!(api.submit(&request("workflow"), "k").is_err());
}
