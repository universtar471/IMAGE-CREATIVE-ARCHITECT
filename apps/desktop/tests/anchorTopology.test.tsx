import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankCamera } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { ContextDnaPanel } from "../src/features/dna/ContextDnaPanel";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { BatchDialog } from "../src/features/camera/BatchDialog";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import {
  cameraSitePlan,
  resolveSiteTopology,
  revealedSide,
  type SiteTopology,
} from "../src/lib/siteTopology";

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

async function openExterior() {
  const project = await createProject({
    name: "Anchor topology",
    projectType: "villa",
    subtype: "default",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

describe("site topology stand-in helpers", () => {
  it("infers attached sides from folded adjacent-building text and keeps defaults unknown", () => {
    const context = {
      left: { adjacentBuildings: ["Tường liền vách"] },
      right: { adjacentBuildings: [] },
      density: "medium",
    };
    expect(resolveSiteTopology(context)).toMatchObject({
      left: "attached",
      right: "unknown",
      source: { left: "inferred", right: "default" },
    });
  });

  it("does not let an explicit unknown override an attached description", () => {
    expect(
      resolveSiteTopology({
        siteTopology: { left: "unknown", right: "unknown", cornerLot: false },
        left: { adjacentBuildings: ["party wall"] },
      }),
    ).toMatchObject({ left: "attached", source: { left: "inferred" } });
  });

  it("maps revealed sides and camera plans", () => {
    expect(revealedSide({ viewType: "exterior_corner", azimuthDeg: 25 })).toBe("left");
    expect(revealedSide({ viewType: "exterior_side", azimuthDeg: -25 })).toBe("right");
    expect(revealedSide({ viewType: "exterior_front", azimuthDeg: 25 })).toBeNull();
    expect(
      cameraSitePlan(
        { viewType: "exterior_side", azimuthDeg: 25 },
        { siteTopology: { left: "attached", right: "open", cornerLot: false } },
        "villa",
      ),
    ).toMatchObject({ mode: "oblique_street", side: "left" });
  });
});

describe("site topology UI", () => {
  it("writes explicit values and shows the inferred hint", async () => {
    await openExterior();
    useStudio.getState().editDna("context.left.adjacentBuildings", ["party wall"]);
    render(<ContextDnaPanel />);

    expect(screen.getAllByText("Inferred from description").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Left side"), { target: { value: "open" } });
    expect(
      (
        useStudio.getState().workspace!.draftDna.context as unknown as {
          siteTopology?: SiteTopology;
        }
      ).siteTopology,
    ).toMatchObject({ left: "open" });
  });

  it("disables attached sides in the corner-side select", async () => {
    await openExterior();
    useStudio.getState().editDna("context.siteTopology", {
      left: "attached",
      right: "open",
      cornerLot: true,
      cornerSide: "right",
    });
    render(<ContextDnaPanel />);
    const select = screen.getByLabelText("Corner side") as HTMLSelectElement;
    expect((select.querySelector('option[value="left"]') as HTMLOptionElement).disabled).toBe(true);
    expect(select.value).toBe("right");
  });

  it("renders an unknown-side camera warning and writes the chosen resolution", async () => {
    await openExterior();
    const camera = {
      ...blankCamera(),
      name: "Side",
      viewType: "exterior_side" as const,
      azimuthDeg: 25,
    };
    useStudio.getState().editDna("cameras", [camera]);
    render(<CameraPanel />);
    expect(screen.getAllByText(/side exposed is not confirmed/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Attached" }));
    expect(
      (useStudio.getState().workspace!.draftDna.context as { siteTopology?: SiteTopology })
        .siteTopology,
    ).toMatchObject({
      left: "attached",
    });
  });

  it("shows unresolved cameras in the batch dialog without making the warning itself a blocker", async () => {
    await openExterior();
    const camera = {
      ...blankCamera(),
      name: "Side",
      viewType: "exterior_side" as const,
      azimuthDeg: 25,
    };
    useStudio.getState().editDna("cameras", [camera]);
    await useStudio.getState().loadProviders();
    render(<BatchDialog mode="production" onClose={() => undefined} />);
    expect(screen.getAllByText(/side exposed is not confirmed/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Attached" }).length).toBeGreaterThan(0);
  });

  it("does not render topology UI for interior projects", async () => {
    const project = await createProject({
      name: "Interior topology",
      projectType: "interior",
      subtype: "default",
      starter: {},
    });
    await useStudio.getState().openProject(project.id);
    render(<ContextDnaPanel />);
    expect(screen.queryByText("Lot position")).toBeNull();
  });
});
