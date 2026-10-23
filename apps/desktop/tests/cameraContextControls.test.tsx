import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultInteriorDNA } from "@arch/domain";
import { createProject, compileFromBundle } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { createMockTransport } from "../src/lib/mockBackend";
import { call, setTransport } from "../src/lib/bridge";
import { PresetGrid } from "../src/features/presets/PresetGrid";
import { VisualIntentSelector } from "../src/features/camera/VisualIntentSelector";
import { BuildingDnaPanel } from "../src/features/dna/BuildingDnaPanel";
import { WorkspaceNav } from "../src/components/shell/WorkspaceNav";
import { asset } from "./helpers";

beforeEach(() => {
  localStorage.clear();
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({
    workspace: null,
    workflowView: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    providers: [],
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});
async function open(projectType: "interior" | "villa" = "interior") {
  const p = await createProject({
    name: "Camera",
    projectType,
    subtype: null,
    starter: {},
    ...(projectType === "interior" ? { interior: defaultInteriorDNA() } : {}),
  });
  await useStudio.getState().openProject(p.id);
  return p;
}

it("uses interior camera choices and sends a close-up variation without a wide camera", async () => {
  const p = await open();
  render(<PresetGrid variation />);
  expect(screen.queryByRole("button", { name: "Aerial" })).toBeNull();
  expect(screen.getByRole("button", { name: "Room corner" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Rain outside" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Furniture detail" }));
  const state = useStudio.getState();
  const shotIntent = {
    ...state.workspace!.shotIntent!,
    presetIds: ["render.viewport_to_photo", "camera.detail"],
  };
  const source = asset(p.id, "SOURCE", { role: "structure_sketch" });
  const bundle = await call("project_get", { projectId: p.id });
  bundle.assets.push(source);
  const result = compileFromBundle(bundle, {
    referenceAssetIds: [source.id],
    sourceAssetId: source.id,
    variation: true,
    shotIntent,
  });
  expect(result.positivePrompt).toContain("close-up material and furniture detail");
  expect(result.positivePrompt).not.toContain("wide view from the entrance showing the whole room");
  expect(result.referenceInstructions).not.toContain("keep geometry and viewpoint exactly");
  expect(result.referenceInstructions).toContain("Reframe the source");
  expect(result.positivePrompt).not.toContain("Keep the building geometry, camera viewpoint");
  expect(result.shotIntent?.presetIds).toEqual(["camera.detail"]);
});

it("keeps the camera module and preset chips on the same view", async () => {
  await open();
  useStudio.getState().setShotIntent({
    projectType: "interior",
    presetIds: ["camera.front"],
    visualIntent: { view: "front", purpose: "portrait", focus: 80 },
  });
  render(<VisualIntentSelector />);
  fireEvent.click(screen.getByRole("button", { name: /Furniture detail/ }));
  expect(useStudio.getState().workspace!.shotIntent).toMatchObject({
    presetIds: ["camera.detail"],
    visualIntent: { view: "detail", purpose: "portrait", focus: 80 },
  });
});

it.each(["interior", "villa"] as const)(
  "merges context into Space for %s without changing the schema",
  async (type) => {
    await open(type);
    render(
      <>
        <WorkspaceNav />
        <BuildingDnaPanel />
      </>,
    );
    expect(document.querySelector('[data-module="context"]')).toBeNull();
    const before = useStudio.getState().workspace!.draftDna;
    fireEvent.click(screen.getByRole("button", { name: "Sea" }));
    const after = useStudio.getState().workspace!.draftDna;
    expect(after.context.front.spaceType).toBe("sea view");
    expect(after.building).toEqual(before.building);
    expect(after.cameras).toEqual(before.cameras);
    expect(after.schemaVersion).toBe(before.schemaVersion);
    fireEvent.click(screen.getByRole("button", { name: "Mountains" }));
    expect(useStudio.getState().workspace!.draftDna.context.front.spaceType).toBe("mountain view");
    useStudio.getState().setModule("context");
    expect(useStudio.getState().activeModule).toBe("design_dna");
  },
);
