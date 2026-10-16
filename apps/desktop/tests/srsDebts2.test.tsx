/**
 * SRS debts 2 (ADR-034 / ADR-036 follow-ups) in the UI: the space wizard's floor step,
 * locked elements and placement facts, the interior room suggestion, the per-side height
 * relation, and the camera chip reading `site`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  SceneObjectRequestSchema,
  blankCamera,
  compilePrompt,
  validateShot,
  type ProjectDNA,
  type ProjectType,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { useLocale } from "../src/i18n";
import { SpaceSelector } from "../src/features/space/SpaceSelector";
import { InteriorDnaPanel } from "../src/features/dna/InteriorDnaPanel";
import { SiteAdjacencyEditor } from "../src/features/site/SiteAdjacencyEditor";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { defaultInteriorDNA } from "../src/lib/interior";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

beforeEach(() => {
  useLocale.setState({ locale: "en" });
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});
afterEach(() => {
  cleanup();
  setTransport(null);
  useLocale.setState({ locale: "en" });
});

async function open(projectType: ProjectType, extra: { interior?: boolean } = {}) {
  const project = await createProject({
    name: "Debts 2",
    projectType,
    subtype: "default",
    starter: {},
    ...(extra.interior ? { interior: defaultInteriorDNA() } : {}),
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

const draft = () => useStudio.getState().workspace!.draftDna as ProjectDNA;
const activeSpace = () => {
  const catalog = draft().spaceCatalog!;
  return catalog.spaces.find((s) => s.id === catalog.activeSpaceId)!;
};

function pick(panel: HTMLElement, archetype: string, group: string, space: RegExp) {
  fireEvent.change(within(panel).getByLabelText("Building type (catalog)"), {
    target: { value: archetype },
  });
  fireEvent.click(within(panel).getByRole("button", { name: group }));
  fireEvent.click(within(panel).getByRole("button", { name: space }));
}

describe("space wizard floor step", () => {
  it("is optional, sits between the building type and the group, and writes floorId", async () => {
    await open("townhouse");
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    expect(within(panel).queryByLabelText("Floor / area")).toBeNull();
    fireEvent.change(within(panel).getByLabelText("Building type (catalog)"), {
      target: { value: "townhouse" },
    });
    const floor = within(panel).getByLabelText("Floor / area") as HTMLSelectElement;
    // Skippable: empty by default, then basement, the levels and the roof.
    expect(floor.value).toBe("");
    const labels = [...floor.options].map((o) => o.textContent);
    expect(labels[1]).toBe("Basement");
    expect(labels).toContain("Floor 2");
    expect(labels.at(-1)).toBe("Roof / rooftop");
    // The floor comes before the group step.
    const order = [...panel.querySelectorAll("label, legend, .field-label")].map(
      (el) => el.textContent ?? "",
    );
    expect(order.findIndex((t) => t.startsWith("Floor / area"))).toBeLessThan(
      order.findIndex((t) => t.startsWith("Group")),
    );

    fireEvent.change(floor, { target: { value: "floor_2" } });
    expect(draft().spaceCatalog!.spaces).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Outdoor" }));
    fireEvent.click(within(panel).getByRole("button", { name: /Compact rear courtyard/ }));
    expect(activeSpace()).toMatchObject({
      presetId: "townhouse.outdoor.san_sau_hep",
      floorId: "floor_2",
    });

    // Changing the floor moves the active space; skipping it clears the floor.
    fireEvent.change(floor, { target: { value: "roof" } });
    expect(activeSpace().floorId).toBe("roof");
    fireEvent.change(floor, { target: { value: "" } });
    expect(activeSpace()).not.toHaveProperty("floorId");
    expect(draft().spaceCatalog!.spaces).toHaveLength(1);
  });

  it("skipping the floor keeps the earlier behaviour", async () => {
    await open("townhouse");
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    pick(panel, "townhouse", "Outdoor", /Compact rear courtyard/);
    expect(activeSpace()).not.toHaveProperty("floorId");
  });
});

describe("locked elements editor", () => {
  it("locks built elements and named ones, and the prompt keeps them", async () => {
    useLocale.setState({ locale: "vi" });
    await open("townhouse");
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    fireEvent.change(within(panel).getByLabelText("Loại công trình (danh mục)"), {
      target: { value: "townhouse" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Ngoài trời" }));
    fireEvent.click(within(panel).getByRole("button", { name: /Sân sau hẹp/ }));

    const chips = within(panel).getByTestId("space-locked-elements");
    // An outdoor space offers its paving, never a ceiling.
    expect(within(chips).queryByRole("button", { name: "Trần" })).toBeNull();
    fireEvent.click(within(chips).getByRole("button", { name: "Sân lát hiện có" }));
    fireEvent.click(within(chips).getByRole("button", { name: "Cầu thang" }));
    expect(activeSpace().lockedElementIds).toEqual(["paving", "stairs"]);
    expect(
      within(chips).getByRole("button", { name: "Sân lát hiện có" }).getAttribute("aria-pressed"),
    ).toBe("true");

    const other = within(panel).getByLabelText("Thành phần khóa khác");
    fireEvent.change(other, { target: { value: "old_mango_tree" } });
    fireEvent.keyDown(other, { key: "Enter" });
    expect(activeSpace().lockedElementIds).toEqual(["paving", "stairs", "old_mango_tree"]);

    // Unlocking a chip keeps the named element.
    fireEvent.click(within(chips).getByRole("button", { name: "Cầu thang" }));
    expect(activeSpace().lockedElementIds).toEqual(["paving", "old_mango_tree"]);

    const bundle = compilePrompt({
      project: { id: "PRJ_T", name: "T", projectType: "townhouse" },
      dna: draft(),
      references: [],
    });
    expect(bundle.positivePrompt).toContain(
      "Locked elements, kept exactly where and as they appear in the approved references (do not move, restyle or remove them): existing paving; old mango tree.",
    );
  });
});

describe("placement fact editor (AC-07 style)", () => {
  it("a villa yard with a verified driveway accepts a parked car", async () => {
    await open("villa");
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    pick(panel, "villa", "Outdoor", /Large villa garden/);
    expect(within(panel).queryByTestId("space-fact-garage_bay")).toBeNull();

    const car = SceneObjectRequestSchema.parse({
      presetId: "car.mercedes_300sl.gullwing",
      quantity: 1,
      targetSpaceId: activeSpace().id,
      state: "static",
    });
    const verdict = () =>
      validateShot({ dna: draft(), shotIntent: { projectType: "villa", sceneObjects: [car] } });
    expect(verdict().verdict).toBe("BLOCK");

    const row = within(panel).getByTestId("space-fact-driveway");
    expect(within(row).queryByRole("group")).toBeNull();
    fireEvent.click(within(row).getByLabelText("Driveway"));
    expect(activeSpace().facts.driveway).toEqual({
      value: true,
      evidence: { status: "user_declared", sourceAssetIds: [] },
    });
    const badges = within(row).getByRole("group", { name: "Evidence: Driveway" });
    for (const badge of ["Verified", "Declared by user", "Unknown"])
      expect(within(badges).getByRole("button", { name: badge })).toBeTruthy();

    fireEvent.click(within(badges).getByRole("button", { name: "Unknown" }));
    expect(verdict().issues.map((i) => [i.code, i.severity])).toEqual([
      ["OBJECT_NO_PLACEMENT_ZONE", "WARN"],
    ]);

    fireEvent.click(within(badges).getByRole("button", { name: "Verified" }));
    expect(activeSpace().facts.driveway!.evidence.status).toBe("verified");
    expect(verdict()).toMatchObject({ verdict: "ALLOW", issues: [] });

    // Unticking removes the fact: the car is blocked again, never placed on an invented drive.
    fireEvent.click(within(row).getByLabelText("Driveway"));
    expect(activeSpace().facts).not.toHaveProperty("driveway");
    expect(verdict().verdict).toBe("BLOCK");
  });

  it("offers the bay of a garage", async () => {
    await open("villa");
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    pick(panel, "villa", "Service", /^Garage/);
    expect(within(panel).getByTestId("space-fact-garage_bay")).toBeTruthy();
    expect(within(panel).queryByTestId("space-fact-driveway")).toBeNull();
  });
});

describe("interior room suggestion", () => {
  it("suggests the matching ADR-027 room once, and the interior panel applies it", async () => {
    await open("interior", { interior: true });
    render(<InteriorDnaPanel />);
    expect(draft().interior!.roomId).toBe("living_room");
    const panel = screen.getByTestId("space-selector");
    expect(within(panel).queryByTestId("space-room-suggestion")).toBeNull();
    pick(panel, "apartment", "Sleeping", /^Master bedroom/);

    const suggestion = within(panel).getByTestId("space-room-suggestion");
    expect(suggestion.textContent).toContain("Matching interior room: Master bedroom");
    // A suggestion only: nothing changed yet.
    expect(draft().interior!.roomId).toBe("living_room");
    fireEvent.click(within(suggestion).getByRole("button", { name: "Use for interior DNA" }));
    expect(draft().interior!.roomId).toBe("master_bedroom");
    expect((screen.getByLabelText("Room") as HTMLSelectElement).value).toBe("master_bedroom");
    expect(within(panel).queryByTestId("space-room-suggestion")).toBeNull();
  });

  it("offers nothing for an exterior active space", async () => {
    await open("interior", { interior: true });
    render(<InteriorDnaPanel />);
    const panel = screen.getByTestId("space-selector");
    pick(panel, "villa", "Outdoor", /Large villa garden/);
    expect(within(panel).queryByTestId("space-room-suggestion")).toBeNull();
  });
});

describe("site editor: height relation per side", () => {
  it("is editable for neighbours and walls and writes site.heightRelation", async () => {
    await open("townhouse");
    render(<SiteAdjacencyEditor />);
    // The townhouse starter has attached neighbours left and right; the front is a street.
    expect(screen.queryByLabelText("Front neighbour height")).toBeNull();
    const left = screen.getByLabelText("Left neighbour height") as HTMLSelectElement;
    expect(left.value).toBe("");
    fireEvent.change(left, { target: { value: "taller" } });
    expect(draft().site!.left).toMatchObject({
      kind: "attached_building",
      heightRelation: "taller",
    });
    expect(draft().site!.right).not.toHaveProperty("heightRelation");

    fireEvent.change(screen.getByLabelText("Rear side"), { target: { value: "boundary_wall" } });
    fireEvent.change(screen.getByLabelText("Rear neighbour height"), {
      target: { value: "lower" },
    });
    expect(draft().site!.rear).toMatchObject({ kind: "boundary_wall", heightRelation: "lower" });

    fireEvent.change(screen.getByLabelText("Left neighbour height"), { target: { value: "" } });
    expect(draft().site!.left).not.toHaveProperty("heightRelation");
  });

  it("renders Vietnamese labels", async () => {
    useLocale.setState({ locale: "vi" });
    await open("townhouse");
    render(<SiteAdjacencyEditor />);
    const left = screen.getByLabelText("Chiều cao bên trái") as HTMLSelectElement;
    expect([...left.options].map((o) => o.textContent)).toEqual(
      expect.arrayContaining(["Thấp hơn công trình", "Cao tương đương", "Cao hơn công trình"]),
    );
  });
});

describe("camera chip reads the resolved site adjacency", () => {
  it("follows dna.site when it disagrees with the older toggles", async () => {
    await open("townhouse");
    const studio = useStudio.getState();
    studio.editDna("cameras", [
      {
        ...blankCamera(),
        name: "Front left",
        viewType: "exterior_corner" as const,
        azimuthDeg: 45,
      },
    ]);
    studio.editDna("context.siteTopology", {
      left: "open",
      right: "attached",
      cornerLot: true,
      cornerSide: "left",
    });
    render(<CameraPanel />);
    expect(screen.getByTestId("topology-chip").textContent).toBe("Corner lot — reveal left side");
    cleanup();

    const evidence = { status: "verified" as const, sourceAssetIds: [] };
    useStudio.getState().editDna("site", {
      version: 1,
      coordinateConvention: "viewer_facing_front_facade",
      front: { kind: "street", evidence },
      left: { kind: "attached_building", evidence },
      right: { kind: "attached_building", evidence },
      rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
    });
    render(<CameraPanel />);
    expect(screen.getByTestId("topology-chip").textContent).toBe(
      "Oblique street view — attached side hidden",
    );
  });
});
