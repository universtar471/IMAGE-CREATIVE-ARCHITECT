import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInitialDNA } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { NewProjectWizard } from "../src/features/projects/NewProjectWizard";
import { InteriorDnaPanel } from "../src/features/dna/InteriorDnaPanel";
import { BuildingDnaPanel } from "../src/features/dna/BuildingDnaPanel";
import { ContextDnaPanel } from "../src/features/dna/ContextDnaPanel";
import { LightingPanel } from "../src/features/lighting/LightingPanel";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import {
  defaultInteriorDNA,
  furnitureForRoom,
  proposeInteriorFromLegacy,
  roomsForUse,
  type ProjectDNAWithInterior,
} from "../src/lib/interior";
import type { ProjectDNA } from "@arch/domain";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openInterior() {
  const project = await createProject({
    name: "Interior test",
    projectType: "interior",
    subtype: "default",
    starter: {},
    interior: defaultInteriorDNA(),
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

describe("interior stand-in helpers", () => {
  it("keeps every room valid through the building-use cascade", () => {
    expect(roomsForUse("office")).toContain("other");
    expect(roomsForUse("office")).not.toContain("living_room");
    expect(furnitureForRoom("living_room")).toContain("sofa");
  });

  it("proposes a non-mutating conversion for legacy DNA", () => {
    const dna = createInitialDNA({ projectType: "interior", pack: null });
    dna.building.buildingType = "Office";
    dna.building.architecturalStyle = "Japandi";
    const before = structuredClone(dna);
    const result = proposeInteriorFromLegacy(dna);
    expect(result.proposal.buildingUseId).toBe("office");
    expect(result.proposal.styleId).toBe("japandi");
    expect(result.matched).toEqual(
      expect.arrayContaining(["building.buildingType", "building.architecturalStyle"]),
    );
    expect(dna).toEqual(before);
  });
});

describe("interior project UI", () => {
  it("creates interior DNA from the wizard choices", async () => {
    let created: unknown;
    render(
      <NewProjectWizard onClose={() => undefined} onCreated={(project) => (created = project)} />,
    );
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "New interior" },
    });
    fireEvent.change(screen.getByLabelText("Project type"), { target: { value: "interior" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.change(screen.getByLabelText("Building use"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "meeting_room" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created).toBeTruthy();
    const project = created as { id: string };
    expect((db.dna[project.id] as ProjectDNAWithInterior).interior).toMatchObject({
      buildingUseId: "office",
      roomId: "meeting_room",
      styleId: "modern",
      paletteId: "cool_neutral",
    });
  });

  it("resets an invalid room and shows the live material moodboard", async () => {
    await openInterior();
    useStudio.getState().editDna("interior", {
      ...defaultInteriorDNA(),
      roomId: "living_room",
      surfaces: { ...defaultInteriorDNA().surfaces, floor: ["oak", "walnut"] },
    });
    render(<BuildingDnaPanel />);
    fireEvent.change(screen.getByLabelText("Building use"), { target: { value: "office" } });
    expect((screen.getByLabelText("Room") as HTMLSelectElement).value).toBe("other");
    expect(screen.getByTestId("interior-moodboard").textContent).toMatch(/Oak/);
    expect(
      screen.getByTestId("interior-moodboard").querySelectorAll(".moodboard-material"),
    ).toHaveLength(8);
  });

  it("confirms style defaults when surfaces were edited", async () => {
    await openInterior();
    const interior = defaultInteriorDNA();
    interior.surfaces.floor = ["walnut"];
    useStudio.setState({
      workspace: {
        ...useStudio.getState().workspace!,
        draftDna: { ...useStudio.getState().workspace!.draftDna, interior } as ProjectDNA,
      },
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BuildingDnaPanel />);
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    expect(confirm).toHaveBeenCalledWith("Apply the style's material set?");
    expect(
      (useStudio.getState().workspace!.draftDna as ProjectDNAWithInterior).interior?.styleId,
    ).toBe("japandi");
    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    expect(
      (useStudio.getState().workspace!.draftDna as ProjectDNAWithInterior).interior,
    ).toMatchObject({
      styleId: "modern",
      paletteId: "cool_neutral",
      materialPresetId: "modern_clean",
      surfaces: { floor: ["porcelain_tile"] },
    });
  });

  it("renders interior variants for context, lighting and camera", async () => {
    await openInterior();
    render(<ContextDnaPanel />);
    expect(screen.getByText("Daylight framing")).toBeTruthy();
    cleanup();
    render(<LightingPanel />);
    expect(screen.getByTestId("interior-lighting-panel")).toBeTruthy();
    cleanup();
    render(<CameraPanel />);
    expect(screen.getByTestId("interior-camera-presets")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Detail" }));
    expect(useStudio.getState().workspace!.draftDna.cameras.at(-1)?.lensMm).toBe(35);
    expect(useStudio.getState().workspace!.draftDna.cameras.at(-1)?.heightM).toBe(1.35);
  });

  it("leaves legacy proposal untouched until confirmation", async () => {
    const project = await createProject({
      name: "Legacy interior",
      projectType: "interior",
      subtype: "default",
      starter: {},
    });
    await call("dna_update", {
      projectId: project.id,
      dna: {
        ...db.dna[project.id]!,
        building: { ...db.dna[project.id]!.building, buildingType: "Office" },
      },
    });
    await useStudio.getState().openProject(project.id);
    render(<InteriorDnaPanel />);
    expect(screen.getByText("This interior uses legacy free-text DNA.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Convert to pick-lists" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      (useStudio.getState().workspace!.draftDna as ProjectDNAWithInterior).interior,
    ).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Convert to pick-lists" }));
    const dialog = screen.getByRole("dialog", { name: "Convert legacy interior?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to pick-lists" }));
    expect(
      (useStudio.getState().workspace!.draftDna as ProjectDNAWithInterior).interior,
    ).toMatchObject({ buildingUseId: "office" });
  });

  it("keeps the exterior architecture panel unchanged", async () => {
    const project = await createProject({
      name: "Villa",
      projectType: "villa",
      subtype: "default",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(project.id);
    render(<BuildingDnaPanel />);
    expect(screen.queryByTestId("interior-moodboard")).toBeNull();
    expect(screen.getByLabelText("Building type")).toBeTruthy();
  });
});
