/**
 * Where to get a key and what the account needs, per provider id. Shown in the provider
 * settings dialog; providers without an entry show no help. URLs are plain text (the
 * desktop webview does not open external links) and come from the vendors' own docs.
 * The notes are dictionary keys (`providers.help.*`), so they follow the UI language.
 */
import type { TKey } from "../../i18n";

export interface ProviderKeyHelp {
  /** Page where the user creates an API key. */
  keyUrl: string;
  /** Account requirements worth knowing before the first paid call. */
  notes: readonly TKey[];
}

export const PROVIDER_KEY_HELP: Readonly<Record<string, ProviderKeyHelp>> = {
  gemini: {
    keyUrl: "aistudio.google.com/apikey",
    notes: ["providers.help.gemini.billing"],
  },
  openai: {
    keyUrl: "platform.openai.com/api-keys",
    notes: ["providers.help.openai.billing", "providers.help.openai.verification"],
  },
  hhtech: {
    keyUrl: "hhtechapi.com",
    notes: ["providers.help.hhtech.baseUrl", "providers.help.hhtech.optional"],
  },
};

export function providerKeyHelp(providerId: string): ProviderKeyHelp | null {
  return PROVIDER_KEY_HELP[providerId] ?? null;
}
