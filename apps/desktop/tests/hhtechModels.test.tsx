/** HHTECH catalog in the Generate panel: tiers, quality choice and the cost hint (mock backend). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COMPILER_VERSION, type GenerationSubmitRequest } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { BridgeError, call, setTransport } from "../src/lib/bridge";
import { createMockTransport, MOCK_PROVIDERS } from "../src/lib/mockBackend";
import { asset, confirmAllDna } from "./helpers";

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

const hhtech = MOCK_PROVIDERS.find((p) => p.id === "hhtech")!;

async function openWithHhtech() {
  const p = await createProject({
    name: "Tiers",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  const masterId = `AST_M_${p.id}`;
  db.assets[masterId] = asset(p.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: p.id, assetId: masterId });
  await confirmAllDna(p.id, { approveMaster: true });
  await call("provider_set_api_key", { providerId: "hhtech", apiKey: "k" });
  await useStudio.getState().openProject(p.id);
  await useStudio.getState().loadProviders();
  useStudio.getState().setGenerateDraft({ providerId: "hhtech" });
  return p;
}

const qualityGroup = () => screen.queryByRole("group", { name: "Quality" });
const cost = () => screen.queryByTestId("generate-cost")?.textContent ?? null;
const draftParams = () => useStudio.getState().generateDraft.params;

describe("HHTECH catalog (mock mirrors providers/hhtech/catalog.rs)", () => {
  it("lists the six models best first, with prices, tiers and quality options", () => {
    expect(hhtech.models.map((m) => m.id)).toEqual([
      "gpt-image-2.5-sunburst",
      "gemini-3-pro-image",
      "gpt-image-2.5-flare",
      "gpt-image-2",
      "gemini-3.1-flash-image",
      "gemini-2.5-flash-image",
    ]);
    const [sunburst, banana] = hhtech.models;
    expect(sunburst!.label).toBe("GPT Image 2.5 Sunburst · 1K 280đ / 2K 600đ / 4K 900đ");
    expect(sunburst!.imageSizes).toEqual(["1K", "2K", "4K"]);
    expect(sunburst!.qualityOptions).toEqual(["low", "medium", "high"]);
    expect(banana!.label).toBe("Gemini 3 Pro Image (Banana) · 2K 500đ / 4K 800đ");
    expect(banana!.qualityOptions).toEqual([]);
    expect(banana!.imageSizes).toEqual(["2K", "4K"]);
    expect(banana!.priceHint).toEqual({ "2K": 500, "4K": 800 });
    for (const p of MOCK_PROVIDERS.filter((x) => x.id !== "hhtech")) {
      for (const m of p.models) {
        expect(m.qualityOptions, `${p.id}/${m.id}`).toEqual([]);
        expect(m.priceHint).toBeNull();
      }
    }
  });
});

describe("Generate panel with HHTECH", () => {
  it("shows tier, quality and the estimated cost for a GPT model", async () => {
    await openWithHhtech();
    render(<GeneratePanel />);
    expect(screen.getByLabelText("Image size")).toBeTruthy();
    expect(qualityGroup()).not.toBeNull();
    expect(cost()).toBe("≈ 280đ");

    fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "2K" } });
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(cost()).toBe("≈ 1.200đ");

    fireEvent.click(screen.getByRole("button", { name: "High" }));
    expect(draftParams()).toMatchObject({ imageSize: "2K", outputCount: 2, quality: "high" });
    expect(screen.getByRole("button", { name: "High" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Default" }));
    expect(draftParams()?.quality).toBeNull();
  });

  it("hides quality for Gemini, defaults to the priced 2K tier", async () => {
    await openWithHhtech();
    useStudio.getState().setGenerateDraft({ modelId: "gemini-3-pro-image", params: null });
    render(<GeneratePanel />);
    expect(qualityGroup()).toBeNull();
    expect(cost()).toBe("≈ 500đ");
    expect(draftParams() ?? null).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Image size").value).toBe("2K");
    fireEvent.change(screen.getByLabelText("Image size"), { target: { value: "4K" } });
    expect(cost()).toBe("≈ 800đ");
  });

  it("drops a chosen quality when switching to a model without the choice", async () => {
    await openWithHhtech();
    useStudio.getState().setGenerateDraft({
      params: { aspectRatio: "1:1", imageSize: "1K", outputCount: 1, seed: null, quality: "low" },
    });
    useStudio.getState().setGenerateDraft({ modelId: "gemini-3-pro-image" });
    render(<GeneratePanel />);
    expect(screen.queryByTestId("generate-disabled-reason")?.textContent ?? "").not.toMatch(
      /quality/i,
    );
  });

  it("shows no cost and no quality for unpriced providers", async () => {
    await openWithHhtech();
    useStudio.getState().setGenerateDraft({ providerId: "local_preview", params: null });
    render(<GeneratePanel />);
    expect(qualityGroup()).toBeNull();
    expect(cost()).toBeNull();
  });
});

describe("mock generation_submit enforces quality", () => {
  const request = (projectId: string, modelId: string, quality: "high" | null) =>
    ({
      projectId,
      providerId: "hhtech",
      modelId,
      purpose: "variation",
      prompt: {
        compilerVersion: COMPILER_VERSION,
        positivePrompt: "Villa",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
      referenceAssetIds: [],
      params: { aspectRatio: "16:9", imageSize: "2K", outputCount: 1, seed: null, quality },
      cameraId: null,
    }) satisfies GenerationSubmitRequest;

  it("accepts an offered quality and rejects one on Gemini", async () => {
    const p = await openWithHhtech();
    const ok = await call("generation_submit", request(p.id, "gpt-image-2.5-sunburst", "high"));
    expect(ok.params.quality).toBe("high");
    const err = await call("generation_submit", request(p.id, "gemini-3-pro-image", "high")).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe("VALIDATION_ERROR");
  });
});
