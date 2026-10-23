import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankCamera, defaultInteriorDNA, SPACE_CATALOG } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { useLocale } from "../src/i18n";
import { createMockTransport } from "../src/lib/mockBackend";
import { setTransport } from "../src/lib/bridge";
import { ConnectedMultiAngleStudio } from "../src/features/camera/MultiAngleStudio";
import { CameraDirector } from "../src/features/camera/CameraDirector";

let commands: string[];
beforeEach(() => {
  commands = [];
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
async function open(interior = false) {
  const p = await createProject({
    name: "Orbit",
    projectType: interior ? "interior" : "villa",
    subtype: null,
    starter: {},
    ...(interior ? { interior: defaultInteriorDNA() } : {}),
  });
  await useStudio.getState().openProject(p.id);
  const camera = { ...blankCamera([]), azimuthDeg: 0, elevationDeg: 0, distanceM: 12 };
  useStudio.getState().setCameras([camera]);
  useStudio.getState().selectCamera(camera.id);
  await useStudio.getState().flushDna();
  return { p, camera };
}
it.each([false, true])(
  "renders only the scope's presets (interior=%s), help and VI/EN",
  async (interior) => {
    await open(interior);
    render(<ConnectedMultiAngleStudio />);
    expect(screen.queryByRole("button", { name: "Aerial" }) !== null).toBe(!interior);
    expect(screen.queryByRole("button", { name: "Room wide" }) !== null).toBe(interior);
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Help: Camera pose" }));
    expect(screen.getByRole("note").textContent).toContain("geometry-only");
    fireEvent.keyDown(screen.getByRole("button", { name: "Help: Camera pose" }), { key: "Escape" });
    expect(screen.queryByRole("note")).toBeNull();
    act(() => useLocale.setState({ locale: "vi" }));
    expect(screen.getByRole("slider", { name: "Khoảng cách" })).toBeTruthy();
  },
);
it("syncs selected DNA, Director, reset and save/reopen without paid commands or asset writes", async () => {
  const { p, camera } = await open();
  const originalAssets = useStudio.getState().workspace!.assets;
  render(
    <>
      <ConnectedMultiAngleStudio />
      <CameraDirector />
    </>,
  );
  commands = [];
  fireEvent.change(screen.getByRole("slider", { name: "Rotation" }), { target: { value: "42" } });
  expect(useStudio.getState().workspace!.draftDna.cameras[0]!.azimuthDeg).toBe(42);
  expect(screen.getByTestId("director-camera").getAttribute("aria-label")).toContain("42");
  fireEvent.click(screen.getByRole("button", { name: "Reset pose" }));
  expect(useStudio.getState().workspace!.draftDna.cameras[0]!.azimuthDeg).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Left 45°" }));
  await act(() => useStudio.getState().flushDna());
  cleanup();
  await act(() => useStudio.getState().openProject(p.id));
  render(<ConnectedMultiAngleStudio />);
  expect(useStudio.getState().workspace!.draftDna.cameras[0]).toMatchObject({
    id: camera.id,
    azimuthDeg: 45,
    elevationDeg: 12,
    distanceM: 18,
  });
  expect(useStudio.getState().workspace!.assets).toEqual(originalAssets);
  expect(
    commands.filter((c) => /submit|batch_create|asset_import|asset_remove|vision_analyze/.test(c)),
  ).toEqual([]);
});
it("handles external edits, stable camera creation, read-only controls and camera-only navigation", async () => {
  await open();
  render(<ConnectedMultiAngleStudio />);
  act(() => {
    const s = useStudio.getState();
    s.setCameras(s.workspace!.draftDna.cameras.map((c) => ({ ...c, azimuthDeg: 27 })));
  });
  expect((screen.getByRole("slider", { name: "Rotation" }) as HTMLInputElement).value).toBe("27");
  fireEvent.click(screen.getByRole("button", { name: "Add camera" }));
  const s = useStudio.getState();
  expect(s.workspace!.draftDna.cameras).toHaveLength(2);
  expect(s.selectedCameraId).toMatch(/^CAM_/);
  act(() =>
    useStudio.setState({
      workspace: {
        ...s.workspace!,
        project: { ...s.workspace!.project, archivedAt: "2026-10-23T00:00:00Z" },
      },
    }),
  );
  expect((screen.getByRole("slider", { name: "Rotation" }) as HTMLInputElement).disabled).toBe(
    true,
  );
  const before = useStudio.getState().workspace!.draftDna;
  fireEvent.click(screen.getByRole("button", { name: "Aerial" }));
  expect(useStudio.getState().workspace!.draftDna).toBe(before);
  act(() => {
    useStudio.getState().setModule("camera");
    useStudio.getState().setCenterView("orbit");
    useStudio.getState().setModule("lighting");
  });
  expect(useStudio.getState().centerView).toBe("canvas");
});

it("follows active spaces in mixed projects and uses confirmed room bounds", async () => {
  await open();
  const inside = SPACE_CATALOG.presets.find((p) => p.zone === "interior")!;
  const outside = SPACE_CATALOG.presets.find((p) => p.zone === "exterior")!;
  const catalog = {
    version: 1 as const,
    buildingArchetype: inside.buildingArchetypes[0]!,
    activeSpaceId: "ROOM",
    spaces: [
      {
        id: "ROOM",
        presetId: inside.id,
        facts: {
          widthM: { value: 8, evidence: { status: "user_declared" as const, sourceAssetIds: [] } },
        },
        lockedElementIds: [],
        approvedOptionalIds: [],
      },
      {
        id: "GARDEN",
        presetId: outside.id,
        facts: {},
        lockedElementIds: [],
        approvedOptionalIds: [],
      },
    ],
  };
  useStudio.getState().editDna("spaceCatalog", catalog);
  render(<ConnectedMultiAngleStudio />);
  expect(screen.getByTestId("multi-angle-studio").dataset.cameraScope).toBe("interior");
  expect(screen.getByTestId("orbit-proxy").getAttribute("data-width-m")).toBe("8");
  act(() => useStudio.getState().editDna("spaceCatalog.activeSpaceId", "GARDEN"));
  expect(screen.getByTestId("multi-angle-studio").dataset.cameraScope).toBe("building");
  expect(screen.getByRole("button", { name: "Aerial" })).toBeTruthy();
});
