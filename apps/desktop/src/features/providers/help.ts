/**
 * Where to get a key and what the account needs, per provider id. Shown in the provider
 * settings dialog; providers without an entry show no help. URLs are plain text (the
 * desktop webview does not open external links) and come from the vendors' own docs.
 */
export interface ProviderKeyHelp {
  /** Page where the user creates an API key. */
  keyUrl: string;
  /** Account requirements worth knowing before the first paid call. */
  notes: readonly string[];
}

export const PROVIDER_KEY_HELP: Readonly<Record<string, ProviderKeyHelp>> = {
  gemini: {
    keyUrl: "aistudio.google.com/apikey",
    notes: [
      "Image models need billing enabled on the key's project; the free tier has little or no image quota.",
    ],
  },
  openai: {
    keyUrl: "platform.openai.com/api-keys",
    notes: [
      "Image generation is billed per use: add prepaid credits at platform.openai.com/settings/organization/billing.",
      "GPT Image models may require Organization Verification (platform.openai.com/settings/organization/general).",
    ],
  },
  hhtech: {
    keyUrl: "hhtechapi.com",
    notes: [
      "Also needs HHTECH_BASE_URL (e.g. https://hhtechapi.com/v1) in the environment or .env; restart the app after changing it.",
      "Optional: HHTECH_IMAGE_MODEL (comma-separated), HHTECH_IMAGE_SIZE, HHTECH_IMAGE_QUALITY, HHTECH_CHAT_MODEL (used by Enhance prompt).",
    ],
  },
};

export function providerKeyHelp(providerId: string): ProviderKeyHelp | null {
  return PROVIDER_KEY_HELP[providerId] ?? null;
}
