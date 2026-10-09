//! Pure prompt composition. Gemini has no negative-prompt field, so every part of the
//! compiled `PromptBundle` is folded into one instruction text.

pub use super::super::text::compose_prompt;
use super::super::text::role_hint;

/// Short text part sent right before reference image `index` (1-based), e.g.
/// "Reference 1 — master architecture: preserve massing, openings and proportions".
pub fn reference_label(index: usize, role: &str) -> String {
    format!("Reference {index} — {}", role_hint(role))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_known_and_unknown_roles() {
        assert_eq!(
            reference_label(1, "master_architecture"),
            "Reference 1 — master architecture: preserve massing, openings and proportions"
        );
        assert_eq!(
            reference_label(3, "material_reference"),
            "Reference 3 — material reference: use only for materials, textures and finishes"
        );
        assert_eq!(reference_label(2, "future_role"), "Reference 2 — future role: loose inspiration only");
    }
}
