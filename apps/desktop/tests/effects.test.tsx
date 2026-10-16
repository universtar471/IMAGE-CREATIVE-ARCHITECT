/**
 * ADR-036 P2c: the effect cards (status, reason, primary / secondary, intensity slider),
 * stored in the workspace ShotIntent (never the DNA) and enforced by the conflict gate
 * (AC-08, AC-09).
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
import { EffectsPanel } from "../src/features/effects/EffectsPanel";
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

const BEDROOM = "SPC_BEDROOM";

const space = (id: string, presetId: string): SpaceInstance => ({
  id,
  presetId,
  facts: {},
  lockedElementIds: [],
  approvedOptionalIds: [],
});

/** A villa; with `bedroom` its active catalog space is a closed master suite. */
async function openVilla(bedroom: boolean) {
  const project = await createProject({
    name: "Biệt thự",
    projectType: "villa",
    subtype: "default",
    starter: {},
  });
  const dna = db.dna[project.id] as ProjectDNA;
  if (bedroom)
    dna.spaceCatalog = {
      version: 1,
      buildingArchetype: "villa",
      spaces: [space(BEDROOM, "villa.sleeping.master_suite")],
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

const parkedCar: SceneObjectRequest = {
  presetId: "car.generic.suv",
  quantity: 1,
  targetSpaceId: SITE_FRONTAGE_TARGET,
  placementZoneId: "existing_road",
  state: "static",
  sourceReferenceIds: [],
};

const card = (id: string) => screen.getByTestId(`effect-${id}`);
const button = (id: string, name: string) =>
  within(card(id)).getByRole("button", { name }) as HTMLButtonElement;

describe("EffectsPanel (SRS §6.2)", () => {
  it("AC-09 in the UI: soft clouds are disabled in a closed bedroom, with the plain reason", async () => {
    await openVilla(true);
    render(<EffectsPanel />);
    expect(screen.getAllByTestId(/^effect-/).map((el) => el.dataset.testid)).toHaveLength(8);
    expect(within(card("soft_clouds")).getByText("Mây mềm")).toBeTruthy();
    expect(card("soft_clouds").dataset.status).toBe("blocked");
    expect(card("soft_clouds").textContent).toContain(
      "Nội thất kín không có bầu trời, nên không có mây để làm mềm.",
    );
    expect(button("soft_clouds", "Chính").disabled).toBe(true);
    // Off by default: no secondary before a primary.
    expect(button("reflection_control", "Phụ").disabled).toBe(true);
    expect(screen.getByText("Không có hiệu ứng: Prompt giữ nguyên.")).toBeTruthy();
    expect(ws().shotIntent).toBeUndefined();
  });

  it("stores one primary with its intensity in the ShotIntent, never in the DNA", async () => {
    await openVilla(true);
    const dnaBefore = JSON.stringify(ws().draftDna);
    render(<EffectsPanel />);
    expect(card("reflection_control").dataset.status).toBe("conditional");
    expect(card("reflection_control").textContent).toContain("Phụ thuộc vào kính");

    fireEvent.click(button("reflection_control", "Chính"));
    expect(ws().shotIntent).toEqual({
      projectType: "villa",
      effects: { primary: { id: "reflection_control", intensity: "light" }, secondary: [] },
    });
    const slider = within(card("reflection_control")).getByRole("slider");
    fireEvent.change(slider, { target: { value: "2" } });
    expect(ws().shotIntent?.effects?.primary).toEqual({
      id: "reflection_control",
      intensity: "strong",
    });
    expect(card("reflection_control").textContent).toContain("Mức độ: Mạnh");
    expect(screen.getByTestId("effects-prompt").textContent).toContain(
      "Apply strong polarizing-filter reflection control to the existing glass and water surfaces, only where that source is present in the approved references.",
    );
    expect(JSON.stringify(ws().draftDna)).toBe(dnaBefore);
    expect(useStudio.getState().save.status).not.toBe("dirty");

    fireEvent.click(screen.getByRole("button", { name: "Tắt mọi hiệu ứng" }));
    expect(ws().shotIntent).toBeUndefined();
  });

  it("adds a compatible secondary and refuses an incompatible one", async () => {
    await openVilla(false);
    useStudio.getState().setShotIntent({
      projectType: "villa",
      sceneObjects: [{ ...parkedCar, state: "moving" }],
    });
    render(<EffectsPanel />);
    fireEvent.click(button("sunstar", "Chính"));
    fireEvent.click(button("lens_flare", "Phụ"));
    expect(ws().shotIntent?.effects?.secondary).toEqual([{ id: "lens_flare", intensity: "light" }]);
    expect(ws().shotIntent?.sceneObjects).toHaveLength(1);
    expect(button("god_rays", "Phụ").disabled).toBe(false);
    // Light trails as the primary keep the flare; light rays need the sun and are refused.
    expect(card("vehicle_light_trails").dataset.status).not.toBe("blocked");
    fireEvent.click(button("vehicle_light_trails", "Chính"));
    expect(ws().shotIntent?.effects).toEqual({
      primary: { id: "vehicle_light_trails", intensity: "light" },
      secondary: [{ id: "lens_flare", intensity: "light" }],
    });
    expect(button("god_rays", "Phụ").disabled).toBe(true);
    expect(button("god_rays", "Phụ").title).toBe("Không kết hợp được với các hiệu ứng đã chọn.");
    expect(button("vehicle_light_trails", "Phụ").title).toBe("Đây đã là hiệu ứng chính.");
  });

  it("AC-08 in the UI: light trails from a parked car are blocked as a motion conflict", async () => {
    await openVilla(false);
    useStudio.getState().setShotIntent({ projectType: "villa", sceneObjects: [parkedCar] });
    render(<EffectsPanel />);
    expect(card("vehicle_light_trails").dataset.status).toBe("blocked");
    expect(card("vehicle_light_trails").textContent).toContain("xe đỗ không thể tạo vệt sáng");
    expect(button("vehicle_light_trails", "Chính").disabled).toBe(true);
  });

  it("shows English labels after a language switch", async () => {
    await openVilla(true);
    useLocale.setState({ locale: "en" });
    render(<EffectsPanel />);
    expect(within(card("vehicle_light_trails")).getByText("Vehicle light trails")).toBeTruthy();
    expect(button("sunstar", "Primary")).toBeTruthy();
    expect(card("soft_clouds").textContent).toContain("A closed interior has no sky");
  });
});

describe("conflict gate with effects", () => {
  it("AC-09: blocks soft clouds in a closed interior before any bridge submit", async () => {
    const { project, masterId } = await openVilla(true);
    useStudio.getState().setShotIntent({
      projectType: "villa",
      effects: { primary: { id: "soft_clouds", intensity: "medium" }, secondary: [] },
    });
    const g = await useStudio.getState().submitGeneration(hero(project.id, masterId));
    expect(g).toBeUndefined();
    const run = useStudio.getState().run;
    expect(run?.status === "error" && run.validation?.verdict).toBe("BLOCK");
    expect(
      run?.status === "error" && run.validation?.issues.find((i) => i.code.startsWith("EFFECT_")),
    ).toMatchObject({ code: "EFFECT_SOURCE_MISSING", severity: "BLOCK", exceptionAllowed: false });
    expect(sent).not.toContain("generation_submit");
  });

  it("AC-08: blocks light trails while the only car is parked", async () => {
    const { project, masterId } = await openVilla(false);
    useStudio.getState().setShotIntent({
      projectType: "villa",
      sceneObjects: [parkedCar],
      effects: { primary: { id: "vehicle_light_trails", intensity: "light" }, secondary: [] },
    });
    await useStudio.getState().submitGeneration(hero(project.id, masterId));
    const run = useStudio.getState().run;
    expect(run?.status === "error" && run.validation?.issues.map((i) => i.code)).toContain(
      "EFFECT_MOTION_CONFLICT",
    );
    expect(sent).not.toContain("generation_submit");
  });

  it("submits an available effect and snapshots it in the shot intent", async () => {
    const { project, masterId } = await openVilla(false);
    const effects = {
      primary: { id: "reflection_control" as const, intensity: "medium" as const },
      secondary: [],
    };
    useStudio.getState().setShotIntent({ projectType: "villa", effects });
    const queued = await useStudio.getState().submitGeneration(hero(project.id, masterId));
    expect(queued?.status).toBe("queued");
    const stored = await call("generation_get", {
      projectId: project.id,
      generationId: queued!.id,
    });
    expect(stored.prompt.shotIntent).toMatchObject({ projectType: "villa", effects });
    expect(stored.prompt.positivePrompt).toContain(
      "EFFECTS:\nKeep all architecture, roads and neighboring buildings static and sharply defined.\nApply moderate polarizing-filter reflection control",
    );
    expect(JSON.stringify(db.dna[project.id])).not.toContain("reflection_control");
  });
});
