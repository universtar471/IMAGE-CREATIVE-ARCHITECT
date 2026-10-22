import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  defaultInteriorDNA,
  initialInteriorGeneration,
  GENERATION_GOALS,
  GENERATION_ROOMS,
  GENERATION_CHANGE_LEVELS,
  GENERATION_PRESERVE,
  GENERATION_CAMERAS,
  GENERATION_LIGHTING,
  GENERATION_STYLES,
  type GenerationSubmitRequest,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { GENERATION_ICONS } from "../src/features/generate/interior/GenerationIcon";
import { InteriorResultActions } from "../src/features/generate/interior/InteriorResultActions";
import { createMockTransport } from "../src/lib/mockBackend";
import { setTransport } from "../src/lib/bridge";
import { loadShotIntent } from "../src/lib/shotIntentStorage";
import { asset } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let submitted: GenerationSubmitRequest[];
let assists: Array<Record<string, unknown>>;
let assistRaw: string;
beforeEach(() => {
  localStorage.clear();
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  submitted = [];
  assists = [];
  assistRaw = '{"preset":"warm","reason":"Matches existing lamps"}';
  const base = createMockTransport(db, { generationDelayMs: 0 });
  setTransport(async (command, args) => {
    if (command === "generation_submit") submitted.push(args.request as GenerationSubmitRequest);
    if (command === "dna_assist") {
      assists.push(args.request as Record<string, unknown>);
      return { raw: assistRaw, modelId: "chat-test", usage: null, generationId: "GEN_ADVICE" };
    }
    return base(command, args);
  });
  useStudio.setState({
    workspace: null,
    workflowView: null,
    providers: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    run: null,
    jobs: [],
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});
async function open(type: "interior" | "villa" = "interior") {
  const project = await createProject({
    name: "Workflow",
    projectType: type,
    subtype: null,
    starter: {},
    ...(type === "interior" ? { interior: defaultInteriorDNA() } : {}),
  });
  db.assets.AST_WORKFLOW_SOURCE = asset(project.id, "AST_WORKFLOW_SOURCE", {
    role: "regular_image",
    originalName: "Living render.png",
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  useStudio.getState().setGenerateDraft({ providerId: "local_preview", modelId: "placeholder-v1" });
  if (type === "interior")
    useStudio.getState().setShotIntent({
      projectType: "interior",
      interiorGeneration: initialInteriorGeneration({
        assetId: "AST_WORKFLOW_SOURCE",
        type: "render",
      }),
    });
  return project;
}
it("presents the new workflow and keeps optional settings collapsed", async () => {
  await open();
  render(<GeneratePanel />);
  expect(screen.getByTestId("interior-generate-flow")).toBeTruthy();
  expect(screen.getByRole("group", { name: "Goal" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Room type" })).toBeTruthy();
  expect(screen.queryByTestId("preset-studio")).toBeNull();
  expect(screen.getByTestId("generate-button").textContent).toContain("Generate image");
  expect(screen.getByText("More options").closest("details")!.open).toBe(false);
  expect(
    screen
      .getByText("More options")
      .closest("details")!
      .contains(screen.getByRole("combobox", { name: "Provider" })),
  ).toBe(true);
});
it("uses goal defaults, functional room context and persists structured choices", async () => {
  const p = await open();
  render(<GeneratePanel />);
  const furniture = useStudio.getState().workspace!.draftDna.interior!.furnitureIds;
  fireEvent.click(
    within(screen.getByRole("group", { name: "Goal" })).getByRole("button", { name: "Redesign" }),
  );
  fireEvent.click(
    within(screen.getByRole("group", { name: "Room type" })).getByRole("button", {
      name: "Bedroom",
    }),
  );
  expect(useStudio.getState().workspace!.draftDna.interior!.furnitureIds).toEqual(furniture);
  expect(loadShotIntent(p.id)?.interiorGeneration).toMatchObject({
    goal: "redesign",
    room: "bedroom",
    changeLevel: 2,
    preserve: { furniture: false, materials: false, camera: true },
  });
});
it("sends the selected provider a composed snapshot with original camera locks", async () => {
  await open();
  render(<GeneratePanel />);
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0]).toMatchObject({
    providerId: "local_preview",
    referenceAssetIds: ["AST_WORKFLOW_SOURCE"],
  });
  expect(submitted[0]!.prompt.shotIntent?.interiorGeneration?.goal).toBe("photorealistic");
  expect(submitted[0]!.prompt.preservationInstructions).toContain(
    "viewing direction, horizon and framing",
  );
  expect(submitted[0]!.prompt.positivePrompt).not.toContain("warm beige");
});
it("does not retain variation purpose after switching to a different interior goal", async () => {
  await open();
  useStudio.getState().setGenerateDraft({ purpose: "variation" });
  render(<GeneratePanel />);
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0]!.purpose).toBe("hero");
});
it("derives output framing from the chosen source even when it has a reference-library role", async () => {
  const p = await open();
  const image = asset(p.id, "AST_PORTRAIT", {
    role: "material_reference",
    widthPx: 1000,
    heightPx: 1500,
  });
  db.assets[image.id] = image;
  const ws = useStudio.getState().workspace!;
  useStudio.setState({ workspace: { ...ws, assets: [...ws.assets, image] } });
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: initialInteriorGeneration({ assetId: image.id, type: "photo" }),
  });
  render(<GeneratePanel />);
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0]!.params.aspectRatio).toBe("2:3");
});
it("blocks a conflicting instruction even when submit is called directly", async () => {
  const p = await open();
  const state = useStudio.getState().workspace!.shotIntent!.interiorGeneration!;
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: { ...state, instruction: "Đổi sofa thành sofa da nâu" },
  });
  const result = await useStudio.getState().submitGeneration({
    projectId: p.id,
    providerId: "local_preview",
    modelId: "placeholder-v1",
    purpose: "hero",
    referenceAssetIds: ["AST_WORKFLOW_SOURCE"],
    params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
  });
  expect(result).toBeUndefined();
  expect(submitted).toEqual([]);
});
it("checks hard locks again when a structured snapshot is resubmitted", async () => {
  await open();
  render(<GeneratePanel />);
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  const request = structuredClone(submitted[0]!);
  request.prompt.shotIntent!.interiorGeneration!.instruction = "Đổi sofa thành sofa da nâu";
  submitted = [];
  const { prompt, ...input } = request;
  expect(await useStudio.getState().submitGeneration(input, prompt)).toBeUndefined();
  expect(submitted).toEqual([]);
});
it("keeps legacy Prompt edits synchronized with the structured instruction", async () => {
  const p = await open();
  useStudio
    .getState()
    .setGenerateDraft({ extraPrompt: "Living room, modern, predominantly black and white" });
  expect(loadShotIntent(p.id)?.interiorGeneration?.instruction).toBe(
    "Living room, modern, predominantly black and white",
  );
});
it("only requests lighting advice, then applies it explicitly", async () => {
  await open();
  render(<GeneratePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Suggest lighting" }));
  const dialog = await screen.findByRole("dialog", { name: "Confirm cost" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
  await screen.findByText("Matches existing lamps");
  expect(assists).toHaveLength(1);
  expect(assists[0]).toMatchObject({
    scope: "lighting",
    mode: "images",
    referenceAssetIds: ["AST_WORKFLOW_SOURCE"],
  });
  expect(submitted).toHaveLength(0);
  expect(
    useStudio.getState().workspace!.shotIntent!.interiorGeneration!.lighting.preset,
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Use suggestion" }));
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration!.lighting.preset).toBe(
    "warm",
  );
  expect(submitted).toHaveLength(0);
});
it("shows three validated style recommendations and applies only the chosen style", async () => {
  await open();
  assistRaw = JSON.stringify({
    analysis: {
      room_type: "Living room",
      existing_style: "modern",
      geometry: "Rectangular",
      materials: ["wood"],
      colors: ["white"],
      lighting: "daylight",
      strengths: ["open"],
      weaknesses: ["flat"],
    },
    recommendations: ["japandi", "modern", "minimalist"].map((style_id) => ({
      style_id,
      style_name: style_id,
      compatibility_score: 90,
      short_reason: "Fits source geometry",
      suggested_lighting: "warm",
      recommended_change_level: 3,
    })),
  });
  render(<GeneratePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Suggest 3 styles" }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Confirm cost" })).getByRole("button", {
      name: "Continue",
    }),
  );
  const advice = await screen.findByRole("group", { name: "Recommended styles" });
  expect(within(advice).getAllByRole("button")).toHaveLength(3);
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration!.style).toBeNull();
  fireEvent.click(within(advice).getByRole("button", { name: "Use suggestion: Modern" }));
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration).toMatchObject({
    style: "modern",
    changeLevel: 1,
    lighting: { preset: null },
    preserve: { camera: true, architecture: true, furniture: true, materials: true },
    sourceAnalysis: { geometry: "Rectangular" },
  });
  expect(submitted).toEqual([]);
});
it("shows invalid advice as an error and permits a fresh analysis retry", async () => {
  await open();
  assistRaw = "{broken";
  render(<GeneratePanel />);
  fireEvent.click(screen.getByRole("button", { name: "Suggest lighting" }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Confirm cost" })).getByRole("button", {
      name: "Continue",
    }),
  );
  await screen.findByRole("alert");
  assistRaw = '{"preset":"neutral","reason":"Balance existing daylight"}';
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "Confirm cost" })).getByRole("button", {
      name: "Continue",
    }),
  );
  await screen.findByText("Balance existing daylight");
  expect(assists).toHaveLength(2);
  expect(submitted).toEqual([]);
});
it("uses a result as the next source and opens existing tools without submitting", async () => {
  const p = await open();
  render(<GeneratePanel />);
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  cleanup();
  const output = asset(p.id, "AST_RESULT", { parentAssetId: "AST_WORKFLOW_SOURCE" });
  const ws = useStudio.getState().workspace!;
  useStudio.setState({ workspace: { ...ws, assets: [...ws.assets, output] } });
  const g = {
    ...ws.generations[0]!,
    prompt: submitted[0]!.prompt,
    referenceAssetIds: submitted[0]!.referenceAssetIds,
  };
  render(<InteriorResultActions generation={g} assetId={output.id} />);
  fireEvent.click(screen.getByRole("button", { name: "Create variation" }));
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration).toMatchObject({
    goal: "variations",
    input: { assetId: output.id },
    preserve: { architecture: true, camera: true },
  });
  fireEvent.click(screen.getByRole("button", { name: "Before / After" }));
  expect(useStudio.getState().viewer).toMatchObject({
    assetIds: [output.id],
    compareWithId: "AST_WORKFLOW_SOURCE",
  });
  fireEvent.click(screen.getByRole("button", { name: "Upscale" }));
  expect(useStudio.getState().activeModule).toBe("enhance");
  fireEvent.click(screen.getByRole("button", { name: "Region edit" }));
  expect(useStudio.getState().activeModule).toBe("regions");
  fireEvent.click(screen.getByRole("button", { name: "Return to source" }));
  expect(useStudio.getState().selectedAssetId).toBe("AST_WORKFLOW_SOURCE");
  expect(useStudio.getState().generateDraft.referenceAssetIds?.[0]).toBe("AST_WORKFLOW_SOURCE");
  expect(submitted).toHaveLength(1);
});
it("does not let an incompatible future workflow discard legacy shot selections", () => {
  localStorage.setItem(
    "arch.shotIntent.future",
    JSON.stringify({
      projectType: "interior",
      presetIds: ["time.night"],
      interiorGeneration: { schemaVersion: 99 },
    }),
  );
  expect(loadShotIntent("future")?.presetIds).toEqual(["time.night"]);
  expect(localStorage.getItem("arch.shotIntent.future")).toContain('"schemaVersion":99');
});
it("submits source before reference regardless of their library roles", async () => {
  const p = await open();
  db.assets.AST_STYLE_MASTER = asset(p.id, "AST_STYLE_MASTER", {
    role: "master_architecture",
    originalName: "Style reference.png",
  });
  const previous = useStudio.getState().workspace!;
  useStudio.setState({
    workspace: { ...previous, assets: [...previous.assets, db.assets.AST_STYLE_MASTER!] },
  });
  const state = previous.shotIntent!.interiorGeneration!;
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: {
      ...state,
      reference: {
        assetId: "AST_STYLE_MASTER",
        attributes: {
          style: true,
          colors: false,
          materials: false,
          layout: false,
          lighting: false,
        },
      },
    },
  });
  render(<GeneratePanel />);
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect(submitted[0]!.referenceAssetIds).toEqual(["AST_WORKFLOW_SOURCE", "AST_STYLE_MASTER"]);
  expect(submitted[0]!.prompt.referenceInstructions).toContain(
    "Image 1 is the authoritative source",
  );
});
it("provides every requested icon through the existing SVG library", () => {
  for (const config of [
    ...GENERATION_GOALS,
    ...GENERATION_ROOMS,
    ...GENERATION_STYLES,
    ...GENERATION_CHANGE_LEVELS,
    ...GENERATION_PRESERVE,
    ...GENERATION_CAMERAS,
    ...GENERATION_LIGHTING,
  ])
    expect(GENERATION_ICONS[config.icon]).toBeDefined();
});
it("keeps architecture on the existing generate UI", async () => {
  await open("villa");
  render(<GeneratePanel />);
  expect(screen.queryByTestId("interior-generate-flow")).toBeNull();
  expect(screen.getByTestId("preset-studio")).toBeTruthy();
  expect(screen.getByRole("combobox", { name: "Provider" })).toBeTruthy();
});
