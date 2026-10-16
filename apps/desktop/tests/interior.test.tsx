import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  createInitialDNA,
  ProjectDNASchema,
  proposeInteriorFromLegacy as domainPropose,
} from "@arch/domain";
import { compileFromBundle, createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { NewProjectWizard } from "../src/features/projects/NewProjectWizard";
import { InteriorDnaPanel } from "../src/features/dna/InteriorDnaPanel";
import { BuildingDnaPanel } from "../src/features/dna/BuildingDnaPanel";
import { ContextDnaPanel } from "../src/features/dna/ContextDnaPanel";
import { LightingPanel } from "../src/features/lighting/LightingPanel";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { call, fieldErrorsOf, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import {
  defaultInteriorDNA,
  furnitureForRoom,
  proposeInteriorFromLegacy,
  roomsForUse,
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
    fireEvent.click(screen.getByRole("radio", { name: /^Interior/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.change(screen.getByLabelText("Building use"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "meeting_room" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created).toBeTruthy();
    const project = created as { id: string };
    expect((db.dna[project.id] as ProjectDNA).interior).toMatchObject({
      buildingUseId: "office",
      roomId: "meeting_room",
      styleId: "modern",
      paletteId: "cool_neutral",
    });
  });

  it("creates schema-valid DNA that compiles with the interior prompt sections", async () => {
    let created: { id: string } | undefined;
    render(
      <NewProjectWizard onClose={() => undefined} onCreated={(project) => (created = project)} />,
    );
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Prompt interior" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /^Interior/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.change(screen.getByLabelText("Building use"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "meeting_room" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(created).toBeTruthy();
    const bundle = await call("project_get", { projectId: created!.id });
    const parsed = ProjectDNASchema.safeParse(bundle.dna);
    expect(parsed.success).toBe(true);
    const prompt = compileFromBundle(bundle).positivePrompt;
    expect(prompt).toContain("Interior space: office meeting room.");
    expect(prompt).toContain("Interior style: Modern, clean lines and flat planes.");
    expect(prompt).toContain("Materials and colors:");
    expect(prompt).toContain("Furnishing:");
  });

  it("does not let hidden exterior errors block the interior wizard step", () => {
    render(<NewProjectWizard onClose={() => undefined} onCreated={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Project name"), {
      target: { value: "Interior with hidden errors" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /^Architecture/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    fireEvent.change(screen.getByLabelText("Floors"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Interior/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(
      (screen.getByRole("button", { name: /Create project/ }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("makes the mock backend reject an invalid interior room and surface id", async () => {
    const project = await openInterior();
    const invalid = structuredClone(db.dna[project.id]!);
    invalid.interior = {
      ...invalid.interior!,
      surfaces: { ...invalid.interior!.surfaces, floor: ["paint" as never] },
    };
    const surfaceError = await call("dna_update", { projectId: project.id, dna: invalid }).catch(
      (caught) => caught,
    );
    expect(surfaceError).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fieldErrorsOf(surfaceError)).toEqual({
      "interior.surfaces.floor.0": expect.any(String),
    });

    const roomInvalid = structuredClone(db.dna[project.id]!);
    roomInvalid.interior = { ...roomInvalid.interior!, roomId: "meeting_room" as never };
    const roomError = await call("dna_update", { projectId: project.id, dna: roomInvalid }).catch(
      (caught) => caught,
    );
    expect(roomError).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fieldErrorsOf(roomError)).toEqual({ "interior.roomId": expect.any(String) });
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
    expect((useStudio.getState().workspace!.draftDna as ProjectDNA).interior?.styleId).toBe(
      "japandi",
    );
    confirm.mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    expect((useStudio.getState().workspace!.draftDna as ProjectDNA).interior).toMatchObject({
      styleId: "modern",
      paletteId: "cool_neutral",
      materialPresetId: "modern_clean",
      surfaces: { floor: ["porcelain_tile"] },
    });
  });

  it("confirms style defaults when a palette or preset was explicitly changed", async () => {
    await openInterior();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<BuildingDnaPanel />);
    fireEvent.change(screen.getByLabelText("Palette"), { target: { value: "blue_coastal" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    expect(confirm).toHaveBeenCalledWith("Apply the style's material set?");
    expect((useStudio.getState().workspace!.draftDna as ProjectDNA).interior).toMatchObject({
      styleId: "japandi",
      paletteId: "blue_coastal",
    });
    confirm.mockReturnValue(false);
    fireEvent.change(screen.getByLabelText("Material preset"), {
      target: { value: "luxury_stone" },
    });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "tropical" } });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect((useStudio.getState().workspace!.draftDna as ProjectDNA).interior?.styleId).toBe(
      "japandi",
    );
    confirm.mockRestore();
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
    expect((useStudio.getState().workspace!.draftDna as ProjectDNA).interior).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Convert to pick-lists" }));
    const dialog = screen.getByRole("dialog", { name: "Convert legacy interior?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert to pick-lists" }));
    expect((useStudio.getState().workspace!.draftDna as ProjectDNA).interior).toMatchObject({
      buildingUseId: "office",
    });
  });

  it("uses the domain legacy matcher for all Indochine spelling variants", () => {
    expect(proposeInteriorFromLegacy).toBe(domainPropose);
    for (const value of ["Đông Dương", "dong duong", "DONG DUONG"]) {
      const dna = createInitialDNA({ projectType: "interior", pack: null });
      dna.building.architecturalStyle = value;
      expect(proposeInteriorFromLegacy(dna).proposal.styleId).toBe("indochine");
    }
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
