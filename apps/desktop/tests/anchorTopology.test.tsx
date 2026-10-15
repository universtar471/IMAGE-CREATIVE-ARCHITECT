import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { blankCamera, compilePrompt, ProjectDNASchema } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { ContextDnaPanel } from "../src/features/dna/ContextDnaPanel";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { BatchDialog } from "../src/features/camera/BatchDialog";
import { OverviewPanel } from "../src/features/overview/OverviewPanel";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import nhaphoDna from "./fixtures/nhapho-dna.json";
import { asset } from "./helpers";
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
    expect(revealedSide({ viewType: "exterior_corner", azimuthDeg: 0 })).toBeNull();
    expect(revealedSide({ viewType: "exterior_corner", presetId: "front_right_corner" })).toBe(
      "right",
    );
    expect(revealedSide({ viewType: "exterior_corner" })).toBeNull();
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
  it("round-trips topology through the parsed mock backend and enforces corner refinement", async () => {
    const project = await openExterior();
    const mockTransport = createMockTransport(db);
    const updates: unknown[] = [];
    setTransport(((command, args) => {
      if (command === "dna_update") updates.push(args.request);
      return mockTransport(command, args);
    }) as Transport);
    const before = useStudio.getState().workspace!.draftDna;
    const topology: SiteTopology = {
      left: "open",
      right: "attached",
      cornerLot: true,
      cornerSide: "left",
    };
    useStudio.getState().editDna("context.siteTopology", topology);
    expect(await useStudio.getState().flushDna()).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      projectId: project.id,
      dna: { context: { siteTopology: topology } },
    });
    const persisted = ProjectDNASchema.parse(await call("dna_get", { projectId: project.id }));
    expect(persisted.context.siteTopology).toEqual(topology);

    await expect(
      call("dna_update", {
        projectId: project.id,
        dna: {
          ...persisted,
          context: {
            ...persisted.context,
            siteTopology: { left: "attached", right: "open", cornerLot: true },
          },
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await call("dna_get", { projectId: project.id })).toEqual(persisted);
    expect(before.context.siteTopology).toBeUndefined();
  });

  it("compiles the real townhouse DNA consistently and shows the three camera plans", async () => {
    const dna = ProjectDNASchema.parse(nhaphoDna);
    const project = await createProject({
      name: "Nhapho regression",
      projectType: "townhouse",
      subtype: "default",
      starter: {},
    });
    db.dna[project.id] = dna;
    const masterId = `AST_MASTER_${project.id}`;
    db.assets[masterId] = asset(project.id, masterId, {
      role: "master_architecture",
      originalName: "master.jpg",
    });
    await call("asset_set_master", { projectId: project.id, assetId: masterId });

    const compiled = dna.cameras.map((camera) =>
      compilePrompt({
        project: {
          id: project.id,
          name: project.name,
          projectType: "townhouse",
          subtype: "default",
        },
        dna,
        references: [{ assetId: masterId, role: "master_architecture" }],
        cameraId: camera.id,
      }),
    );
    const frontLeft = compiled[0]!;
    const frontRight = compiled[1]!;
    const aerial = compiled[2]!;
    for (const prompt of [frontLeft, frontRight]) {
      expect(prompt.positivePrompt).not.toContain("showing the front facade and the left side");
      expect(prompt.positivePrompt).not.toContain("showing the front facade and the right side");
      expect(prompt.positivePrompt).toContain("oblique street view");
      expect(prompt.preservationInstructions).toContain("party walls hidden");
      expect(prompt.negativePrompt).toContain("exposed side wall");
    }
    expect(
      aerial.positivePrompt.startsWith("Architectural visualization (aerial architectural view)"),
    ).toBe(true);
    expect(aerial.positivePrompt).not.toContain("plot");
    expect(aerial.preservationInstructions).toContain("same continuous mid-block street");

    await useStudio.getState().openProject(project.id);
    render(<CameraPanel />);
    expect(screen.getAllByText("Oblique street view — attached side hidden")).toHaveLength(2);
    expect(screen.getByText("Keep the same street block")).toBeTruthy();
  });

  it("writes explicit values through the site editor, which replaces the toggles", async () => {
    await openExterior();
    useStudio.getState().editDna("context.left.adjacentBuildings", ["party wall"]);
    render(<ContextDnaPanel />);

    // The attached side inferred from the description opens as attached / inferred.
    expect((screen.getByLabelText("Left side") as HTMLSelectElement).value).toBe(
      "attached_building",
    );
    expect((screen.getByLabelText("Left evidence") as HTMLSelectElement).value).toBe("inferred");
    fireEvent.change(screen.getByLabelText("Left side"), { target: { value: "open_space" } });
    expect(
      (
        useStudio.getState().workspace!.draftDna.context as unknown as {
          siteTopology?: SiteTopology;
        }
      ).siteTopology,
    ).toMatchObject({ left: "open" });
  });

  it("derives the corner lot from a street side instead of a corner-side select", async () => {
    await openExterior();
    render(<ContextDnaPanel />);
    expect(screen.queryByLabelText("Corner side")).toBeNull();
    fireEvent.change(screen.getByLabelText("Left side"), {
      target: { value: "attached_building" },
    });
    fireEvent.change(screen.getByLabelText("Right side"), { target: { value: "street" } });
    expect(
      (useStudio.getState().workspace!.draftDna.context as { siteTopology?: SiteTopology })
        .siteTopology,
    ).toEqual({ left: "attached", right: "open", cornerLot: true, cornerSide: "right" });
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
    const row = screen.getByTestId("camera-row");
    const selectButton = row.querySelector("button.camera-row-main")!;
    expect(selectButton.querySelector("button")).toBeNull();
    const selectedBefore = useStudio.getState().selectedCameraId;
    expect(screen.getAllByText(/side exposed is not confirmed/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Attached" }));
    expect(useStudio.getState().selectedCameraId).toBe(selectedBefore);
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

  it("shows lot summaries for middle, one attached side, standalone, corner and unknown lots", async () => {
    await openExterior();
    const cases: Array<[SiteTopology, string]> = [
      [
        { left: "attached", right: "attached", cornerLot: false },
        "Mid-block lot · attached on both sides",
      ],
      [{ left: "attached", right: "open", cornerLot: false }, "attached on the left side"],
      [{ left: "open", right: "open", cornerLot: false }, "Detached house"],
      [
        { left: "open", right: "attached", cornerLot: true, cornerSide: "left" },
        "Corner lot · left",
      ],
      [{ left: "unknown", right: "unknown", cornerLot: false }, "Lot position unknown"],
    ];
    for (const [siteTopology, expected] of cases) {
      const workspace = useStudio.getState().workspace!;
      useStudio.setState({
        workspace: {
          ...workspace,
          persistedDna: {
            ...workspace.persistedDna,
            context: { ...workspace.persistedDna.context, siteTopology },
          },
        },
      });
      cleanup();
      render(<OverviewPanel />);
      expect(screen.getByText(expected)).toBeTruthy();
    }
  });

  it("keeps ordinary front cameras on normal framing for exterior projects", async () => {
    await openExterior();
    useStudio.getState().editDna("cameras", [
      {
        ...blankCamera(),
        name: "Front",
        viewType: "exterior_front",
        composition: "front facade",
      },
    ]);
    render(<CameraPanel />);
    expect(screen.getByText("Normal site view")).toBeTruthy();
    expect(screen.queryByText("Oblique street view — attached side hidden")).toBeNull();
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
    expect(screen.queryByText("Lot position and neighbours")).toBeNull();
    expect(screen.queryByTestId("site-adjacency-editor")).toBeNull();
  });
});
