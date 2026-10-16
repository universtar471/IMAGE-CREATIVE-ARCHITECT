/** ADR-040 UI-1/UI-2: five-section navigation, section tabs and "Ảnh của tôi". */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../src/app/services";
import { selectSection, useStudio } from "../src/app/store";
import { WorkspaceNav } from "../src/components/shell/WorkspaceNav";
import { SectionTabs } from "../src/features/workspace/ProjectWorkspace";
import {
  sectionOfModule,
  WORKSPACE_MODULES,
  WORKSPACE_SECTIONS,
} from "../src/features/workspace/modules";
import { LibraryView } from "../src/features/library/LibraryView";
import { LibraryActions } from "../src/features/library/LibraryPanel";
import {
  actionTargets,
  EMPTY_LIBRARY_FILTERS,
  filterLibraryAssets,
  useLibrary,
} from "../src/features/library/library";
import { setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let calls: { command: string; args: unknown }[];

const STUDIO_ORDER = [
  "overview",
  "design_dna",
  "context",
  "references",
  "camera",
  "detail",
  "scene_objects",
  "effects",
  "lighting",
];

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  calls = [];
  const base = createMockTransport(db);
  const transport: Transport = async (command, args) => {
    calls.push({ command, args });
    // jsdom cannot fetch the fixtures' blob: URLs; the preview bytes only need to exist.
    if (command === "asset_preview") return new Uint8Array([137, 80, 78, 71]);
    return base(command, args);
  };
  transport.connectEvents = base.connectEvents;
  setTransport(transport);
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
  useLibrary.setState({ projectId: null, checkedIds: [], filters: EMPTY_LIBRARY_FILTERS });
});

afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openProject() {
  const project = await createProject({
    name: "Shell",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  db.assets.GEN = asset(project.id, "GEN", {
    source: "ai_generated",
    role: "regular_image",
    originalName: "Mặt tiền chiều.png",
  });
  db.assets.IMP = asset(project.id, "IMP", { originalName: "site-photo.jpg" });
  db.assets.SKETCH = asset(project.id, "SKETCH", {
    role: "structure_sketch",
    originalName: "sketch.png",
  });
  db.assets.GONE = asset(project.id, "GONE", { status: "missing_file", originalName: "old.jpg" });
  await useStudio.getState().openProject(project.id);
  return project;
}

describe("section registry", () => {
  it("assigns every module to exactly one section in ADR-040 order", () => {
    expect(WORKSPACE_SECTIONS.map((s) => s.id)).toEqual([
      "create",
      "library",
      "edit",
      "present",
      "studio",
    ]);
    const all = WORKSPACE_SECTIONS.flatMap((s) => s.modules);
    expect([...all].sort()).toEqual(WORKSPACE_MODULES.map((m) => m.id).sort());
    expect(WORKSPACE_SECTIONS.find((s) => s.id === "edit")!.modules).toEqual([
      "mood_grade",
      "enhance",
      "regions",
    ]);
    expect(WORKSPACE_SECTIONS.find((s) => s.id === "present")!.modules).toEqual([
      "export",
      "diagram",
    ]);
    expect(WORKSPACE_SECTIONS.find((s) => s.id === "studio")!.modules).toEqual(STUDIO_ORDER);
    expect(sectionOfModule("generate")).toBe("create");
  });
});

describe("workspace navigation", () => {
  it("renders five sections with Studio separated at the bottom and its nine modules", async () => {
    await openProject();
    render(<WorkspaceNav />);
    const sections = [...document.querySelectorAll("[data-section]")].map((el) =>
      el.getAttribute("data-section"),
    );
    expect(sections).toEqual(["create", "library", "edit", "present", "studio"]);
    expect(screen.getByText("Auto image generation")).toBeTruthy();
    expect(screen.getByText("My images")).toBeTruthy();
    expect(screen.getByText("Advanced studio")).toBeTruthy();
    const studio = document.querySelector(".nav-studio")!;
    expect(studio.querySelector('[data-section="studio"]')).toBeTruthy();
    const group = screen.getByRole("group", { name: "Advanced studio modules" });
    const modules = [...group.querySelectorAll("[data-module]")].map((el) =>
      el.getAttribute("data-module"),
    );
    expect(modules).toEqual(STUDIO_ORDER);
    // Workflow step numbers and status icons stay on the DNA steps.
    expect(group.querySelector('[data-module="design_dna"] .nav-step-number')?.textContent).toBe(
      "1",
    );
    expect(within(group as HTMLElement).getByTestId("workflow-status-dna.lighting")).toBeTruthy();
  });

  it("shows the Studio list only while Studio is open", async () => {
    await openProject();
    render(<WorkspaceNav />);
    fireEvent.click(document.querySelector('[data-section="edit"]')!);
    expect(useStudio.getState().activeModule).toBe("mood_grade");
    expect(document.querySelector('[data-section="edit"]')!.getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.queryByRole("group", { name: "Advanced studio modules" })).toBeNull();
  });

  it("keeps the interior label for design_dna", async () => {
    const project = await createProject({
      name: "Interior",
      projectType: "interior",
      subtype: "default",
      starter: {},
    });
    await useStudio.getState().openProject(project.id);
    render(<WorkspaceNav />);
    const group = screen.getByRole("group", { name: "Advanced studio modules" });
    expect(group.querySelector('[data-module="design_dna"] .nav-label')?.textContent).toBe("Space");
  });
});

describe("section tabs and memory", () => {
  it("setModule('enhance') selects the edit section and its tab", async () => {
    await openProject();
    act(() => useStudio.getState().setModule("enhance"));
    expect(selectSection(useStudio.getState())).toBe("edit");
    render(<SectionTabs section="edit" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("data-module"))).toEqual([
      "mood_grade",
      "enhance",
      "regions",
    ]);
    expect(screen.getByRole("tab", { name: /Sharpen/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /Edit one region/ }));
    expect(useStudio.getState().activeModule).toBe("regions");
  });

  it("shows no tab strip for create, library or studio", () => {
    render(<SectionTabs section="studio" />);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("restores each section's last module and keeps it out of the DNA", async () => {
    await openProject();
    const s = () => useStudio.getState();
    s().setModule("regions");
    s().setModule("camera");
    s().setModule("diagram");
    s().setSection("edit");
    expect(s().activeModule).toBe("regions");
    s().setSection("studio");
    expect(s().activeModule).toBe("camera");
    s().setSection("present");
    expect(s().activeModule).toBe("diagram");
    s().setSection("create");
    expect(s().activeModule).toBe("generate");
    expect(s().sectionModules).toEqual({
      create: "generate",
      edit: "regions",
      present: "diagram",
      studio: "camera",
    });
    expect(JSON.stringify(s().workspace!.draftDna)).not.toContain("sectionModules");
  });

  it("collapses the tray in the library and restores it afterwards", async () => {
    await openProject();
    const s = () => useStudio.getState();
    expect(s().trayCollapsed).toBe(false);
    s().setSection("library");
    expect(selectSection(s())).toBe("library");
    expect(s().trayCollapsed).toBe(true);
    s().setSection("edit");
    expect(selectSection(s())).toBe("edit");
    expect(s().trayCollapsed).toBe(false);
  });
});

describe("Ảnh của tôi", () => {
  it("filters by name (accent-insensitive), kind and status", () => {
    const list = [
      asset("P", "GEN", { source: "ai_generated", originalName: "Mặt tiền chiều.png" }),
      asset("P", "IMP", { originalName: "site-photo.jpg" }),
      asset("P", "GONE", { status: "missing_file", originalName: "old.jpg" }),
    ];
    const ids = (f: Partial<typeof EMPTY_LIBRARY_FILTERS>) =>
      filterLibraryAssets(list, { ...EMPTY_LIBRARY_FILTERS, ...f }).map((a) => a.id);
    expect(ids({})).toEqual(["GEN", "IMP", "GONE"]);
    expect(ids({ name: "mat tien" })).toEqual(["GEN"]);
    expect(ids({ kind: "generated" })).toEqual(["GEN"]);
    expect(ids({ kind: "imported" })).toEqual(["IMP", "GONE"]);
    expect(ids({ status: "missing_file" })).toEqual(["GONE"]);
    expect(actionTargets(list, [], "IMP").map((a) => a.id)).toEqual(["IMP"]);
    expect(actionTargets(list, ["GONE", "GEN"], "IMP").map((a) => a.id)).toEqual(["GEN", "GONE"]);
  });

  it("grid filters and multi-select", async () => {
    await openProject();
    useStudio.getState().setSection("library");
    render(<LibraryView />);
    expect(screen.getByTestId("library-count").textContent).toBe("4 of 4 images");
    fireEvent.change(screen.getByLabelText("Filter by name"), { target: { value: "photo" } });
    expect(screen.getByTestId("library-count").textContent).toBe("1 of 4 images");
    expect(screen.getAllByTestId("asset-thumb")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Filter by name"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "generated" } });
    expect(screen.getByTestId("library-count").textContent).toBe("1 of 4 images");
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ready" } });
    expect(screen.getByTestId("library-count").textContent).toBe("3 of 4 images");

    fireEvent.click(screen.getByLabelText("Select site-photo.jpg"));
    fireEvent.click(screen.getByLabelText("Select sketch.png"));
    expect(useLibrary.getState().checkedIds).toEqual(["IMP", "SKETCH"]);
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Select site-photo.jpg"));
    expect(useLibrary.getState().checkedIds).toEqual(["SKETCH"]);
    fireEvent.click(screen.getByRole("button", { name: "Select shown" }));
    expect(useLibrary.getState().checkedIds).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(useLibrary.getState().checkedIds).toEqual([]);

    // Clicking a tile selects it for the details panel.
    fireEvent.click(screen.getAllByTestId("asset-thumb")[0]!);
    expect(useStudio.getState().selectedAssetId).toBe("GEN");
  });

  it("opens the selected image in Chỉnh sửa ảnh", async () => {
    await openProject();
    useStudio.getState().setSection("library");
    useStudio.getState().selectAsset("IMP");
    render(<LibraryActions />);
    fireEvent.click(screen.getByRole("button", { name: /Open in Edit images/ }));
    expect(useStudio.getState().selectedAssetId).toBe("IMP");
    expect(selectSection(useStudio.getState())).toBe("edit");
    expect(useStudio.getState().activeModule).toBe("mood_grade");
  });

  it("uses the checked images as sources in Tạo ảnh", async () => {
    const project = await openProject();
    useStudio.getState().setSection("library");
    useLibrary.getState().setChecked(project.id, ["GEN", "IMP"]);
    render(<LibraryActions />);
    fireEvent.click(screen.getByRole("button", { name: /Use as source/ }));
    const state = useStudio.getState();
    expect(state.generateDraft.referenceAssetIds).toEqual(["GEN", "IMP"]);
    expect(state.generateDraft.source).toBe("dna");
    expect(state.activeModule).toBe("generate");
    expect(selectSection(state)).toBe("create");
  });

  it("switches Generate to sketch mode for one structure sketch", async () => {
    await openProject();
    useStudio.getState().setSection("library");
    useStudio.getState().selectAsset("SKETCH");
    render(<LibraryActions />);
    fireEvent.click(screen.getByRole("button", { name: /Use as source/ }));
    expect(useStudio.getState().generateDraft).toMatchObject({
      source: "sketch",
      referenceAssetIds: ["SKETCH"],
    });
  });

  it("downloads through the existing export bridge, skipping missing files", async () => {
    const project = await openProject();
    useStudio.getState().setSection("library");
    useLibrary.getState().setChecked(project.id, ["IMP", "GONE"]);
    render(<LibraryActions />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Download/ }));
    });
    await screen.findByRole("button", { name: /^Download$/ });
    expect(calls.filter((c) => c.command === "asset_preview").map((c) => c.args)).toEqual([
      { request: { projectId: project.id, assetId: "IMP", maxEdge: 4096 } },
    ]);
    const save = calls.find((c) => c.command === "publication_export_save");
    expect(save?.args).toMatchObject({
      request: {
        projectId: project.id,
        format: "png",
        baseName: "site-photo",
        files: ["iVBORw=="],
      },
    });
  });

  it("disables the actions when only missing files are selected", async () => {
    await openProject();
    useStudio.getState().setSection("library");
    useStudio.getState().selectAsset("GONE");
    render(<LibraryActions />);
    expect(
      (screen.getByRole("button", { name: /Open in Edit images/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: /Download/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
