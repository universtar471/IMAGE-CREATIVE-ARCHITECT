//! Prompt enhancement (`prompt_enhance`): a chat model rewrites the user's extra prompt to be
//! more specific while keeping every fact of the Project DNA context. Nothing is stored; the
//! UI shows the result for Accept / Discard.

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::repositories as repo;
use crate::services::provider_settings::{find_provider, key_for, not_configured};
use crate::services::AppCore;

/// Longest user text accepted (the editable extra prompt).
pub const MAX_TEXT_CHARS: usize = 4_000;
/// Longest Project DNA context accepted (a compiled prompt is a few thousand characters).
pub const MAX_CONTEXT_CHARS: usize = 20_000;

pub const SYSTEM_PROMPT: &str = "You rewrite prompts for an architectural image generator. Rewrite the user's \
prompt to be more specific about materials, light, camera (viewpoint, lens, framing) and atmosphere. Preserve every \
fact stated in the Project DNA context and in the user's prompt; never contradict them. Do not invent dimensions, \
storey counts, areas or other numbers that are not given. Keep it to one paragraph of plain text in the user's \
language. Return only the rewritten prompt: no preamble, no quotes, no markdown.";

/// Mirrors `PromptEnhanceRequestSchema`. No `Debug`: the text is user content, not for logs.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceRequest {
    pub project_id: String,
    pub provider_id: String,
    pub text: String,
    #[serde(default)]
    pub context: String,
}

/// Mirrors `PromptEnhanceResultSchema`.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceResult {
    pub text: String,
}

fn user_message(text: &str, context: &str) -> String {
    if context.is_empty() {
        format!("Prompt to rewrite:\n{text}")
    } else {
        format!("Project DNA context (facts to preserve):\n{context}\n\nPrompt to rewrite:\n{text}")
    }
}

pub fn enhance(core: &AppCore, request: EnhanceRequest) -> AppResult<EnhanceResult> {
    {
        let conn = core.conn()?;
        repo::get_project(&conn, &request.project_id)?;
    }
    let text = request.text.trim();
    let context = request.context.trim();
    if text.is_empty() {
        return Err(AppError::validation("Write a prompt first; there is nothing to enhance."));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::validation(format!("The prompt is longer than {MAX_TEXT_CHARS} characters.")));
    }
    if context.chars().count() > MAX_CONTEXT_CHARS {
        return Err(AppError::validation(format!("The DNA context is longer than {MAX_CONTEXT_CHARS} characters.")));
    }
    let provider = find_provider(core, &request.provider_id)?;
    let info = provider.info();
    if provider.chat_model().is_none() {
        return Err(AppError::validation(format!("{} does not offer prompt enhancement.", info.label)));
    }
    let key = key_for(core, provider.as_ref());
    if provider.config_problem().is_some() || (info.requires_api_key && key.is_none()) {
        return Err(not_configured(provider.as_ref()));
    }
    let api_key = key.as_ref().map(|k| k.value.as_str());
    match provider.chat(SYSTEM_PROMPT, &user_message(text, context), api_key) {
        Ok(text) => Ok(EnhanceResult { text }),
        Err(e) => Err(AppError::new(ErrorCode::ProviderError, e.message).with_details(json!({
            "providerId": info.id,
            "kind": e.kind.as_str(),
            "retryable": e.kind.retryable(),
        }))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ProviderErrorKind;
    use crate::services::provider_settings;
    use crate::services::tests_support::{core_with_double, test_create_villa, TestBehavior, TEST_PROVIDER};

    fn request(project_id: &str, provider: &str, text: &str) -> EnhanceRequest {
        EnhanceRequest {
            project_id: project_id.into(),
            provider_id: provider.into(),
            text: text.into(),
            context: "  Two-storey tropical villa, white render, timber louvres.  ".into(),
        }
    }

    #[test]
    fn enhances_through_the_providers_chat_with_the_key_and_context() {
        let (_tmp, core, double) = core_with_double();
        let p = test_create_villa(&core, "Villa");
        provider_settings::set_api_key(&core, TEST_PROVIDER, "chat-key").unwrap();
        let out = enhance(&core, request(&p.id, TEST_PROVIDER, "  villa at dusk ")).unwrap();
        assert_eq!(out.text, "Enhanced: villa at dusk");
        let (system, user, key) = double.last_chat.lock().unwrap().clone().unwrap();
        assert_eq!(system, SYSTEM_PROMPT);
        assert_eq!(
            user,
            "Project DNA context (facts to preserve):\nTwo-storey tropical villa, white render, timber louvres.\n\n\
             Prompt to rewrite:\nvilla at dusk"
        );
        assert_eq!(key.as_deref(), Some("chat-key"));
        assert!(!serde_json::to_string(&out).unwrap().contains("chat-key"));
    }

    #[test]
    fn rejects_bad_input_before_calling_the_provider() {
        let (_tmp, core, double) = core_with_double();
        let p = test_create_villa(&core, "Villa");
        let code = |r: EnhanceRequest| enhance(&core, r).unwrap_err().code;
        assert_eq!(code(request("PRJ_01J9ZZZZZZZZZZZZZZZZZZZZZZ", TEST_PROVIDER, "x")), ErrorCode::NotFound);
        assert_eq!(code(request(&p.id, TEST_PROVIDER, "   ")), ErrorCode::ValidationError);
        assert_eq!(code(request(&p.id, TEST_PROVIDER, &"x".repeat(MAX_TEXT_CHARS + 1))), ErrorCode::ValidationError);
        assert_eq!(code(request(&p.id, "nope", "x")), ErrorCode::NotFound);
        assert_eq!(code(request(&p.id, crate::providers::local_preview::ID, "x")), ErrorCode::ValidationError);
        assert_eq!(code(request(&p.id, TEST_PROVIDER, "x")), ErrorCode::ProviderNotConfigured, "no key");
        assert!(double.last_chat.lock().unwrap().is_none());
    }

    #[test]
    fn provider_failures_are_provider_errors_with_kind_details() {
        let (_tmp, core, double) = core_with_double();
        let p = test_create_villa(&core, "Villa");
        provider_settings::set_api_key(&core, TEST_PROVIDER, "chat-key").unwrap();
        double.set_behavior(TestBehavior::Fail(ProviderErrorKind::RateLimited));
        let err = enhance(&core, request(&p.id, TEST_PROVIDER, "x")).unwrap_err();
        assert_eq!(err.code, ErrorCode::ProviderError);
        let details = err.details.unwrap();
        assert_eq!(details["kind"], "rate_limited");
        assert_eq!(details["retryable"], true);
        assert_eq!(details["providerId"], TEST_PROVIDER);
    }
}
