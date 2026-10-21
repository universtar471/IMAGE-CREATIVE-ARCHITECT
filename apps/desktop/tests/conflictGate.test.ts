/** Creative findings remain advisory through single, batch and retry submission. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectDNASchema, type BatchCreateRequest, type PromptBundle } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio, type GenerationInput } from "../src/app/store";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { t } from "../src/i18n";
import nhaphoDna from "./fixtures/nhapho-dna.json";
import { asset, confirmAllDna } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
/** Every bridge command sent, in order. */
let sent: string[];

const FRONT_LEFT = "CAM_01M4K1Q5C6PGJBEGD65E0JFSY0";
const SIDE_LEFT = "CAM_01M4K1QS1DEVEZ9ZMEPFT1E7X0";

beforeEach(() => {
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
afterEach(() => setTransport(null));

/** The real townhouse DNA, mid-block: both neighbours declared attached in the UI toggles. */
async function midBlockTownhouse() {
  const project = await createProject({
    name: "Mid-block townhouse",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  const dna = ProjectDNASchema.parse(nhaphoDna);
  dna.context.siteTopology = { left: "attached", right: "attached", cornerLot: false };
  dna.cameras.push({
    ...dna.cameras[0]!,
    id: SIDE_LEFT,
    name: "Left side",
    viewType: "exterior_side",
    azimuthDeg: 30,
  });
  db.dna[project.id] = dna;
  const masterId = `AST_MASTER_${project.id}`;
  db.assets[masterId] = asset(project.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: project.id, assetId: masterId });
  await confirmAllDna(project.id, { approveMaster: true });
  await useStudio.getState().openProject(project.id);
  sent = [];
  return { project, masterId };
}

const hero = (projectId: string, masterId: string, over: Partial<GenerationInput> = {}) => ({
  projectId,
  providerId: "local_preview",
  modelId: "placeholder-v1",
  purpose: "hero" as const,
  referenceAssetIds: [masterId],
  params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
  ...over,
});

describe("conflict gate — single submit (AC-22)", () => {
  it.each(["mở mặt hông bên trái", "Reveal the left side of the building"])(
    "submits %j while preserving its attached-townhouse finding",
    async (text) => {
      const { project, masterId } = await midBlockTownhouse();
      const g = await useStudio.getState().submitGeneration(
        hero(project.id, masterId, {
          extraPrompt: text,
          approvedExceptions: ["ADJACENT_BUILDING_CONFLICT"],
        }),
      );
      expect(g?.status).toBe("queued");
      expect(g?.prompt.validation).toMatchObject({
        verdict: "BLOCK",
        issueCodes: ["ADJACENT_BUILDING_CONFLICT"],
        approvedExceptions: [],
      });
      expect(sent).toContain("generation_submit");
      expect(await call("job_list", { projectId: project.id })).toHaveLength(1);
    },
  );

  it("submits unacknowledged warnings and records only explicitly accepted exceptions", async () => {
    const { project, masterId } = await midBlockTownhouse();
    const extraPrompt = "exactly 5 m wide";
    const unacknowledged = await useStudio
      .getState()
      .submitGeneration(hero(project.id, masterId, { extraPrompt }));
    expect(unacknowledged?.status).toBe("queued");
    expect(unacknowledged?.prompt.validation).toMatchObject({
      verdict: "WARN",
      issueCodes: ["UNVERIFIED_GEOMETRY"],
      approvedExceptions: [],
    });
    expect(unacknowledged?.prompt.resolvedWarnings ?? []).not.toContain("UNVERIFIED_GEOMETRY");
    const queued = await useStudio
      .getState()
      .submitGeneration(
        hero(project.id, masterId, { extraPrompt, approvedExceptions: ["UNVERIFIED_GEOMETRY"] }),
      );
    expect(queued?.status).toBe("queued");
    expect(sent.filter((c) => c === "generation_submit")).toHaveLength(2);
    const stored = await call("generation_get", {
      projectId: project.id,
      generationId: queued!.id,
    });
    expect(stored.prompt.validation).toEqual({
      verdict: "ALLOW",
      validatorVersion: "cv-1.3.0",
      issueCodes: ["UNVERIFIED_GEOMETRY"],
      approvedExceptions: ["UNVERIFIED_GEOMETRY"],
    });
    expect(stored.prompt.resolvedWarnings).toContain("UNVERIFIED_GEOMETRY");
    // Checked before it was appended, and appended unchanged after the gate passed.
    expect(stored.prompt.positivePrompt.endsWith(`\n\n${extraPrompt}`)).toBe(true);
  });

  it("stamps an ALLOW snapshot on a clean submit", async () => {
    const { project, masterId } = await midBlockTownhouse();
    const queued = await useStudio.getState().submitGeneration(hero(project.id, masterId));
    expect(queued?.prompt.validation).toEqual({
      verdict: "ALLOW",
      validatorVersion: "cv-1.3.0",
      issueCodes: [],
      approvedExceptions: [],
    });
  });

  it("a new extra prompt clears the approvals given for the old one", () => {
    useStudio.getState().setGenerateDraft({ extraPrompt: "exactly 5 m wide" });
    useStudio.getState().setGenerateDraft({ approvedExceptions: ["UNVERIFIED_GEOMETRY"] });
    useStudio.getState().setGenerateDraft({ extraPrompt: "exactly 6 m wide" });
    expect(useStudio.getState().generateDraft.approvedExceptions).toBeUndefined();
  });
});

describe("conflict gate — batch", () => {
  const prompt: PromptBundle = {
    compilerVersion: "pc-1.6.0",
    positivePrompt: "Render",
    negativePrompt: "",
    referenceInstructions: "",
    preservationInstructions: "",
    metadata: {},
  };
  const batch = (projectId: string, masterId: string, cameraIds: string[]): BatchCreateRequest => ({
    projectId,
    name: "Anchors",
    providerId: "local_preview",
    modelId: "placeholder-v1",
    purpose: "anchor",
    priority: 0,
    items: cameraIds.map((cameraId) => ({
      cameraId,
      label: cameraId === SIDE_LEFT ? "Left side" : "Front left",
      prompt,
      referenceAssetIds: [masterId],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    })),
  });

  it("sends every batch item and preserves each item assessment", async () => {
    const { project, masterId } = await midBlockTownhouse();
    const created = await useStudio
      .getState()
      .createBatch(batch(project.id, masterId, [SIDE_LEFT, FRONT_LEFT]));
    expect(created?.jobIds).toHaveLength(2);
    const jobs = await call("job_list", { projectId: project.id });
    expect(jobs.map((j) => j.cameraId)).toEqual(expect.arrayContaining([SIDE_LEFT, FRONT_LEFT]));
    const g = await call("generation_get", {
      projectId: project.id,
      generationId: jobs[0]!.generationId,
    });
    expect(g.prompt.validation).toBeTruthy();
    expect(useStudio.getState().toasts.map((x) => x.message)).not.toContain(
      t("conflictUi.batchSkipped", { list: "Left side" }),
    );
  });

  it("sends a batch even when every item has creative findings", async () => {
    const { project, masterId } = await midBlockTownhouse();
    expect(
      await useStudio.getState().createBatch(batch(project.id, masterId, [SIDE_LEFT])),
    ).toBeTruthy();
    expect(sent).toContain("batch_create");
    expect(useStudio.getState().toasts.map((x) => x.message)).not.toContain(
      t("conflictUi.batchAllBlocked"),
    );
  });

  it("the mock backend accepts a finding snapshot like Rust does", async () => {
    const { project, masterId } = await midBlockTownhouse();
    await expect(
      call("generation_submit", {
        ...hero(project.id, masterId),
        cameraId: null,
        prompt: {
          ...prompt,
          validation: {
            verdict: "BLOCK",
            validatorVersion: "cv-1.3.0",
            issueCodes: ["ADJACENT_BUILDING_CONFLICT"],
            approvedExceptions: [],
          },
        },
      }),
    ).resolves.toMatchObject({ status: "queued", prompt: { validation: { verdict: "BLOCK" } } });
    expect(await call("job_list", { projectId: project.id })).toHaveLength(1);
  });
});
