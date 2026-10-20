/**
 * ADR-036 P2d: the scene-object flow (target → category → preset → quantity → zone → state →
 * preview), stored in the workspace ShotIntent (never the DNA) and enforced by the gate.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  SITE_FRONTAGE_TARGET,
  type ProjectDNA,
  type SceneObjectRequest,
  type SpaceInstance,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { useLocale } from "../src/i18n";
import { SceneObjectsPanel } from "../src/features/sceneObjects/SceneObjectsPanel";
import { asset, confirmAllDna } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let sent: string[];

beforeEach(() => {
  useLocale.setState({ locale: "vi" });
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  sent = [];
  const base = createMockTransport(db);
  const recording: Transport = (command, args) => {
    sent.push(command);
    return base(command, args);
  };
  recording.connectEvents = base.connectEvents;
  setTransport(recording);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    toasts: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

const verified = { status: "verified" as const, sourceAssetIds: [] };
const BEDROOM = "SPC_BEDROOM";
const GARAGE = "SPC_GARAGE";

const space = (
  id: string,
  presetId: string,
  facts: SpaceInstance["facts"] = {},
): SpaceInstance => ({
  id,
  presetId,
  facts,
  lockedElementIds: [],
  approvedOptionalIds: [],
});

/** A villa with a bedroom and a garage measured at 6 × 6 m (verified). */
async function openVilla() {
  const project = await createProject({
    name: "Biệt thự",
    projectType: "villa",
    subtype: "default",
    starter: {},
  });
  const dna = db.dna[project.id] as ProjectDNA;
  dna.spaceCatalog = {
    version: 1,
    buildingArchetype: "villa",
    spaces: [
      space(BEDROOM, "villa.sleeping.master_suite"),
      space(GARAGE, "villa.service.gara", {
        widthM: { value: 6, evidence: verified },
        depthM: { value: 6, evidence: verified },
      }),
    ],
    activeSpaceId: BEDROOM,
  };
  const masterId = `AST_MASTER_${project.id}`;
  db.assets[masterId] = asset(project.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: project.id, assetId: masterId });
  await confirmAllDna(project.id, { approveMaster: true });
  await useStudio.getState().openProject(project.id);
  sent = [];
  return { project, masterId };
}

const ws = () => useStudio.getState().workspace!;

const hero = (projectId: string, masterId: string) => ({
  projectId,
  providerId: "local_preview",
  modelId: "placeholder-v1",
  purpose: "hero" as const,
  referenceAssetIds: [masterId],
  params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
});

const request = (over: Partial<SceneObjectRequest>): SceneObjectRequest => ({
  presetId: "car.mercedes_300sl.gullwing",
  quantity: 1,
  targetSpaceId: GARAGE,
  placementZoneId: "garage_bay",
  state: "static",
  sourceReferenceIds: [],
  ...over,
});

