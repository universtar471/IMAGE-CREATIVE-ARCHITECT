import { afterEach, beforeAll, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { EnhancePanel } from "../src/features/enhance/EnhancePanel";
import { PostStepFrame } from "../src/features/workflow/StepFrame";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function setup() {
  const db = { projects: {}, dna: {}, assets: {}, versions: [] } as NonNullable<
    Parameters<typeof createMockTransport>[0]
  >;
  setTransport(createMockTransport(db, { generationDelayMs: 0 }));
  useStudio.setState({
    workspace: null,
    providers: null,
    workspaceMode: "node",
    canvasSelection: [],
  });
  const project = await createProject({
    name: "Imported house",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  db.assets ??= {};
  db.assets.AST_IMPORT = asset(project.id, "AST_IMPORT", {
    role: "regular_image",
    source: "external",
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  return project;
}

it("enables local enhance and colour controls for an external image without changing Master", async () => {
  await setup();
  const { unmount } = render(<EnhancePanel />);
  const run = document.querySelector<HTMLButtonElement>(
    '[data-testid="enhance-panel"] .btn-primary',
  )!;
  expect(run).toBeTruthy();
  expect(run.disabled).toBe(false);
  expect(screen.queryByText(/Approve a Master/)).toBeNull();
  unmount();
  render(
    <PostStepFrame>
      <button>Grade input</button>
    </PostStepFrame>,
  );
  expect(screen.getByRole("button", { name: "Grade input" }).closest("fieldset")?.disabled).toBe(
    false,
  );
  expect(useStudio.getState().workspace?.project.activeMasterAssetId).toBeNull();
});

it("syncs tray/import selection with the node selection", async () => {
  await setup();
  useStudio.getState().selectAsset("AST_IMPORT");
  expect(useStudio.getState().canvasSelection).toEqual(["asset:AST_IMPORT"]);
});

it("enables Create hero for a single ordinary image selected as source", async () => {
  await setup();
  useStudio.getState().setGenerateDraft({
    source: "sketch",
    purpose: "hero",
    providerId: "local_preview",
    referenceAssetIds: ["AST_IMPORT"],
  });
  render(<GeneratePanel />);
  const generate = screen.getByRole<HTMLButtonElement>("button", { name: /Generate hero/i });
  expect(generate.disabled).toBe(false);
  expect(screen.queryByText(/reference image is listed twice/i)).toBeNull();
  expect(useStudio.getState().workspace?.project.activeMasterAssetId).toBeNull();
});

it("keeps source instructions inside help instead of showing long text in the form", async () => {
  await setup();
  useStudio.getState().setGenerateDraft({ source: "sketch", purpose: "hero" });
  render(<GeneratePanel />);
  const help = screen.getByRole("button", { name: /Help:.*sketch/i });
  expect(screen.queryByText(/Upload a SketchUp/)).toBeNull();
  fireEvent.click(help);
  await waitFor(() => expect(screen.getByRole("note").textContent).toMatch(/SketchUp/));
});

it("shows provider and model selection in simple mode and allows DNA-only generation", async () => {
  localStorage.setItem("arch.generateMode", "simple");
  await setup();
  useStudio.getState().setGenerateDraft({
    source: "dna",
    purpose: "hero",
    providerId: "local_preview",
    referenceAssetIds: [],
  });
  render(<GeneratePanel />);
  const provider = screen.getByRole<HTMLSelectElement>("combobox", { name: "Provider" });
  fireEvent.change(provider, { target: { value: "gemini" } });
  expect(useStudio.getState().generateDraft.providerId).toBe("gemini");
  const model = screen.getByRole<HTMLSelectElement>("combobox", { name: "Model" });
  fireEvent.change(model, { target: { value: "gemini-2.5-flash-image" } });
  expect(useStudio.getState().generateDraft.modelId).toBe("gemini-2.5-flash-image");
  expect(screen.getByTestId("generate-disabled-reason").textContent).toMatch(/API key/);
  fireEvent.change(provider, { target: { value: "local_preview" } });
  expect(screen.getByTestId<HTMLButtonElement>("generate-button").disabled).toBe(false);
});
