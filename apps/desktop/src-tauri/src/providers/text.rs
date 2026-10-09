//! Pure text helpers shared by the remote adapters: prompt folding, reference-role hints and
//! the redaction applied to every vendor string before it reaches a user message or `meta`.

use super::PromptText;

/// Max characters of vendor text (model notes, error messages) copied into a user message.
pub const MAX_VENDOR_TEXT: usize = 200;

/// One text: positive prompt, reference instructions, preservation instructions, then
/// `Avoid: <negative>`. Empty sections are skipped; sections are separated by a blank line.
/// Used by vendors without a negative-prompt field.
pub fn compose_prompt(prompt: &PromptText) -> String {
    let negative = prompt.negative.trim();
    let avoid = if negative.is_empty() { String::new() } else { format!("Avoid: {negative}") };
    [prompt.positive.trim(), prompt.reference_instructions.trim(), prompt.preservation_instructions.trim(), &avoid]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// What a reference image of asset role `role` is for, e.g.
/// "master architecture: preserve massing, openings and proportions".
pub fn role_hint(role: &str) -> String {
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
        other => return format!("{}: loose inspiration only", other.replace('_', " ")),
    };
    hint.to_string()
}

/// Collapse whitespace, strip the key if it was echoed, and cap the length.
pub fn sanitize(text: &str, api_key: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let redacted = if api_key.is_empty() { collapsed } else { collapsed.replace(api_key, "[redacted]") };
    truncate(&redacted, MAX_VENDOR_TEXT)
}

pub fn truncate(text: &str, max_chars: usize) -> String {
    match text.char_indices().nth(max_chars) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text.to_string(),
    }
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
    fn hints_known_and_unknown_roles() {
        assert_eq!(
            role_hint("material_reference"),
            "material reference: use only for materials, textures and finishes"
        );
        assert_eq!(role_hint("future_role"), "future role: loose inspiration only");
    }

    #[test]
    fn sanitize_redacts_collapses_and_caps() {
        assert_eq!(sanitize("a  b\n c sk-123", "sk-123"), "a b c [redacted]");
        assert_eq!(sanitize("plain", ""), "plain");
        let long = sanitize(&"x".repeat(500), "k");
        assert_eq!(long.chars().count(), MAX_VENDOR_TEXT + 1, "capped plus the ellipsis");
    }
}
