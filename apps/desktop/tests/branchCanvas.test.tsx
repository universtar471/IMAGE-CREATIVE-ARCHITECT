import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { COMPILER_VERSION, generationNodeId, imageNodeId, type PromptBundle } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { BranchCanvas } from "../src/features/canvas/BranchCanvas";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset, settled } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeAll(() => {
  // React Flow measures nodes; jsdom has no layout engine.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  (globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class {
    m22 = 1;
    constructor() {}
  };
});

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db, { generationDelayMs: 0 }));
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
  vi.useRealTimers();
  setTransport(null);
});

const prompt = (presetIds: string[]): PromptBundle => ({
  compilerVersion: COMPILER_VERSION,
  positivePrompt: "A villa at golden hour.",
  negativePrompt: "",
  referenceInstructions: "",
  preservationInstructions: "",
  metadata: {},
  shotIntent: { projectType: "villa", presetIds },
});

/** A sketch, a quick hero from it, then a branch from that hero's first output. */
async function seedBranches() {
  const p = await createProject({
    name: "Branches",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  db.assets.AST_SKETCH = asset(p.id, "AST_SKETCH", {
    role: "structure_sketch",
    source: "sketchup",
    originalName: "front.png",
  });
  const submit = async (refs: string[], presetIds: string[]) => {
    const queued = await call("generation_submit", {
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "hero",
      prompt: prompt(presetIds),
      referenceAssetIds: refs,
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 2, seed: 1, quality: null },
      cameraId: null,
    });
    return settled(p.id, queued.id);
  };
  const first = await submit(["AST_SKETCH"], ["time.golden_hour"]);
  // ADR-041: an AI output is a valid quick-generate source, so a branch needs no confirmed DNA.
  const second = await submit([first.outputAssetIds[0]!], ["time.night"]);
  await useStudio.getState().openProject(p.id);
  return { p, first, second };
}

const node = (id: string) => document.querySelector(`[data-node="${id}"]`);

describe("branch canvas (ADR-041)", () => {
  it("draws sources, generations and outputs from lineage", async () => {
    const { first, second } = await seedBranches();
    render(<BranchCanvas />);
    await waitFor(() => expect(node(imageNodeId("AST_SKETCH"))).toBeTruthy());
    expect(node(generationNodeId(first.id))).toBeTruthy();
    expect(node(generationNodeId(second.id))).toBeTruthy();
    for (const id of [...first.outputAssetIds, ...second.outputAssetIds])
      expect(node(imageNodeId(id))).toBeTruthy();
    expect(screen.getByText("Golden hour")).toBeTruthy();
    expect(screen.getByText("Night")).toBeTruthy();
  });

  it("uses a clicked image as the next source and reuses a generation's presets", async () => {
    const { first, second } = await seedBranches();
    render(<BranchCanvas />);
    const out = second.outputAssetIds[1]!;
    await waitFor(() => expect(node(imageNodeId(out))).toBeTruthy());
    fireEvent.click(node(imageNodeId(out))!);
    fireEvent.click(await screen.findByRole("button", { name: "Use as source" }));
    expect(useStudio.getState().generateDraft).toMatchObject({
      source: "sketch",
      purpose: "hero",
      referenceAssetIds: [out],
    });
    // The draft now hangs after that image, dashed, and never runs from here.
    await waitFor(() => expect(node("draft")).toBeTruthy());

    fireEvent.click(node(generationNodeId(first.id))!);
    fireEvent.click(await screen.findByRole("button", { name: "Reuse presets" }));
    expect(useStudio.getState().workspace?.shotIntent?.presetIds).toEqual(["time.golden_hour"]);
  });

  it("compares two images selected with Shift", async () => {
    const { first } = await seedBranches();
    render(<BranchCanvas />);
    const [a, b] = first.outputAssetIds;
    await waitFor(() => expect(node(imageNodeId(a!))).toBeTruthy());
    const button = screen.getByTestId("branch-compare-button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(node(imageNodeId(a!))!);
    fireEvent.keyDown(document, { key: "Shift" });
    fireEvent.click(node(imageNodeId(b!))!, { shiftKey: true });
    fireEvent.keyUp(document, { key: "Shift" });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    expect(await screen.findByTestId("branch-compare")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to branches" }));
    expect(await screen.findByTestId("branch-canvas")).toBeTruthy();
  });

  it("saves the layout after Re-arrange (debounced)", async () => {
    const { p } = await seedBranches();
    render(<BranchCanvas />);
    const rearrange = await screen.findByRole("button", { name: "Re-arrange" });
    await waitFor(() => expect((rearrange as HTMLButtonElement).disabled).toBe(false));
    db.canvasLayouts = {
      [p.id]: { layout: { version: 1, positions: { x: { x: 1, y: 1 } } }, updatedAt: "t" },
    };
    vi.useFakeTimers();
    fireEvent.click(rearrange);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    vi.useRealTimers();
    await waitFor(() => expect(db.canvasLayouts?.[p.id]?.layout.positions).toEqual({}));
  });
});
