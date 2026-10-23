import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankCamera, defaultInteriorDNA, initialInteriorGeneration } from "@arch/domain";
import { compileFromBundle, createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { ConnectedMultiAngleStudio } from "../src/features/camera/MultiAngleStudio";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";

beforeEach(() => {
  localStorage.clear();
  useStudio.setState({ workspace: null, workflowView: null, generateDraft: EMPTY_GENERATE_DRAFT });
});
afterEach(async () => {
  cleanup();
  await useStudio.getState().flushDna();
  setTransport(null);
});

it("preserves the new main interior Prompt/source/cache while Orbit changes and reopens Camera DNA", async () => {
  const db: NonNullable<Parameters<typeof createMockTransport>[0]> = {
    projects: {},
    dna: {},
    assets: {},
    versions: [],
  };
  const commands: string[] = [];
  const base = createMockTransport(db);
  setTransport(async (command, args) => {
    commands.push(command);
    return base(command, args);
  });
  const p = await createProject({
    name: "Main compatibility",
    projectType: "interior",
    subtype: null,
    starter: {},
    interior: defaultInteriorDNA(),
  });
  db.assets.AST_COMPAT = asset(p.id, "AST_COMPAT", { role: "regular_image" });
  await useStudio.getState().openProject(p.id);
  const c = {
    ...blankCamera([]),
    viewType: "interior_wide" as const,
    azimuthDeg: 0,
    elevationDeg: 0,
    distanceM: 5,
  };
  useStudio.getState().setCameras([c]);
  useStudio.getState().selectCamera(c.id);
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: initialInteriorGeneration({ assetId: "AST_COMPAT", type: "render" }),
  });
  useStudio.getState().setGenerateDraft({
    source: "sketch",
    referenceAssetIds: ["AST_COMPAT"],
    extraPrompt: "Improve natural light",
  });
  const shot = structuredClone(useStudio.getState().workspace!.shotIntent);
  const draft = structuredClone(useStudio.getState().generateDraft);
  useStudio.getState().setModule("camera");
  useStudio.getState().setCenterView("orbit");
  render(<ConnectedMultiAngleStudio />);
  fireEvent.change(screen.getByRole("slider", { name: "Rotation" }), { target: { value: "37" } });
  expect(useStudio.getState().workspace!.shotIntent).toEqual(shot);
  expect(useStudio.getState().generateDraft).toEqual(draft);
  await useStudio.getState().flushDna();
  const bundle = await call("project_get", { projectId: p.id });
  const cameraPrompt = compileFromBundle(bundle, {
    cameraId: c.id,
    shotIntent: shot,
    referenceAssetIds: ["AST_COMPAT"],
  });
  const structuredPrompt = compileFromBundle(bundle, {
    shotIntent: shot,
    referenceAssetIds: ["AST_COMPAT"],
    sourceAssetId: "AST_COMPAT",
  });
  expect(cameraPrompt.metadata.cameraId).toBe(c.id);
  expect(cameraPrompt.metadata.interiorComposerVersion).toBeUndefined();
  expect(structuredPrompt.metadata.interiorComposerVersion).toBeTruthy();
  expect(structuredPrompt.shotIntent?.interiorGeneration?.instruction).toBe(
    "Improve natural light",
  );
  cleanup();
  await useStudio.getState().openProject(p.id);
  expect(useStudio.getState().workspace!.shotIntent).toEqual(shot);
  expect(useStudio.getState().workspace!.draftDna.cameras[0]).toMatchObject({
    id: c.id,
    azimuthDeg: 37,
  });
  expect(commands.filter((c) => /generation_submit|batch_create|dna_assist/.test(c))).toEqual([]);
});
