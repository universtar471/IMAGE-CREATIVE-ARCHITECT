/** Extra prompt + "Enhance prompt" (HHTECH chat) in the Generate panel, against the mock backend. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COMPILER_VERSION, type PromptBundle, type ProviderDescriptorDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { ExtraPromptSection } from "../src/features/generate/ExtraPromptSection";
import {
  enhanceContext,
  enhanceDisabledReason,
  withExtraPrompt,
} from "../src/features/generate/extraPrompt";
import { BridgeError, call, setTransport } from "../src/lib/bridge";
import { createMockTransport, mockEnhance } from "../src/lib/mockBackend";
import { settled, waitFor } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db, { generationDelayMs: 0 }));
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

const bundle = (positivePrompt: string, preservationInstructions = ""): PromptBundle => ({
  compilerVersion: COMPILER_VERSION,
  positivePrompt,
  negativePrompt: "blurry",
  referenceInstructions: "",
  preservationInstructions,
  metadata: {},
});

const newProject = () =>
  createProject({
    name: "Enhance",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });

async function openWithHhtech(configured: boolean) {
  const p = await newProject();
  if (configured) await call("provider_set_api_key", { providerId: "hhtech", apiKey: "k" });
  await useStudio.getState().openProject(p.id);
  await useStudio.getState().loadProviders();
  return p;
}

describe("extra prompt helpers", () => {
  it("appends the extra prompt to the positive prompt only when it has text", () => {
    expect(withExtraPrompt(bundle("DNA prompt."), "  at dusk  ").positivePrompt).toBe(
      "DNA prompt.\n\nat dusk",
    );
    expect(withExtraPrompt(bundle("DNA prompt."), "   ")).toEqual(bundle("DNA prompt."));
    expect(withExtraPrompt(bundle(""), "only mine").positivePrompt).toBe("only mine");
  });

  it("sends positive and preservation text as the DNA context", () => {
    expect(enhanceContext(bundle(" Villa. ", " Keep the roof. "))).toBe("Villa.\n\nKeep the roof.");
  });

  it("explains why Enhance is disabled", () => {
    const hh = (configured: boolean) =>
      ({ id: "hhtech", configured }) as unknown as ProviderDescriptorDTO;
    const opts = { readOnly: false, busy: false };
    expect(enhanceDisabledReason([], "x", opts)).toMatch(/HHTECH provider/);
    expect(enhanceDisabledReason([hh(false)], "x", opts)).toMatch(/HHTECH_BASE_URL/);
    expect(enhanceDisabledReason([hh(true)], " ", opts)).toMatch(/Write an extra prompt/);
    expect(enhanceDisabledReason([hh(true)], "x", { ...opts, readOnly: true })).toMatch(/archived/);
    expect(enhanceDisabledReason([hh(true)], "x", opts)).toBeNull();
  });
});

describe("mock prompt_enhance", () => {
  it("is deterministic and needs a configured HHTECH", async () => {
    const p = await newProject();
    const req = { projectId: p.id, providerId: "hhtech", text: "villa at dusk.", context: "DNA" };
    const err = await call("prompt_enhance", req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe("PROVIDER_NOT_CONFIGURED");
    await call("provider_set_api_key", { providerId: "hhtech", apiKey: "k" });
    const out = await call("prompt_enhance", req);
    expect(out.text).toBe(mockEnhance("villa at dusk.", "DNA"));
    expect((await call("prompt_enhance", req)).text).toBe(out.text);
    const other = await call("prompt_enhance", { ...req, providerId: "openai" }).catch(
      (e: unknown) => e as BridgeError,
    );
    expect((other as BridgeError).code).toBe("VALIDATION_ERROR");
  });
});

describe("ExtraPromptSection", () => {
  it("is disabled with a tooltip while HHTECH is not configured", async () => {
    await openWithHhtech(false);
    useStudio.getState().setGenerateDraft({ extraPrompt: "villa at dusk" });
    render(<ExtraPromptSection referenceIds={[]} disabled={false} />);
    const button = screen.getByTestId("enhance-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.parentElement!.getAttribute("title")).toMatch(/HHTECH_BASE_URL/);
  });

  it("previews, accepts (undo-able) and discards an enhancement", async () => {
    await openWithHhtech(true);
    render(<ExtraPromptSection referenceIds={[]} disabled={false} />);
    const box = screen.getByTestId("extra-prompt") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "villa at dusk" } });
    expect(useStudio.getState().generateDraft.extraPrompt).toBe("villa at dusk");

    fireEvent.click(screen.getByTestId("enhance-button"));
    const preview = await waitFor(() => screen.queryByTestId("enhance-preview"), "preview");
    expect(preview.textContent).toContain("villa at dusk, with crisp material detail");
    expect(useStudio.getState().generateDraft.extraPrompt).toBe("villa at dusk"); // not applied before Accept

    fireEvent.click(screen.getByTestId("enhance-accept"));
    const enhanced = useStudio.getState().generateDraft.extraPrompt!;
    expect(enhanced).toContain("Keeps every Project DNA fact");
    expect((screen.getByTestId("extra-prompt") as HTMLTextAreaElement).value).toBe(enhanced);

    fireEvent.click(screen.getByTestId("enhance-undo"));
    expect(useStudio.getState().generateDraft.extraPrompt).toBe("villa at dusk");
    expect(screen.queryByTestId("enhance-undo")).toBeNull();

    fireEvent.click(screen.getByTestId("enhance-button"));
    await waitFor(() => screen.queryByTestId("enhance-preview"), "second preview");
    fireEvent.click(screen.getByTestId("enhance-discard"));
    expect(screen.queryByTestId("enhance-preview")).toBeNull();
    expect(useStudio.getState().generateDraft.extraPrompt).toBe("villa at dusk");
  });
});

describe("submit with an extra prompt", () => {
  it("appends it to the compiled positive prompt and never sends extraPrompt itself", async () => {
    const p = await newProject();
    await useStudio.getState().openProject(p.id);
    const g = await useStudio.getState().submitGeneration({
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation",
      referenceAssetIds: [],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null },
      extraPrompt: "  wet street reflections  ",
    });
    expect(g).toBeDefined();
    const done = await settled(p.id, g!.id);
    expect(done.prompt.positivePrompt.endsWith("\n\nwet street reflections")).toBe(true);
    expect(JSON.stringify(db)).not.toContain("extraPrompt");
  });
});
