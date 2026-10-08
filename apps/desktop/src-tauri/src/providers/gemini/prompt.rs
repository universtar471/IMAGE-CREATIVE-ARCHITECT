//! Pure prompt composition. Gemini has no negative-prompt field, so every part of the
//! compiled `PromptBundle` is folded into one instruction text.

use super::super::PromptText;

/// One text: positive prompt, reference instructions, preservation instructions, then
/// `Avoid: <negative>`. Empty sections are skipped; sections are separated by a blank line.
pub fn compose_prompt(prompt: &PromptText) -> String {
    let negative = prompt.negative.trim();
    let avoid = if negative.is_empty() { String::new() } else { format!("Avoid: {negative}") };
    [prompt.positive.trim(), prompt.reference_instructions.trim(), prompt.preservation_instructions.trim(), &avoid]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Short text part sent right before reference image `index` (1-based), e.g.
/// "Reference 1 — master architecture: preserve massing, openings and proportions".
pub fn reference_label(index: usize, role: &str) -> String {
    let hint = match role {
        "master_architecture" => "master architecture: preserve massing, openings and proportions",
        "architecture_reference" => "architecture reference: borrow architectural language and detailing only",
        "material_reference" => "material reference: use only for materials, textures and finishes",
        "context_reference" => "context reference: use only for the surrounding streets and setting",
        "landscape_reference" => "landscape reference: use only for planting, hardscape and terrain",
        "lighting_reference" => "lighting reference: use only for light direction, time of day and shadows",
        "mood_reference" => "mood reference: use only for atmosphere and color grading",
        "camera_reference" => "camera reference: use only for viewpoint, lens and framing",
        "regular_image" => "general image: loose inspiration only",
        other => return format!("Reference {index} — {}: loose inspiration only", other.replace('_', " ")),
    };
    format!("Reference {index} — {hint}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(positive: &str, negative: &str, refs: &str, keep: &str) -> PromptText {
        PromptText {
            positive: positive.into(),
            negative: negative.into(),
            reference_instructions: refs.into(),
            preservation_instructions: keep.into(),
        }
    }

    #[test]
    fn composes_all_sections_in_order() {
        let out =
            compose_prompt(&text("A villa at dusk.", "warped lines, low resolution", "Ref 1 is master.", "Keep roof."));
        assert_eq!(out, "A villa at dusk.\n\nRef 1 is master.\n\nKeep roof.\n\nAvoid: warped lines, low resolution");
    }

    #[test]
    fn skips_empty_and_whitespace_sections() {
        assert_eq!(compose_prompt(&text("  A villa.  ", "   ", "", "\n")), "A villa.");
        assert_eq!(compose_prompt(&text("", "blur", "", "")), "Avoid: blur");
        assert_eq!(compose_prompt(&text("", "", "", "")), "");
    }

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
