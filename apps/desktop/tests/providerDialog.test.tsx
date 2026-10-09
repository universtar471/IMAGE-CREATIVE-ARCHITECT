/** Provider settings dialog: one card per backend provider, with per-provider key help. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { ProviderSettingsDialog } from "../src/features/providers/ProviderSettingsDialog";
import { PROVIDER_KEY_HELP } from "../src/features/providers/help";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport, MOCK_PROVIDERS } from "../src/lib/mockBackend";

beforeEach(() => {
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    providers: null,
    providersError: null,
    providerDialog: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

describe("provider settings dialog", () => {
  it("shows a card for every provider, OpenAI with its key page and billing note", async () => {
    useStudio.getState().openProviderDialog("openai");
    render(<ProviderSettingsDialog />);
    await screen.findByLabelText("OpenAI (GPT Image) API key");
    for (const p of MOCK_PROVIDERS) {
      expect(screen.getByRole("region", { name: p.label })).toBeTruthy();
    }

    const openai = screen.getByRole("list", { name: "OpenAI (GPT Image) key help" });
    expect(within(openai).getByText("platform.openai.com/api-keys")).toBeTruthy();
    expect(openai.textContent).toMatch(/platform\.openai\.com\/settings\/organization\/billing/);
    expect(openai.textContent).toMatch(/Organization Verification/);
    expect(openai.textContent).not.toMatch(/Gemini|Google|aistudio/i);

    const gemini = screen.getByRole("list", { name: "Google Gemini key help" });
    expect(gemini.textContent).toMatch(/aistudio\.google\.com\/apikey/);
    expect(gemini.textContent).not.toMatch(/openai/i);

    // The offline provider needs no key and gets no key help.
    const local = screen.getByRole("region", { name: "Local preview (offline)" });
    expect(within(local).queryByRole("list")).toBeNull();
  });

  it("has key help for every remote provider of the registry", () => {
    for (const p of MOCK_PROVIDERS.filter((p) => p.requiresApiKey)) {
      expect(PROVIDER_KEY_HELP[p.id], p.id).toBeDefined();
    }
  });
});
