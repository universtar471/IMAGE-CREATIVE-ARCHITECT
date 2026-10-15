/**
 * ADR-034 P0-B: the conflict gate runs before every paid submit, at the store level.
 * - AC-22: an extra prompt asking to open the side of an attached townhouse is BLOCKED and
 *   nothing reaches the bridge (`generation_submit` is never called).
 * - WARN: refused until the exception is accepted; then the snapshot records it.
 * - Batch: items that are not ALLOW are skipped and reported, never sent.
 */
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
    "blocks %j on an attached townhouse before any bridge submit",
    async (text) => {
      const { project, masterId } = await midBlockTownhouse();
      const g = await useStudio.getState().submitGeneration(
        hero(project.id, masterId, {
          extraPrompt: text,
          approvedExceptions: ["ADJACENT_BUILDING_CONFLICT"],
        }),
      );
      expect(g).toBeUndefined();
      const run = useStudio.getState().run;
      expect(run).toMatchObject({ status: "error", code: "VALIDATION_ERROR" });
      expect(run?.status === "error" && run.validation?.verdict).toBe("BLOCK");
      expect(run?.status === "error" && run.validation?.issues[0]).toMatchObject({
        code: "ADJACENT_BUILDING_CONFLICT",
        path: "extraPrompt",
        exceptionAllowed: false,
      });
      expect(sent).not.toContain("generation_submit");
      expect(await call("job_list", { projectId: project.id })).toEqual([]);
    },
  );

  it("refuses an unaccepted WARN, then submits once the exception is approved", async () => {
    const { project, masterId } = await midBlockTownhouse();
    const extraPrompt = "exactly 5 m wide";
    expect(
      await useStudio.getState().submitGeneration(hero(project.id, masterId, { extraPrompt })),
    ).toBeUndefined();
    const refused = useStudio.getState().run;
    expect(refused?.status === "error" && refused.validation?.verdict).toBe("WARN");
    expect(refused?.status === "error" && refused.message).toBe(t("conflictUi.refusedWarn"));
    expect(sent).not.toContain("generation_submit");

    const queued = await useStudio
      .getState()
      .submitGeneration(
        hero(project.id, masterId, { extraPrompt, approvedExceptions: ["UNVERIFIED_GEOMETRY"] }),
      );
    expect(queued?.status).toBe("queued");
    expect(sent.filter((c) => c === "generation_submit")).toHaveLength(1);
    const stored = await call("generation_get", {
      projectId: project.id,
      generationId: queued!.id,
    });
    expect(stored.prompt.validation).toEqual({
      verdict: "ALLOW",
      validatorVersion: "cv-1.0.0",
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
      validatorVersion: "cv-1.0.0",
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

  it("skips BLOCK items, reports them and sends only the rest", async () => {
    const { project, masterId } = await midBlockTownhouse();
    const created = await useStudio
      .getState()
      .createBatch(batch(project.id, masterId, [SIDE_LEFT, FRONT_LEFT]));
    expect(created?.jobIds).toHaveLength(1);
    const jobs = await call("job_list", { projectId: project.id });
    expect(jobs.map((j) => j.cameraId)).toEqual([FRONT_LEFT]);
    const g = await call("generation_get", {
      projectId: project.id,
      generationId: jobs[0]!.generationId,
    });
    expect(g.prompt.validation?.verdict).toBe("ALLOW");
    expect(useStudio.getState().toasts.map((x) => x.message)).toContain(
      t("conflictUi.batchSkipped", { list: "Left side" }),
    );
  });

  it("sends nothing when every item is blocked", async () => {
    const { project, masterId } = await midBlockTownhouse();
    expect(
      await useStudio.getState().createBatch(batch(project.id, masterId, [SIDE_LEFT])),
    ).toBeUndefined();
    expect(sent).not.toContain("batch_create");
    expect(useStudio.getState().toasts.map((x) => x.message)).toContain(
      t("conflictUi.batchAllBlocked"),
    );
  });

  it("the mock backend refuses a BLOCK snapshot like Rust does", async () => {
    const { project, masterId } = await midBlockTownhouse();
    await expect(
      call("generation_submit", {
        ...hero(project.id, masterId),
        cameraId: null,
        prompt: {
          ...prompt,
          validation: {
            verdict: "BLOCK",
            validatorVersion: "cv-1.0.0",
            issueCodes: ["ADJACENT_BUILDING_CONFLICT"],
            approvedExceptions: [],
          },
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await call("job_list", { projectId: project.id })).toEqual([]);
  });
});
