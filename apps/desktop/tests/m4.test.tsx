import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { AnalysisDialog } from "../src/features/analysis/AnalysisDialog";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let submitted: Array<{ presetIds?: string[]; lighting?: unknown }>;
let assistScopes: string[];

beforeEach(() => {
  localStorage.removeItem("arch.generateMode");
  db = {
    projects: {},
    dna: {},
    assets: {},
    versions: [],
    providerKeys: { gemini: true, hhtech: true },
  };
  submitted = [];
  assistScopes = [];
  const base = createMockTransport(db, { generationDelayMs: 0 });
  const transport: Transport = async (command, args) => {
    if (command === "generation_submit") {
      const req = args.request as { prompt: { shotIntent?: (typeof submitted)[number] } };
      submitted.push(req.prompt.shotIntent ?? {});
    }
    if (command === "dna_assist") assistScopes.push((args.request as { scope: string }).scope);
    // jsdom cannot fetch the mock's file paths: answer previews with a tiny PNG.
    if (command === "asset_preview")
      return new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    return base(command, args);
  };
  setTransport(transport);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    providers: null,
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

async function openWithSketch() {
  const p = await createProject({
    name: "M4",
    projectType: "townhouse",
    subtype: "default",
    starter: { floors: 3 },
  });
  db.assets.AST_VIEW = asset(p.id, "AST_VIEW", {
    role: "structure_sketch",
    source: "sketchup",
    originalName: "street.png",
  });
  await useStudio.getState().openProject(p.id);
  await useStudio.getState().loadProviders();
  useStudio.getState().setGenerateDraft({
    source: "sketch",
    purpose: "hero",
    referenceAssetIds: ["AST_VIEW"],
  });
  return p;
}

describe("image recipes (ADR-042)", () => {
  it("runs the ticked variants behind one spend confirm, one generation each", async () => {
    await openWithSketch();
    render(<GeneratePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Viewport to photo" }));
    fireEvent.click(screen.getByText("Recipes (several variants)"));
    fireEvent.click(screen.getByRole("button", { name: "6 lighting scenarios" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Night" }));
    const run = screen.getByTestId("recipe-run");
    expect(run.textContent).toContain("Run 5 variants");
    await waitFor(() => expect((run as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(run);
    const dialog = await screen.findByRole("dialog", { name: "Confirm cost" });
    expect(submitted).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create images" }));
    await waitFor(() => expect(submitted).toHaveLength(5));
    expect(submitted.map((s) => (s.lighting as { timeOfDay: string }).timeOfDay)).toEqual([
      "morning",
      "midday",
      "golden_hour",
      "afternoon",
      "blue_hour",
    ]);
    expect(submitted.every((s) => s.presetIds?.includes("render.viewport_to_photo"))).toBe(true);
  });

  it("marks facade colours as not fitting an interior shot", async () => {
    const p = await createProject({
      name: "Indoor",
      projectType: "interior",
      subtype: "default",
      starter: {},
    });
    await useStudio.getState().openProject(p.id);
    await useStudio.getState().loadProviders();
    render(<GeneratePanel />);
    fireEvent.click(screen.getByText("Recipes (several variants)"));
    fireEvent.click(screen.getByRole("button", { name: "Facade colour options" }));
    expect(screen.getAllByText(/does not fit this shot/)).toHaveLength(4);
    expect((screen.getByTestId("recipe-run") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("evidence analysis (ADR-042)", () => {
  it("analyses only on click and draws the board from the reply", async () => {
    const p = await openWithSketch();
    const target = useStudio.getState().workspace!.assets.find((a) => a.id === "AST_VIEW")!;
    render(<AnalysisDialog asset={{ ...target, projectId: p.id }} onClose={() => {}} />);
    expect(assistScopes).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Analyse" }));
    const board = await screen.findByTestId("analysis-board");
    expect(assistScopes).toEqual(["analysis"]);
    const svg = decodeURIComponent((board as HTMLImageElement).src.split(",")[1]!);
    expect(svg).toContain("Inferred from the image by AI");
    expect(svg).toContain("Timber louvres — upper floor screen (fairly clear)");
    expect(screen.getByRole("button", { name: "Save as image" })).toBeTruthy();
  });
});
