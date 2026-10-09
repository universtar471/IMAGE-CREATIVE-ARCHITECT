//! Pure prompt composition. The Images API takes a single `prompt` string (max 32,000
//! characters) and has no negative-prompt field, and its `image[]` uploads carry no text, so
//! the role of each reference image is described in the prompt itself, numbered in upload order.

use super::super::text::{compose_prompt, role_hint};
use super::super::{PromptText, ReferenceImage};

/// Documented maximum length of `prompt` for both endpoints.
pub const MAX_PROMPT_CHARS: usize = 32_000;

/// The folded prompt (positive, reference instructions, preservation, `Avoid: …`), then, when
/// there are references, a numbered list of what each input image is for:
///
/// ```text
/// Input images, in the order they are attached:
/// 1. master architecture: preserve massing, openings and proportions
/// 2. material reference: use only for materials, textures and finishes
/// ```
pub fn build_prompt(prompt: &PromptText, references: &[ReferenceImage]) -> String {
    let text = compose_prompt(prompt);
    if references.is_empty() || text.is_empty() {
        return text;
    }
    let list = references
        .iter()
        .enumerate()
        .map(|(i, reference)| format!("{}. {}", i + 1, role_hint(&reference.role)))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{text}\n\nInput images, in the order they are attached:\n{list}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(positive: &str, negative: &str) -> PromptText {
        PromptText {
            positive: positive.into(),
            negative: negative.into(),
            reference_instructions: "Image 1 is the master.".into(),
            preservation_instructions: "Keep the roof form.".into(),
        }
    }

    fn reference(role: &str) -> ReferenceImage {
        ReferenceImage { asset_id: "A".into(), role: role.into(), mime_type: "image/png".into(), bytes: vec![1] }
    }

    #[test]
    fn without_references_it_is_the_folded_prompt() {
        assert_eq!(
            build_prompt(&text("A villa at dusk.", "warped lines"), &[]),
            "A villa at dusk.\n\nImage 1 is the master.\n\nKeep the roof form.\n\nAvoid: warped lines"
        );
    }

    #[test]
    fn references_are_listed_by_role_in_upload_order() {
        let refs = [reference("master_architecture"), reference("lighting_reference"), reference("odd_role")];
        assert_eq!(
            build_prompt(&text("A villa at dusk.", ""), &refs),
            "A villa at dusk.\n\nImage 1 is the master.\n\nKeep the roof form.\n\n\
             Input images, in the order they are attached:\n\
             1. master architecture: preserve massing, openings and proportions\n\
             2. lighting reference: use only for light direction, time of day and shadows\n\
             3. odd role: loose inspiration only"
        );
    }

    #[test]
    fn an_empty_prompt_stays_empty_even_with_references() {
        let empty = PromptText {
            positive: " ".into(),
            negative: String::new(),
            reference_instructions: String::new(),
            preservation_instructions: String::new(),
        };
        assert_eq!(build_prompt(&empty, &[reference("master_architecture")]), "");
    }
}
