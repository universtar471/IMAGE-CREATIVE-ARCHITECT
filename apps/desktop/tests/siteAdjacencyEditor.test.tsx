/** Site adjacency editor (ADR-034, SRS P1b): four sides, evidence, both representations. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ProjectDNASchema,
  blankCamera,
  resolveSiteAdjacency,
  type ProjectDNA,
  type SiteTopology,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { useLocale } from "../src/i18n";
import { ContextDnaPanel } from "../src/features/dna/ContextDnaPanel";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { SiteAdjacencyEditor } from "../src/features/site/SiteAdjacencyEditor";
import { statusAfterKindChange } from "../src/features/site/siteEdit";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  useLocale.setState({ locale: "en" });
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});

afterEach(() => {
  cleanup();
  setTransport(null);
  useLocale.setState({ locale: "en" });
});

async function openTownhouse() {
  const project = await createProject({
    name: "Site editor",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

const draft = () => useStudio.getState().workspace!.draftDna as ProjectDNA;
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;

describe("site adjacency editor", () => {
  it("opens on the sides derived from the older toggles", async () => {
    await openTownhouse();
    render(<SiteAdjacencyEditor />);
    // The townhouse starter describes both neighbours as attached (inferred, ADR-028).
    expect(draft().site).toBeUndefined();
    expect(select("Left side").value).toBe("attached_building");
    expect(select("Right side").value).toBe("attached_building");
    expect(select("Front side").value).toBe("street");
    expect(select("Rear side").value).toBe("unknown");
    expect(select("Left evidence").value).toBe("inferred");
    expect(screen.getByText(/Left and right are as seen standing outside/)).toBeTruthy();
    expect(screen.getByText(/Derived from the older lot settings/)).toBeTruthy();
    const plan = screen.getByTestId("site-plan");
    expect(plan.dataset).toMatchObject({
      front: "street",
      left: "attached_building",
      right: "attached_building",
      rear: "unknown",
    });
  });

  it("writes both dna.site and the synced context.siteTopology", async () => {
    await openTownhouse();
    render(<SiteAdjacencyEditor />);
    fireEvent.change(select("Left side"), { target: { value: "street" } });
    const site = draft().site!;
    expect(site).toMatchObject({
      version: 1,
      coordinateConvention: "viewer_facing_front_facade",
      left: { kind: "street", evidence: { status: "user_declared" } },
      right: { kind: "attached_building" },
      front: { kind: "street" },
      rear: { kind: "unknown" },
    });
    expect(draft().context.siteTopology).toEqual({
      left: "open",
      right: "attached",
      cornerLot: true,
      cornerSide: "left",
    } satisfies SiteTopology);
    expect(screen.queryByText(/Derived from the older lot settings/)).toBeNull();
    expect(screen.getByTestId("site-plan").dataset.left).toBe("street");

    fireEvent.change(select("Left evidence"), { target: { value: "verified" } });
    expect(draft().site!.left.evidence.status).toBe("verified");
    fireEvent.change(select("Rear side"), { target: { value: "boundary_wall" } });
    expect(draft().site!.rear).toMatchObject({
      kind: "boundary_wall",
      evidence: { status: "user_declared" },
    });
    // A wall is never a free side for the older code paths.
    fireEvent.change(select("Right side"), { target: { value: "boundary_wall" } });
    expect(draft().context.siteTopology).toMatchObject({ right: "unknown" });
    // The resolver reads the stored site, which wins over the toggles.
    expect(resolveSiteAdjacency(draft()).source).toBe("site");
  });

  it("persists both representations through the parsed mock backend", async () => {
    const project = await openTownhouse();
    render(<SiteAdjacencyEditor />);
    fireEvent.change(select("Right side"), { target: { value: "open_space" } });
    expect(await useStudio.getState().flushDna()).toBe(true);
    const persisted = ProjectDNASchema.parse(await call("dna_get", { projectId: project.id }));
    expect(persisted.site?.right.kind).toBe("open_space");
    expect(persisted.context.siteTopology).toMatchObject({ left: "attached", right: "open" });
  });

  it("keeps declared or verified evidence when only the kind changes", () => {
    expect(statusAfterKindChange("street", "unknown")).toBe("user_declared");
    expect(statusAfterKindChange("street", "inferred")).toBe("user_declared");
    expect(statusAfterKindChange("street", "verified")).toBe("verified");
    expect(statusAfterKindChange("unknown", "verified")).toBe("unknown");
  });

  it("cannot be edited in a read-only project or with the context locked", async () => {
    const project = await openTownhouse();
    db.projects[project.id]!.archivedAt = "2026-10-16T00:00:00Z";
    await useStudio.getState().openProject(project.id);
    render(<SiteAdjacencyEditor />);
    for (const label of ["Front side", "Left side", "Right side", "Rear side", "Left evidence"])
      expect(select(label).disabled, label).toBe(true);
    fireEvent.change(select("Left side"), { target: { value: "street" } });
    expect(draft().site).toBeUndefined();

    cleanup();
    await openTownhouse();
    useStudio.getState().editDna("locks.context", true);
    render(<SiteAdjacencyEditor />);
    expect(select("Left side").disabled).toBe(true);
  });

  it("replaces the ADR-028 toggles in the context panel", async () => {
    await openTownhouse();
    render(<ContextDnaPanel />);
    expect(screen.getByTestId("site-adjacency-editor")).toBeTruthy();
    expect(screen.queryByTestId("site-topology-card")).toBeNull();
    expect(screen.queryByLabelText("Corner side")).toBeNull();
  });

  it("renders accented Vietnamese labels", async () => {
    useLocale.setState({ locale: "vi" });
    await openTownhouse();
    render(<SiteAdjacencyEditor />);
    expect(screen.getByText("Vị trí lô đất và nhà bên cạnh")).toBeTruthy();
    expect(select("Bên trái").value).toBe("attached_building");
    expect(screen.getAllByRole("option", { name: "Nhà liền kề" }).length).toBe(4);
    expect(screen.getAllByRole("option", { name: "Người dùng khai báo" }).length).toBe(4);
  });
});

describe("camera chip resolution", () => {
  it("writes the site extension too when an unknown side is resolved", async () => {
    const project = await createProject({
      name: "Custom chip",
      projectType: "custom",
      subtype: "default",
      starter: {},
    });
    await useStudio.getState().openProject(project.id);
    useStudio
      .getState()
      .editDna("cameras", [
        { ...blankCamera(), name: "Side", viewType: "exterior_side" as const, azimuthDeg: 25 },
      ]);
    render(<CameraPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Corner lot" }));
    expect(draft().site?.left).toMatchObject({
      kind: "street",
      evidence: { status: "user_declared" },
    });
    expect(draft().context.siteTopology).toMatchObject({
      left: "open",
      cornerLot: true,
      cornerSide: "left",
    });
  });
});