describe("SceneObjectsPanel (SRS §7.1 flow)", () => {
  it("AC-06 in the UI: a bedroom disables cars with the reason and keeps the DNA untouched", async () => {
    await openVilla();
    const dnaBefore = JSON.stringify(ws().draftDna);
    render(<SceneObjectsPanel />);
    const panel = screen.getByTestId("scene-objects-panel");

    expect((within(panel).getByLabelText("1. Không gian đích") as HTMLSelectElement).value).toBe(
      BEDROOM,
    );
    expect(within(panel).getByTestId("scene-objects-rule").textContent).toBe(
      "Phòng ngủ chỉ nhận người, thú cưng và chậu cây; không đặt ô tô hay xe máy.",
    );
    const car = within(panel).getByRole("button", { name: "Ô tô" }) as HTMLButtonElement;
    expect(car.disabled).toBe(true);
    expect(car.title).toContain("không đặt ô tô");
    expect(
      (within(panel).getByRole("button", { name: "Xe máy" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(within(panel).getByRole("button", { name: "Người" }));
    fireEvent.change(within(panel).getByLabelText("4. Số lượng"), { target: { value: "2" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Thêm vào cảnh" }));

    expect(ws().shotIntent).toEqual({
      projectType: "villa",
      sceneObjects: [
        {
          presetId: "person.adult",
          quantity: 2,
          targetSpaceId: BEDROOM,
          placementZoneId: "floor",
          state: "static",
          sourceReferenceIds: [],
        },
      ],
    });
    // Per-shot choices never reach the DNA.
    expect(JSON.stringify(ws().draftDna)).toBe(dnaBefore);
    expect(useStudio.getState().save.status).not.toBe("dirty");
    expect(within(panel).getByTestId("scene-object-prompt").textContent).toContain(
      "Add TWO adults in everyday clothing in the master suite",
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Xóa tất cả đối tượng" }));
    expect(ws().shotIntent).toBeUndefined();
  });

  it("AC-07 in the UI: a verified garage takes a 300 SL, labelled as a simulated model", async () => {
    await openVilla();
    render(<SceneObjectsPanel />);
    const panel = screen.getByTestId("scene-objects-panel");
    fireEvent.change(within(panel).getByLabelText("1. Không gian đích"), {
      target: { value: GARAGE },
    });
    expect(
      (within(panel).getByRole("button", { name: "Thú cưng" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Ô tô" }));

    const preset = within(panel).getByLabelText("3. Mẫu cụ thể") as HTMLSelectElement;
    expect(preset.value).toBe("car.mercedes_300sl.gullwing");
    expect(preset.selectedOptions[0]!.textContent).toBe(
      "Mercedes-Benz 300 SL Gullwing (coupe) (mô phỏng theo mẫu xe)",
    );
    expect([...preset.options].map((o) => o.value)).toContain("car.shelby_cobra.1964_289");
    expect(within(panel).getByTestId("scene-object-trademark")).toBeTruthy();

    const zone = within(panel).getByLabelText("5. Vị trí đặt") as HTMLSelectElement;
    expect(zone.selectedOptions[0]!.textContent).toBe("Chỗ đỗ trong gara · đã xác minh");
    // A garage is parking only: moving is disabled with its reason.
    const state = within(panel).getByLabelText("6. Đứng yên hay chuyển động") as HTMLSelectElement;
    expect([...state.options].find((o) => o.value === "moving")!.disabled).toBe(true);
    fireEvent.click(
      within(panel).getByRole("button", { name: "Trợ giúp: 6. Đứng yên hay chuyển động" }),
    );
    expect(screen.getByRole("note").textContent).toContain(
      "Xe chỉ có thể di chuyển trên đường hiện hữu.",
    );
    fireEvent.click(
      within(panel).getByRole("button", { name: "Trợ giúp: 6. Đứng yên hay chuyển động" }),
    );

    fireEvent.change(within(panel).getByLabelText("Màu sơn / màu sắc"), {
      target: { value: "silver" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Thêm vào cảnh" }));
    expect(ws().shotIntent?.sceneObjects).toEqual([
      request({ appearanceOverrides: { color: "silver" } }),
    ]);
    expect(within(panel).queryByRole("alert")).toBeNull();
    expect(within(panel).getByTestId("scene-object-prompt").textContent).toContain(
      "Add ONE parked 1950s Mercedes-Benz 300 SL Gullwing coupe",
    );
  });

  it("disables a zone the project data does not record, and offers no frontage indoors", async () => {
    const project = await createProject({
      name: "Sân",
      projectType: "villa",
      subtype: "default",
      starter: {},
    });
    (db.dna[project.id] as ProjectDNA).spaceCatalog = {
      version: 1,
      buildingArchetype: "villa",
      spaces: [space("SPC_YARD", "villa.outdoor.san_vuon_rong")],
      activeSpaceId: "SPC_YARD",
    };
    await useStudio.getState().openProject(project.id);
    render(<SceneObjectsPanel />);
    const panel = screen.getByTestId("scene-objects-panel");
    const targets = within(panel).getByLabelText("1. Không gian đích") as HTMLSelectElement;
    expect([...targets.options].map((o) => o.value)).toEqual(["SPC_YARD", SITE_FRONTAGE_TARGET]);
    fireEvent.click(within(panel).getByRole("button", { name: "Ô tô" }));
    const zone = within(panel).getByLabelText("5. Vị trí đặt") as HTMLSelectElement;
    expect([...zone.options].every((o) => o.disabled)).toBe(true);
    fireEvent.click(within(panel).getByRole("button", { name: "Trợ giúp: 5. Vị trí đặt" }));
    expect(screen.getByRole("note").textContent).toContain(
      "Vị trí này chưa có trong dữ liệu dự án. Ứng dụng không bao giờ tự tạo lối xe vào, gara hay đường.",
    );
    fireEvent.click(within(panel).getByRole("button", { name: "Trợ giúp: 5. Vị trí đặt" }));
    expect(
      (within(panel).getByRole("button", { name: "Thêm vào cảnh" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows English labels after a language switch", async () => {
    await openVilla();
    useLocale.setState({ locale: "en" });
    render(<SceneObjectsPanel />);
    const panel = screen.getByTestId("scene-objects-panel");
    expect(within(panel).getByLabelText("1. Target space")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Cars" })).toBeTruthy();
  });
});

describe("conflict gate with scene objects", () => {
  it("AC-06: blocks a classic car in a bedroom before any bridge submit", async () => {
    const { project, masterId } = await openVilla();
    useStudio.getState().setShotIntent({
      projectType: "villa",
      sceneObjects: [request({ targetSpaceId: BEDROOM, placementZoneId: undefined })],
    });
    const g = await useStudio.getState().submitGeneration(hero(project.id, masterId));
    expect(g).toBeUndefined();
    const run = useStudio.getState().run;
    expect(run?.status === "error" && run.validation?.verdict).toBe("BLOCK");
    expect(run?.status === "error" && run.validation?.issues[0]).toMatchObject({
      code: "OBJECT_NOT_ALLOWED_IN_SPACE",
      severity: "BLOCK",
      exceptionAllowed: false,
    });
    expect(sent).not.toContain("generation_submit");
  });

  it("AC-07: submits a 300 SL in the verified garage and snapshots the shot intent", async () => {
    const { project, masterId } = await openVilla();
    const objects = [request({})];
    useStudio.getState().setShotIntent({ projectType: "villa", sceneObjects: objects });
    const queued = await useStudio.getState().submitGeneration(hero(project.id, masterId));
    expect(queued?.status).toBe("queued");
    const stored = await call("generation_get", {
      projectId: project.id,
      generationId: queued!.id,
    });
    expect(stored.prompt.validation).toMatchObject({ verdict: "ALLOW", issueCodes: [] });
    expect(stored.prompt.shotIntent).toMatchObject({ projectType: "villa", sceneObjects: objects });
    expect(stored.prompt.positivePrompt).toContain(
      "SCENE OBJECTS:\nAdd ONE parked 1950s Mercedes-Benz 300 SL Gullwing coupe",
    );
    // The DNA saved for the project has no trace of the objects.
    expect(JSON.stringify(db.dna[project.id])).not.toContain("mercedes");
  });

  it("restores the project's shot intent when it is reopened", async () => {
    const { project } = await openVilla();
    useStudio.getState().setShotIntent({ projectType: "villa", sceneObjects: [request({})] });
    await useStudio.getState().openProject(project.id);
    expect(ws().shotIntent?.sceneObjects).toHaveLength(1);
  });
});
