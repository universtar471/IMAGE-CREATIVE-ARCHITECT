/**
 * The Generate panel's extra prompt: free text the user adds on top of the prompt compiled
 * from Design DNA, and its optional AI enhancement (`prompt_enhance`). Pure helpers.
 */
import type { PromptBundle, ProviderDescriptorDTO } from "@arch/domain";

/** Provider whose chat model enhances prompts (HHTECH gateway). */
export const ENHANCE_PROVIDER_ID = "hhtech";

/** Longest extra prompt accepted (also the backend's `prompt_enhance` limit). */
export const MAX_EXTRA_PROMPT_CHARS = 4000;

/** The compiled bundle with the extra prompt appended to the positive prompt (blank = unchanged). */
export function withExtraPrompt(bundle: PromptBundle, extra: string | undefined): PromptBundle {
  const text = extra?.trim();
  if (!text) return bundle;
  const positivePrompt = bundle.positivePrompt.trim()
    ? `${bundle.positivePrompt.trim()}\n\n${text}`
    : text;
  return { ...bundle, positivePrompt };
}

/** Project DNA facts the enhancement must keep: the compiled positive + preservation text. */
export function enhanceContext(bundle: PromptBundle): string {
  return [bundle.positivePrompt, bundle.preservationInstructions]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Why "Enhance prompt" is disabled (tooltip text); null when it can run. */
export function enhanceDisabledReason(
  providers: readonly ProviderDescriptorDTO[],
  text: string,
  opts: { readOnly: boolean; busy: boolean },
): string | null {
  const provider = providers.find((p) => p.id === ENHANCE_PROVIDER_ID);
  if (!provider) return "Prompt enhancement needs the HHTECH provider.";
  if (!provider.configured)
    return "Set up HHTECH first: HHTECH_BASE_URL in .env and an API key in provider settings.";
  if (opts.readOnly) return "This project is archived (read-only).";
  if (opts.busy) return "Enhancing…";
  if (!text.trim()) return "Write an extra prompt first.";
  if (text.trim().length > MAX_EXTRA_PROMPT_CHARS)
    return `The extra prompt is longer than ${MAX_EXTRA_PROMPT_CHARS} characters.`;
  return null;
}
