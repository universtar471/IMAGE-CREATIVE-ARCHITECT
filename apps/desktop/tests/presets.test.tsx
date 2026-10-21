import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";
import type * as FileHelpers from "../src/lib/files";

vi.mock("../src/lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof FileHelpers>()),
  pickImages: vi.fn(async () => ["mock://viewport.png"]),
}));

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let submits: number;

beforeEach(() => {
  localStorage.removeItem("arch.generateMode");
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  submits = 0;
  const base = createMockTransport(db);
  const transport: Transport = async (command, args) => {
    if (command === "provider_list") {
      const providers = (await base(command, args)) as Array<{ id: string; configured: boolean }>;
      return providers.map((p) => (p.id === "gemini" ? { ...p, configured: true } : p));
    }
    if (command === "asset_import") {
      const request = args.request as { projectId: string; source: "external" };
      const imported = asset(request.projectId, "AST_VIEWPORT", {
        role: "structure_sketch",
        source: request.source,
        originalName: "viewport.png",
      });
      db.assets[imported.id] = imported;
      return imported;
    }
    if (command === "generation_submit") submits++;
    return base(command, args);
  };
  setTransport(transport);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    providers: null,
    providersError: null,
    run: null,
    jobs: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTransport(null);
});

async function openPanel(projectType: "villa" | "interior" = "villa") {
  const project = await createProject({
    name: "Presets",
    projectType,
    subtype: projectType === "villa" ? "tropical" : "default",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  render(<GeneratePanel />);
}

const shot = () => useStudio.getState().workspace?.shotIntent;

describe("Generate panel modes (ADR-039)", () => {
  it("keeps a variation source across model changes and shows camera choices instead of render setup", async () => {
    await openPanel();
    const projectId = useStudio.getState().workspace!.project.id;
    const original = asset(projectId, "AST_VARIANT", {
      source: "ai_generated",
      role: "regular_image",
    });
    await act(async () => {
      await useStudio.getState().adoptAssets(projectId, [original]);
      useStudio.getState().setGenerateDraft({
        source: "sketch",
        purpose: "variation",
        referenceAssetIds: [original.id],
      });
    });
    expect(screen.getByTestId("variation-source")).toBeTruthy();
    expect(document.querySelector('[data-preset="render.sketch_to_photo"]')).toBeNull();
    expect(document.querySelector('[data-preset="camera.detail"]')).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), {
      target: { value: "gemini" },
    });
    const model = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    fireEvent.change(model, { target: { value: model.options[model.options.length - 1]!.value } });
    expect(useStudio.getState().generateDraft.referenceAssetIds).toEqual([original.id]);
    expect(screen.getByTestId("variation-source")).toBeTruthy();
  });
  it("opens in Simple mode with provider selection, source and presets", async () => {
    await openPanel();
    expect(screen.queryByTestId("generate-mode-simple")).toBeNull();
    expect(screen.getByTestId("preset-studio")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
    expect(screen.queryByTestId("generate-anchors")).toBeNull();
  });

  it("ignores the old Advanced preference and keeps the compact source/preset controls", async () => {
    localStorage.setItem("arch.generateMode", "advanced");
    await openPanel();
    expect(screen.queryByTestId("generate-mode-advanced")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
    expect(screen.queryByTestId("generate-anchors")).toBeNull();
    expect(screen.getByTestId("preset-studio")).toBeTruthy();
  });
});

describe("Preset grid", () => {
  it("adds a chip, writes the shot intent and replaces exclusive peers", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Golden hour" }));
    expect(screen.getByTestId("preset-chip-time.golden_hour")).toBeTruthy();
    expect(shot()?.lighting).toEqual({ timeOfDay: "golden_hour" });
    fireEvent.click(screen.getByRole("button", { name: "Night" }));
    expect(screen.queryByTestId("preset-chip-time.golden_hour")).toBeNull();
    expect(shot()?.presetIds).toEqual(["time.night"]);
    expect(useStudio.getState().workspace?.draftDna.lighting?.timeOfDay).not.toBe("night");
    fireEvent.click(screen.getByRole("button", { name: "Remove Night" }));
    expect(shot()).toBeUndefined();
  });

  it("feeds the same fields the Advanced panels edit", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Aerial" }));
    fireEvent.click(screen.getByRole("button", { name: "A few people" }));
    expect(shot()?.visualIntent).toEqual({ view: "aerial", purpose: "landscape" });
    expect(shot()?.sceneObjects).toHaveLength(1);
  });

  it("hides exterior-only presets in an interior project", async () => {
    await openPanel("interior");
    expect(screen.queryByRole("button", { name: "Aerial" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Parked sedan" })).toBeNull();
    expect(screen.getByRole("button", { name: "Golden hour" })).toBeTruthy();
  });
});

describe("Quick generate", () => {
  it("allows hero and anchor actions without confirmed DNA", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "From sketch / massing" }));
    fireEvent.click(screen.getByRole("button", { name: "Import sketch" }));
    await waitFor(() => expect(useStudio.getState().workspace?.assets).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Viewport to photo" }));
    await waitFor(() => expect(screen.queryByTestId("generate-disabled-reason")).toBeNull());
    fireEvent.click(screen.getByTestId("generate-button"));
    expect(await screen.findByRole("dialog", { name: "Confirm cost" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(submits).toBe(0);

    expect(screen.queryByTestId("generate-mode-advanced")).toBeNull();
  });

  it("allows DNA-only hero without confirming the DNA", async () => {
    await openPanel();
    expect(screen.queryByTestId("generate-disabled-reason")).toBeNull();
    expect((screen.getByTestId("generate-button") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("Advisory preset conflicts", () => {
  it("keeps Generate enabled for Dawn, City car and Vehicle light trails", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "Dawn" }));
    fireEvent.click(screen.getByRole("button", { name: "City car" }));
    fireEvent.click(screen.getByRole("button", { name: "Vehicle light trails" }));
    expect(screen.getByTestId("conflict-panel")).toBeTruthy();
    expect((screen.getByTestId("generate-button") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("generate-button"));
    expect(await screen.findByRole("dialog", { name: "Confirm cost" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(submits).toBe(0);
  });
});
