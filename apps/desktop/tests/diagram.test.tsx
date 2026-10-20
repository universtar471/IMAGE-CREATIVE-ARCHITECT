/**
 * ADR-037 P4: the Diagram Studio flow (source → type → count → layout → language → plan →
 * edit/approve → export), the FFmpeg-missing state and the bridge contract of the commands.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DiagramVideoExportResultSchema } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { useLocale } from "../src/i18n";
import { DiagramPanel, diagramSourceId } from "../src/features/diagram/DiagramPanel";
import { DiagramCanvas } from "../src/features/diagram/DiagramCanvas";
import { useDiagram } from "../src/features/diagram/useDiagram";
import { WORKSPACE_MODULES } from "../src/features/workspace/modules";
import { asset } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let sent: string[];

function useTransport(options: { ffmpeg?: boolean } = {}) {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  sent = [];
  const base = createMockTransport(db, options);
  const recording: Transport = (command, args) => {
    sent.push(command);
    return base(command, args);
  };
  recording.connectEvents = base.connectEvents;
  setTransport(recording);
}

beforeEach(() => {
  useLocale.setState({ locale: "vi" });
  useTransport();
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    toasts: [],
    providers: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
  useDiagram.setState({ projectId: null, plan: null });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openTownhouse() {
  const project = await createProject({
    name: "Nhà phố",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  const masterId = `AST_MASTER_${project.id}`;
  db.assets[masterId] = asset(project.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: project.id, assetId: masterId });
  await useStudio.getState().openProject(project.id);
  return { project, masterId };
}

describe("Diagram module", () => {
  it("is registered in Publish, before Publishing Studio, and enabled", () => {
    const ids = WORKSPACE_MODULES.map((m) => m.id);
    expect(ids.indexOf("diagram")).toBe(ids.indexOf("export") - 1);
    expect(WORKSPACE_MODULES.find((m) => m.id === "diagram")!.group).toBe("publish");
    expect(WORKSPACE_MODULES.find((m) => m.id === "diagram")!.availableIn).toBeNull();
  });

  it("picks the chosen render, else the selection, else the master", () => {
    const a = asset("P", "AST_A");
    const b = asset("P", "AST_B");
    expect(diagramSourceId([a, b], "AST_B", "AST_A", "AST_A")).toBe("AST_B");
    expect(diagramSourceId([a, b], null, "AST_B", "AST_A")).toBe("AST_B");
    expect(diagramSourceId([a, b], "AST_GONE", null, "AST_A")).toBe("AST_A");
    expect(diagramSourceId([], null, null, null)).toBeNull();
  });
});

describe("DiagramPanel (SRS §10.2 flow)", () => {
  it("plans, edits and approves steps; export needs every approval; MP4 says Chưa cài FFmpeg", async () => {
    await openTownhouse();
    render(<DiagramPanel />);
    const panel = screen.getByTestId("diagram-panel");
    fireEvent.click(within(panel).getByRole("button", { name: "8" }));
    fireEvent.click(screen.getByTestId("diagram-plan"));

    const plan = useDiagram.getState().plan!;
    expect(plan.family).toBe("townhouse");
    expect(plan.steps).toHaveLength(8);
    expect(screen.getAllByTestId(/^diagram-step-/)).toHaveLength(8);
    // AC-14 in the UI: no interior step can be set to verified without space facts.
    const interiorPlan = (() => {
      useDiagram.getState().configure({ type: "functional_zoning" });
      useDiagram.getState().makePlan(useStudio.getState().workspace!.draftDna, "townhouse");
      return useDiagram.getState().plan!;
    })();
    cleanup();
    render(<DiagramPanel />);
    const interior = interiorPlan.steps.find((s) => s.interior)!;
    const step = screen.getByTestId(`diagram-step-${interior.index}`);
    const evidence = within(step).getByLabelText("Mức căn cứ") as HTMLSelectElement;
    expect(
      (within(evidence).getByRole("option", { name: "Đã xác minh" }) as HTMLOptionElement).disabled,
    ).toBe(true);
    expect(step.textContent).toContain("dữ liệu không gian đã xác nhận");

    // Export is locked until every step is approved.
    expect(screen.getByTestId("diagram-export-hint").textContent).toBe(
      "Duyệt tất cả các bước để xuất.",
    );
    expect((screen.getByTestId("diagram-png-2K") as HTMLButtonElement).disabled).toBe(true);
    for (const s of interiorPlan.steps)
      fireEvent.click(screen.getByTestId(`diagram-approve-${s.index}`));
    expect(screen.queryByTestId("diagram-export-hint")).toBeNull();
    expect((screen.getByTestId("diagram-png-4K") as HTMLButtonElement).disabled).toBe(false);

    // Editing a step clears its approval.
    const title = within(screen.getByTestId("diagram-step-0")).getByLabelText(
      "Tiêu đề (tiếng Việt)",
    ) as HTMLInputElement;
    fireEvent.change(title, { target: { value: "Vùng đón khách" } });
    expect(useDiagram.getState().plan!.steps[0]!).toMatchObject({
      approved: false,
      title: { vi: "Vùng đón khách" },
    });
    expect((screen.getByTestId("diagram-png-2K") as HTMLButtonElement).disabled).toBe(true);

    // FFmpeg is missing in the mock: the MP4 button is disabled with the clear label.
    await act(async () => {});
    const mp4 = screen.getByTestId("diagram-mp4") as HTMLButtonElement;
    expect(mp4.disabled).toBe(true);
    expect(mp4.textContent).toContain("Chưa cài FFmpeg");
    expect(screen.getByTestId("diagram-ffmpeg-missing").textContent).toContain("PATH");
    // Nothing paid was sent.
    expect(sent).not.toContain("batch_create");
    expect(sent).not.toContain("generation_submit");
  }, 20_000);

  it("previews the vector sheet in the canvas", async () => {
    await openTownhouse();
    render(<DiagramPanel />);
    fireEvent.click(screen.getByTestId("diagram-plan"));
    render(<DiagramCanvas />);
    const img = screen.getByAltText("Xem trước bảng sơ đồ") as HTMLImageElement;
    const svg = decodeURIComponent(img.src.slice(img.src.indexOf(",") + 1));
    expect(svg).toContain("Diễn tiến ý tưởng — Nhà phố");
    expect(svg).toContain("sơ đồ diễn giải ý tưởng");
  });

  it("shows the empty state before a plan and the no-source hint without images", async () => {
    const project = await createProject({
      name: "Trống",
      projectType: "villa",
      subtype: "default",
      starter: {},
    });
    await useStudio.getState().openProject(project.id);
    render(<DiagramPanel />);
    expect(screen.getByTestId("diagram-no-source")).toBeTruthy();
    expect((screen.getByTestId("diagram-plan") as HTMLButtonElement).disabled).toBe(true);
    render(<DiagramCanvas />);
    expect(screen.getByTestId("diagram-canvas").textContent).toContain(
      "Lập các bước để xem bảng sơ đồ.",
    );
  });
});

describe("diagram bridge commands (mock backend)", () => {
  it("saves a sheet with lineage and exports a video when FFmpeg is present", async () => {
    useTransport({ ffmpeg: true });
    const { project, masterId } = await openTownhouse();
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const sheet = await call("diagram_image_save", {
      projectId: project.id,
      parentAssetId: masterId,
      pngBase64: png,
      label: "Bảng sơ đồ 2K",
      kind: "sheet",
    });
    expect(sheet).toMatchObject({
      parentAssetId: masterId,
      operation: "diagram_sheet",
      role: "regular_image",
    });
    expect(await call("diagram_ffmpeg_status", {})).toMatchObject({ available: true });
    const result = await call("diagram_video_export", {
      projectId: project.id,
      frames: [{ path: sheet.absolutePath, durationMs: 3000, motion: "appear" }],
      width: 1920,
      height: 1080,
      fps: 30,
    });
    expect(DiagramVideoExportResultSchema.parse(result)).toMatchObject({
      durationMs: 3000,
      frameCount: 1,
    });
  });

  it("reports a missing FFmpeg as INVALID_STATE with reason ffmpeg_missing", async () => {
    const { project } = await openTownhouse();
    await expect(
      call("diagram_video_export", {
        projectId: project.id,
        frames: [{ path: "x.png", durationMs: 3000, motion: "zoom" }],
        width: 1920,
        height: 1080,
        fps: 30,
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE", details: { reason: "ffmpeg_missing" } });
  });
});
