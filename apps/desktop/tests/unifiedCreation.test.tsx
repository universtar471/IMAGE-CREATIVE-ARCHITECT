import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import type { GenerationSubmitRequest } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { setTransport, call } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { DiagramPanel } from "../src/features/diagram/DiagramPanel";
import { PublishingPanel } from "../src/features/publishing/PublishingPanel";
import { PublishingStudio } from "../src/features/publishing/PublishingStudio";
import { usePublishing } from "../src/features/publishing/store";
import { SheetResult } from "../src/features/sheets/SheetPanel";
import { useSheetStudio } from "../src/features/sheets/store";
import { compileSheetPrompt } from "../src/features/sheets/sheets";
import { defaultEnhanceParamsFor, enhanceSizeFor } from "../src/features/enhance/enhance";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { resolveGenerateForm } from "../src/features/generate/form";
import { asset, settled } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let submitted: GenerationSubmitRequest[];
beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  submitted = [];
  const base = createMockTransport(db, { generationDelayMs: 0 });
  setTransport(async (command, args) => {
    if (command === "generation_submit")
      submitted.push((args as { request: GenerationSubmitRequest }).request);
    return base(command, args);
  });
  useStudio.setState({
    workspace: null,
    providers: null,
    run: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    selectedAssetId: null,
    jobs: [],
  });
  useSheetStudio.setState({ drafts: {} });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function open() {
  const project = await createProject({
    name: "Architecture",
    projectType: "villa",
    subtype: "default",
    starter: {},
  });
  db.assets.SOURCE = asset(project.id, "SOURCE", {
    originalName: "source.png",
    role: "regular_image",
    widthPx: 1600,
    heightPx: 2400,
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  useStudio.getState().selectAsset("SOURCE");
  return project;
}

it("uses text-only DNA, and shows image import and SketchUp only for the image source", async () => {
  await open();
  render(<GeneratePanel />);
  expect(screen.queryByTestId("generate-mode-advanced")).toBeNull();
  expect(screen.getByRole("textbox")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Import sketch/ })).toBeNull();
  const s = useStudio.getState();
  const form = resolveGenerateForm(
    { ...s.generateDraft, referenceAssetIds: ["SOURCE"] },
    s.providers!,
    s.workspace!.assets,
    null,
  );
  expect(form.referenceIds).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "From sketch / massing" }));
  expect(screen.getByRole("button", { name: "Import sketch" })).toBeTruthy();
  expect(screen.getByRole("textbox")).toBeTruthy();
});

it("creates a diagram directly from one image using the visible model and selected icon", async () => {
  const project = await open();
  render(
    <>
      <DiagramPanel />
      <SheetResult kind="diagram" />
    </>,
  );
  expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
  expect(screen.queryByTestId("diagram-plan")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Facade" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Describe your result" }), {
    target: { value: "blue annotations" },
  });
  expect(submitted).toHaveLength(0);
  fireEvent.click(screen.getByTestId("diagram-ai-create"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0]!).toMatchObject({
    providerId: "local_preview",
    modelId: "placeholder-v1",
    referenceAssetIds: ["SOURCE"],
    prompt: { metadata: { sheetKind: "diagram", sheetPreset: "facade" } },
  });
  expect(submitted[0]!.prompt.positivePrompt).toContain("blue annotations");
  const id = useSheetStudio.getState().drafts[`${project.id}:diagram`]!.generationId!;
  await settled(project.id, id);
  await act(async () => {
    await useStudio.getState().refreshGenerations();
    await useStudio
      .getState()
      .adoptAssets(project.id, await call("asset_list", { projectId: project.id }));
  });
  expect(screen.getByRole("button", { name: "View result" })).toBeTruthy();
});

it("publication prompts preserve architecture and require supplied facts instead of invented claims", () => {
  const prompt = compileSheetPrompt(
    "publishing",
    "board",
    "White background",
    "Villa",
    "Vietnamese",
  );
  expect(prompt.positivePrompt).toContain("White background");
  expect(prompt.positivePrompt).toContain("Do not invent dimensions");
  expect(prompt.referenceInstructions).toContain("authoritative architecture");
  expect(prompt.metadata.sheetKind).toBe("publishing");
});

it("creates publishing artwork through the selected API and brings it into the export book", async () => {
  const project = await open();
  render(
    <>
      <PublishingPanel />
      <PublishingStudio />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Presentation board" }));
  fireEvent.click(screen.getByTestId("publishing-ai-create"));
  await waitFor(() =>
    expect(useSheetStudio.getState().drafts[`${project.id}:publishing`]?.generationId).toBeTruthy(),
  );
  const id = useSheetStudio.getState().drafts[`${project.id}:publishing`]!.generationId!;
  const done = await settled(project.id, id);
  await act(async () => {
    await useStudio.getState().refreshGenerations();
    await useStudio
      .getState()
      .adoptAssets(project.id, await call("asset_list", { projectId: project.id }));
  });
  expect(submitted[0]!.prompt.metadata.sheetKind).toBe("publishing");
  fireEvent.click(screen.getByRole("button", { name: "Use in publication / Export" }));
  expect(useSheetStudio.getState().drafts[`${project.id}:publishing`]!.mode).toBe("layout");
  expect(usePublishing.getState().settings.selectedImageIds).toEqual(done.outputAssetIds);
  const slots = usePublishing
    .getState()
    .publication!.pages.flatMap((p) => p.slots)
    .filter((s) => s.type === "image");
  expect(slots.every((s) => s.fit === "contain")).toBe(true);
  expect(screen.getByTestId("publishing-studio")).toBeTruthy();
});

it("local upscale defaults above a portrait source instead of silently retaining it", () => {
  const source = { widthPx: 1600, heightPx: 2400 };
  const params = defaultEnhanceParamsFor(source);
  const size = enhanceSizeFor(params, source)!;
  expect(size.action).toBe("upscale");
  expect(size.height).toBe(4096);
  expect(size.width / size.height).toBeCloseTo(2 / 3, 3);
});
