import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  blankCamera,
  defaultInteriorDNA,
  initialInteriorGeneration,
  setGenerationPreserve,
} from "@arch/domain";
import { createProject, compileFromBundle } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { createMockTransport } from "../src/lib/mockBackend";
import { call, setTransport } from "../src/lib/bridge";
import { ConnectedMultiAngleStudio } from "../src/features/camera/MultiAngleStudio";
import { CameraDirector } from "../src/features/camera/CameraDirector";
import { useInteriorGeneration } from "../src/features/generate/interior/useInteriorGeneration";
import { InteriorGenerateFlow } from "../src/features/generate/interior/InteriorGenerateFlow";
import { interiorGenerateDisabledReason } from "../src/features/generate/interior/form";

let commands: string[];
beforeEach(() => {
  localStorage.clear();
  commands = [];
  useStudio.setState({ workspace: null, generateDraft: EMPTY_GENERATE_DRAFT });
  const base = createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] });
  setTransport(async (command, args) => {
    commands.push(command);
    return base(command, args);
  });
});
afterEach(async () => {
  cleanup();
  await useStudio.getState().flushDna();
  setTransport(null);
});
async function open() {
  const p = await createProject({
    name: "Camera Sync",
    projectType: "interior",
    subtype: null,
    starter: {},
    interior: defaultInteriorDNA(),
  });
  await useStudio.getState().openProject(p.id);
  const cameras = [blankCamera([]), blankCamera(["Camera 1"])].map((c) => ({
    ...c,
    viewType: "interior_wide" as const,
    azimuthDeg: 0,
    elevationDeg: 0,
    distanceM: 5,
  }));
  useStudio.getState().setCameras(cameras);
  useStudio.getState().selectCamera(cameras[1]!.id);
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: {
      ...setGenerationPreserve(initialInteriorGeneration(), "camera", false),
      goal: "redesign",
    },
  });
  return { p, cameras };
}
function Workflow() {
  const { state, set } = useInteriorGeneration();
  return <InteriorGenerateFlow state={state} set={set} disabled={false} />;
}
function openOptions() {
  fireEvent.click(screen.getByText("More options"));
}

