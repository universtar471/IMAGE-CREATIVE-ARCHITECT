import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  defaultInteriorDNA,
  initialInteriorGeneration,
  type GenerationSubmitRequest,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { PropertyPanel } from "../src/components/panels/PropertyPanel";
import { ConnectedInteriorCameraControls } from "../src/features/camera/InteriorCameraControls";
import { createMockTransport } from "../src/lib/mockBackend";
import { setTransport } from "../src/lib/bridge";
import { asset } from "./helpers";

let requests: GenerationSubmitRequest[];
let db: NonNullable<Parameters<typeof createMockTransport>[0]>;
beforeEach(() => {
  localStorage.clear();
  requests = [];
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  const base = createMockTransport(db, { generationDelayMs: 0 });
  setTransport(async (command, args) => {
    if (command === "generation_submit") requests.push(args.request as GenerationSubmitRequest);
    return base(command, args);
  });
  useStudio.setState({
    workspace: null,
    providers: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    run: null,
    jobs: [],
  });
});
afterEach(async () => {
  cleanup();
  await useStudio.getState().flushDna();
  setTransport(null);
});
async function open() {
  const project = await createProject({
    name: "Variation",
    projectType: "interior",
    subtype: null,
    starter: {},
    interior: defaultInteriorDNA(),
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  const images = [
    asset(project.id, "AST_SOURCE", { role: "regular_image" }),
    asset(project.id, "AST_SECOND", { role: "regular_image" }),
  ];
  for (const image of images) db.assets[image.id] = image;
  const ws = useStudio.getState().workspace!;
  useStudio.setState({ workspace: { ...ws, assets: images } });
  useStudio.getState().setGenerateDraft({ providerId: "local_preview", modelId: "placeholder-v1" });
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: {
      ...initialInteriorGeneration({ assetId: images[0]!.id, type: "render" }),
      changeLevel: 0,
    },
  });
  return images;
}

it("explicitly unlocks camera presets even without an existing camera at level zero", async () => {
  await open();
  expect(useStudio.getState().workspace!.draftDna.cameras).toHaveLength(0);
  render(<ConnectedInteriorCameraControls disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Change camera" }));
  expect((screen.getByRole("button", { name: "Diagonal" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Diagonal" }));
  const state = useStudio.getState().workspace!.shotIntent!.interiorGeneration!;
  expect(state.preserve.camera).toBe(false);
  expect(state.changeLevel).toBe(1);
  expect(state.camera.mode).toBe("diagonal");
  expect(
    useStudio.getState().workspace!.draftDna.cameras.some((c) => c.id === state.camera.cameraId),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Keep original camera" }));
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration!.camera.mode).toBe(
    "original",
  );
});

it("opens a focused variation inspector without generating and keeps draft choices on return", async () => {
  const images = await open();
  useStudio.getState().startVariation(images[0]!.id);
  render(<PropertyPanel />);
  expect(screen.getByTestId("variation-panel")).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Goal" })).toBeNull();
  expect(screen.queryByRole("group", { name: "Room type" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Space" })).toBeNull();
  expect(screen.queryByTestId("selection-inspector")).toBeNull();
  expect(requests).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Warm" }));
  const before = useStudio.getState().workspace!.shotIntent;
  fireEvent.click(screen.getByRole("button", { name: "Back to Create image" }));
  expect(screen.getByTestId("interior-generate-flow")).toBeTruthy();
  expect(useStudio.getState().workspace!.shotIntent).toEqual(before);
  act(() => useStudio.getState().startVariation(images[0]!.id));
  expect(useStudio.getState().workspace!.shotIntent).toEqual(before);
});

it("submits the variation source and selected camera through the structured compiler", async () => {
  const images = await open();
  useStudio.getState().startVariation(images[0]!.id);
  render(<PropertyPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Change camera" }));
  fireEvent.click(
    within(screen.getByRole("group", { name: "Camera" })).getByRole("button", { name: "Diagonal" }),
  );
  fireEvent.click(screen.getByTestId("generate-button"));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({
    purpose: "variation",
    referenceAssetIds: [images[0]!.id],
    cameraId: null,
  });
  expect(requests[0]!.prompt.shotIntent?.interiorGeneration?.camera.mode).toBe("diagonal");
  act(() => useStudio.getState().startVariation(images[1]!.id));
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration).toMatchObject({
    input: { assetId: images[1]!.id },
    camera: { mode: "original" },
    preserve: { camera: true },
  });
  expect(requests).toHaveLength(1);
});

it("blocks a removed variation source instead of switching to another image", async () => {
  const images = await open();
  useStudio.getState().startVariation(images[0]!.id);
  render(<PropertyPanel />);
  act(() => {
    const ws = useStudio.getState().workspace!;
    useStudio.setState({
      workspace: { ...ws, assets: ws.assets.filter((a) => a.id !== images[0]!.id) },
    });
  });
  expect((screen.getByTestId("generate-button") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByTestId("variation-source").textContent).not.toContain(images[1]!.originalName);
  expect(requests).toHaveLength(0);
});