it("syncs Generate preset to Orbit/Director, then precise Orbit and Director edits back to Generate and prompt", async () => {
  const { p, cameras } = await open();
  render(
    <>
      <Workflow />
      <ConnectedMultiAngleStudio />
      <CameraDirector />
    </>,
  );
  openOptions();
  const choices = screen.getByRole("group", { name: "Camera" });
  fireEvent.click(within(choices).getByRole("button", { name: "Diagonal" }));
  const linked = useStudio.getState().workspace!.shotIntent!.interiorGeneration!;
  expect(linked.camera).toEqual({ mode: "diagonal", cameraId: cameras[1]!.id });
  expect((screen.getByRole("slider", { name: "Rotation" }) as HTMLInputElement).value).toBe("35");
  fireEvent.change(screen.getByRole("slider", { name: "Rotation" }), { target: { value: "48" } });
  expect(
    within(choices).getByRole("button", { name: "Camera Studio" }).getAttribute("aria-pressed"),
  ).toBe("true");
  const marks = screen.getAllByTestId("director-camera");
  fireEvent.keyDown(marks[1]!, { key: "ArrowLeft" });
  const current = useStudio.getState().workspace!.draftDna.cameras[1]!;
  expect(Number((screen.getByRole("slider", { name: "Rotation" }) as HTMLInputElement).value)).toBe(
    current.azimuthDeg,
  );
  const poseBeforeReopen = { ...current };
  await act(() => useStudio.getState().flushDna());
  const bundle = await call("project_get", { projectId: p.id });
  const prompt = compileFromBundle(bundle, {
    shotIntent: useStudio.getState().workspace!.shotIntent,
  });
  expect(prompt.metadata.interiorCameraSnapshot).toMatchObject({
    id: current.id,
    azimuthDeg: current.azimuthDeg,
  });
  expect(prompt.positivePrompt).toContain(`room-local azimuth ${current.azimuthDeg} degrees`);
  cleanup();
  await useStudio.getState().openProject(p.id);
  expect(useStudio.getState().selectedCameraId).toBe(current.id);
  expect(useStudio.getState().workspace!.draftDna.cameras[1]).toEqual(poseBeforeReopen);
  expect(commands.filter((c) => /generation_submit|dna_assist|batch_create/.test(c))).toEqual([]);
});
it("keeps the source lock until explicitly unlocked, including level 0; source change relocks", async () => {
  const { cameras } = await open();
  const current = useStudio.getState().workspace!.shotIntent!;
  useStudio.getState().setShotIntent({
    ...current,
    interiorGeneration: {
      ...current.interiorGeneration!,
      changeLevel: 0,
      preserve: { ...current.interiorGeneration!.preserve, camera: true },
      camera: { mode: "original" },
    },
  });
  render(<ConnectedMultiAngleStudio />);
  fireEvent.change(screen.getByRole("slider", { name: "Rotation" }), { target: { value: "22" } });
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration!.camera).toEqual({
    mode: "original",
  });
  expect(screen.getByText("Original camera locked")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Unlock and use Camera Studio" }));
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration).toMatchObject({
    changeLevel: 1,
    preserve: { camera: false },
    camera: { mode: "studio", cameraId: cameras[1]!.id },
  });
  act(() =>
    useStudio.getState().setGenerateDraft({ source: "sketch", referenceAssetIds: ["NEW_SOURCE"] }),
  );
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration).toMatchObject({
    preserve: { camera: true },
    camera: { mode: "original" },
  });
});
it("updates camera selection, blocks missing links and leaves archived state unchanged", async () => {
  const { cameras } = await open();
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: {
      ...setGenerationPreserve(initialInteriorGeneration(), "camera", false),
      camera: { mode: "wide" },
    },
  });
  useStudio.getState().selectCamera(cameras[0]!.id);
  expect(useStudio.getState().workspace!.shotIntent!.interiorGeneration!.camera).toEqual({
    mode: "studio",
    cameraId: cameras[0]!.id,
  });
  useStudio.getState().setCameras([cameras[1]!]);
  const ws = useStudio.getState().workspace!;
  expect(
    interiorGenerateDisabledReason(ws.shotIntent!.interiorGeneration!, [], ws.draftDna.cameras),
  ).toContain("removed");
  useStudio.setState({
    workspace: { ...ws, project: { ...ws.project, archivedAt: "2026-10-23T00:00:00Z" } },
  });
  const archived = useStudio.getState().workspace!;
  useStudio
    .getState()
    .setShotIntent({ projectType: "interior", interiorGeneration: initialInteriorGeneration() });
  useStudio.getState().setCameras([]);
  expect(useStudio.getState().workspace).toBe(archived);
});
it("choosing Camera Studio keeps an existing precise pose instead of resetting it to wide", async () => {
  const { cameras } = await open();
  useStudio
    .getState()
    .setCameras(cameras.map((c) => ({ ...c, azimuthDeg: 61, elevationDeg: 18, distanceM: 7 })));
  useStudio.getState().setShotIntent({
    projectType: "interior",
    interiorGeneration: {
      ...setGenerationPreserve(initialInteriorGeneration(), "camera", false),
      camera: { mode: "studio", cameraId: cameras[1]!.id },
    },
  });
  const before = useStudio.getState().workspace!.draftDna.cameras[1]!;
  render(
    <>
      <Workflow />
      <ConnectedMultiAngleStudio />
    </>,
  );
  openOptions();
  fireEvent.click(
    within(screen.getByRole("group", { name: "Camera" })).getByRole("button", {
      name: "Camera Studio",
    }),
  );
  expect(useStudio.getState().workspace!.draftDna.cameras[1]).toEqual(before);
});
