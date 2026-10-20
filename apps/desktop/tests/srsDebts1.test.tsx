/**
 * SRS debts 1 (ADR-034, ADR-036 follow-ups):
 * - a retry re-validates the stored snapshot against the CURRENT DNA (BLOCK refused, new WARN
 *   asks again, accepted WARN carries over);
 * - ContactSheet re-run, mood variations and enhance batch offer "Duyệt ngoại lệ";
 * - `resolvedWarnings` holds only accepted codes;
 * - planned detail batches carry one ShotIntent (own `targetDetailId`) per item;
 * - the per-project ShotIntent survives a restart, and corrupt stored data is ignored.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ProjectDNASchema,
  type ConflictCode,
  type ProjectDNA,
  type ShotIntent,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio, type GenerationInput } from "../src/app/store";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import {
  SHOT_INTENT_STORAGE_PREFIX,
  loadShotIntent,
  saveShotIntent,
} from "../src/lib/shotIntentStorage";
import { planBatch } from "../src/features/camera/batch";
import { ContactSheet } from "../src/features/camera/ContactSheet";
import { MoodGradePanel } from "../src/features/mood/MoodGradePanel";
import { EnhanceBatchDialog } from "../src/features/enhance/EnhanceBatchDialog";
import { RetryConflictDialog } from "../src/features/validation/RetryConflictDialog";
import { checkShot, withValidation } from "../src/features/validation/gate";
import { DEFAULT_ENHANCE_PARAMS } from "../src/features/enhance/enhance";
import { t } from "../src/i18n";
import nhaphoDna from "./fixtures/nhapho-dna.json";
import { asset, confirmAllDna } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let sent: { command: string; request: unknown }[];

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  sent = [];
  // A slow mock queue: a submitted job stays queued long enough to be cancelled.
  const base = createMockTransport(db, { generationDelayMs: 400 });
  const spy: Transport = async (command, args) => {
    sent.push({ command, request: args.request });
    return base(command, args);
  };
  spy.connectEvents = base.connectEvents;
  setTransport(spy);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    toasts: [],
    providers: null,
    retryConflicts: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

const commands = () => sent.map((s) => s.command);

/** A townhouse space catalog whose active space raises SPACE_NOT_IN_BUILDING. */
function withSpace(dna: ProjectDNA, presetId: string): ProjectDNA {
  return {
    ...dna,
    spaceCatalog: {
      version: 1,
      buildingArchetype: "townhouse",
      spaces: [{ id: "SPC_1", presetId, facts: {}, lockedElementIds: [], approvedOptionalIds: [] }],
      activeSpaceId: "SPC_1",
    },
  };
}
/** Unknown preset id: WARN. */
const warnDna = (dna: ProjectDNA) => withSpace(dna, "preset.from.another.catalog");
/** A villa-only preset in a townhouse: BLOCK. */
const blockDna = (dna: ProjectDNA) => withSpace(dna, "villa.living.sanh_chinh");

async function openTownhouse(dna: ProjectDNA = ProjectDNASchema.parse(nhaphoDna)) {
  const project = await createProject({
    name: "Debts 1",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  db.dna[project.id] = dna;
  const masterId = `AST_MASTER_${project.id}`;
  db.assets[masterId] = asset(project.id, masterId, { role: "master_architecture" });
  const otherId = `AST_B_${project.id}`;
  db.assets[otherId] = asset(project.id, otherId, { originalName: "other.png" });
  await call("asset_set_master", { projectId: project.id, assetId: masterId });
  await confirmAllDna(project.id, { approveMaster: true });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  sent = [];
  return { projectId: project.id, masterId, otherId };
}

/** Save new DNA for the open project and reload it, as an edit elsewhere would. */
async function replaceDna(projectId: string, dna: ProjectDNA) {
  await call("dna_update", { projectId, dna });
  await useStudio.getState().openProject(projectId);
  sent = [];
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

/** Submit through the store gate, then cancel the job so it can be retried. */
async function cancelledJob(input: ReturnType<typeof hero>) {
  const g = await useStudio.getState().submitGeneration(input);
  expect(g).toBeDefined();
  const job = (await call("job_list", { projectId: input.projectId })).find(
    (j) => j.generationId === g!.id,
  )!;
  await call("job_cancel", { jobId: job.id });
  await useStudio.getState().refreshJobs();
  sent = [];
  return job;
}

describe("retry re-validates against the current DNA", () => {
  it("refuses a snapshot that is now BLOCK, without calling job_retry", async () => {
    const { projectId, masterId } = await openTownhouse();
    const job = await cancelledJob(hero(projectId, masterId));
    await replaceDna(projectId, blockDna(ProjectDNASchema.parse(nhaphoDna)));

    expect(await useStudio.getState().retryJob(job.id)).toBeUndefined();
    expect(commands()).not.toContain("job_retry");
    const [conflict] = useStudio.getState().retryConflicts;
    expect(conflict).toMatchObject({ jobId: job.id, validation: { verdict: "BLOCK" } });
    expect(conflict!.validation.issues[0]).toMatchObject({ code: "SPACE_NOT_IN_BUILDING" });
    expect(useStudio.getState().toasts.map((x) => x.message)).toContain(
      t("conflictUi.refusedBlock"),
    );
  });

  it("asks again for a new WARN, then resends with the accepted code", async () => {
    const { projectId, masterId } = await openTownhouse();
    const job = await cancelledJob(hero(projectId, masterId));
    await replaceDna(projectId, warnDna(ProjectDNASchema.parse(nhaphoDna)));

    expect(await useStudio.getState().retryJob(job.id)).toBeUndefined();
    expect(commands()).not.toContain("job_retry");
    expect(useStudio.getState().retryConflicts[0]?.validation.verdict).toBe("WARN");

    // The retry dialog offers "Duyệt ngoại lệ"; approving resends the job.
    render(<RetryConflictDialog />);
    expect(screen.getByTestId("retry-conflict-dialog").textContent).toContain(
      t("conflicts.SPACE_NOT_IN_BUILDING"),
    );
    fireEvent.click(screen.getByTestId("conflict-approve"));
    await waitFor(() => expect(commands()).toContain("job_retry"));
    await waitFor(() => expect(useStudio.getState().retryConflicts).toEqual([]));
    const retried = sent.find((s) => s.command === "job_retry")!.request as {
      validation: { verdict: string; approvedExceptions: string[] };
    };
    expect(retried.validation).toMatchObject({
      verdict: "ALLOW",
      approvedExceptions: ["SPACE_NOT_IN_BUILDING"],
    });
    const copy = useStudio.getState().jobs.find((j) => j.id !== job.id && j.label === job.label)!;
    const g = await call("generation_get", { projectId, generationId: copy.generationId });
    expect(g.prompt.validation?.approvedExceptions).toEqual(["SPACE_NOT_IN_BUILDING"]);
    expect(g.prompt.resolvedWarnings).toEqual(["SPACE_NOT_IN_BUILDING"]);
  });

  it("keeps a WARN that was accepted for the original submit", async () => {
    const { projectId, masterId } = await openTownhouse(warnDna(ProjectDNASchema.parse(nhaphoDna)));
    const job = await cancelledJob(
      hero(projectId, masterId, { approvedExceptions: ["SPACE_NOT_IN_BUILDING"] }),
    );
    expect(await useStudio.getState().retryJob(job.id)).toBeDefined();
    expect(commands()).toContain("job_retry");
    expect(useStudio.getState().retryConflicts).toEqual([]);
  });

  it("the mock backend, like Rust, refuses a BLOCK verdict sent with job_retry", async () => {
    const { projectId, masterId } = await openTownhouse();
    const job = await cancelledJob(hero(projectId, masterId));
    await expect(
      call("job_retry", {
        jobId: job.id,
        validation: {
          verdict: "BLOCK",
          validatorVersion: "cv-1.3.0",
          issueCodes: ["SPACE_NOT_IN_BUILDING"],
          approvedExceptions: [],
        },
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("exception panel on the batch surfaces", () => {
  it("ContactSheet re-run: WARN shows the panel, nothing is sent until it is approved", async () => {
    const { projectId } = await openTownhouse();
    const ws = useStudio.getState().workspace!;
    const anchorCam = ws.persistedDna.cameras.find((c) => c.isAnchorView)!;
    const providers = useStudio.getState().providers!;
    const plan = planBatch(
      {
        mode: "anchor",
        providerId: "local_preview",
        modelId: "placeholder-v1",
        params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
        cameraIds: [anchorCam.id],
        cameraSelectionExplicit: true,
        extraReferenceIds: [],
      },
      { project: ws.project, dna: ws.persistedDna, assets: ws.assets },
      [],
      providers,
    );
    expect(await useStudio.getState().createBatch(plan.request!)).toBeDefined();
    await replaceDna(projectId, warnDna(ProjectDNASchema.parse(nhaphoDna)));

    render(<ContactSheet />);
    const rerun = await screen.findByTestId("contact-rerun");
    fireEvent.click(rerun);
    const panel = await screen.findByTestId("conflict-panel");
    expect(panel.textContent).toContain(t("conflicts.SPACE_NOT_IN_BUILDING"));
    expect(commands()).not.toContain("batch_create");

    fireEvent.click(screen.getByTestId("conflict-approve"));
    fireEvent.click(rerun);
    await waitFor(() => expect(commands()).toContain("batch_create"));
    const created = sent.find((s) => s.command === "batch_create")!.request as {
      items: { prompt: { validation: { approvedExceptions: ConflictCode[] } } }[];
    };
    expect(created.items[0]!.prompt.validation.approvedExceptions).toEqual([
      "SPACE_NOT_IN_BUILDING",
    ]);
  });

  it("Mood variations: WARN disables queueing until 'Approve exception'", async () => {
    await openTownhouse(warnDna(ProjectDNASchema.parse(nhaphoDna)));
    render(<MoodGradePanel />);
    fireEvent.click(screen.getByText(t("moodGrade.variations")));
    const submit = (await screen.findByTestId("mood-variations-submit")) as HTMLButtonElement;
    expect(screen.getByTestId("conflict-panel").textContent).toContain(
      t("conflicts.SPACE_NOT_IN_BUILDING"),
    );
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("conflict-approve"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(commands()).toContain("batch_create"));
    const created = sent.find((s) => s.command === "batch_create")!.request as {
      items: { prompt: { validation: { verdict: string }; resolvedWarnings?: string[] } }[];
    };
    expect(created.items.length).toBeGreaterThanOrEqual(2);
    for (const item of created.items) {
      expect(item.prompt.validation.verdict).toBe("ALLOW");
      expect(item.prompt.resolvedWarnings).toEqual(["SPACE_NOT_IN_BUILDING"]);
    }
  });

  it("Enhance batch (generative): WARN disables the submit until 'Approve exception'", async () => {
    const { masterId, otherId } = await openTownhouse(warnDna(ProjectDNASchema.parse(nhaphoDna)));
    render(
      <EnhanceBatchDialog
        sources={useStudio.getState().workspace!.assets}
        initialSelectedIds={[masterId, otherId]}
        initialParams={{ ...DEFAULT_ENHANCE_PARAMS, mode: "generative" }}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("enhance-mode-balanced"));
    const submit = screen.getByTestId("enhance-batch-submit") as HTMLButtonElement;
    await waitFor(() =>
      expect(screen.getByTestId("conflict-panel").textContent).toContain(
        t("conflicts.SPACE_NOT_IN_BUILDING"),
      ),
    );
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("conflict-approve"));
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(screen.getByTestId("conflict-panel").textContent).toContain(t("conflictUi.accepted"));
  });
});

describe("resolvedWarnings holds only accepted codes", () => {
  it("is empty after compile, and the gate sets exactly the accepted codes", async () => {
    const { projectId, masterId } = await openTownhouse(warnDna(ProjectDNASchema.parse(nhaphoDna)));
    const g = await useStudio
      .getState()
      .submitGeneration(
        hero(projectId, masterId, { approvedExceptions: ["SPACE_NOT_IN_BUILDING"] }),
      );
    expect(g?.prompt.resolvedWarnings).toEqual(["SPACE_NOT_IN_BUILDING"]);
    expect(g?.prompt.validation?.issueCodes).toEqual(["SPACE_NOT_IN_BUILDING"]);

    // Found but not accepted: never listed as resolved; a resend replaces an older list.
    const ws = useStudio.getState().workspace!;
    const found = checkShot({ dna: ws.persistedDna, projectType: "townhouse" });
    expect(found.verdict).toBe("WARN");
    const bundle = withValidation({ ...g!.prompt, resolvedWarnings: ["OCCLUDED_TARGET"] }, found);
    expect(bundle.resolvedWarnings).toEqual([]);
    expect(bundle.validation?.issueCodes).toEqual(["SPACE_NOT_IN_BUILDING"]);
  });
});

describe("planned detail batches", () => {
  it("give every item its own targetDetailId, and the gate checks each with its intent", async () => {
    const dna = ProjectDNASchema.parse(nhaphoDna);
    dna.architecturalDetails = [
      { version: 1, id: "DTL_A", spaceId: "SPC_detail", materialIds: [], locked: false },
      { version: 1, id: "DTL_B", spaceId: "SPC_detail", materialIds: [], locked: false },
    ];
    await openTownhouse(dna);
    const ws = useStudio.getState().workspace!;
    const camera = ws.persistedDna.cameras[0]!.id;
    const plan = planBatch(
      {
        mode: "production",
        providerId: "local_preview",
        modelId: "placeholder-v1",
        params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
        cameraIds: [],
        extraReferenceIds: [],
        detailShots: [
          { detailId: "DTL_A", cameraId: camera, label: "A" },
          { detailId: "DTL_B", cameraId: camera, label: "B" },
          { detailId: "DTL_GONE", cameraId: camera, label: "Gone" },
        ],
      },
      { project: ws.project, dna: ws.persistedDna, assets: ws.assets },
      [],
      useStudio.getState().providers!,
    );
    expect(plan.items.map((i) => [i.label, i.cameraId])).toEqual([
      ["A", camera],
      ["B", camera],
      ["Gone", camera],
    ]);
    expect(plan.items.map((i) => i.prompt.shotIntent?.targetDetailId)).toEqual([
      "DTL_A",
      "DTL_B",
      "DTL_GONE",
    ]);
    expect(plan.items.every((i) => i.prompt.shotIntent?.detailShotCount === 3)).toBe(true);

    sent = [];
    // Sent as anchors only because this fixture has no approved anchors (workflow rule).
    const created = await useStudio.getState().createBatch({ ...plan.request!, purpose: "anchor" });
    // Only the item whose own target no longer exists is blocked (OCCLUDED_TARGET).
    expect(created?.jobIds).toHaveLength(2);
    expect(useStudio.getState().toasts.map((x) => x.message)).toContain(
      t("conflictUi.batchSkipped", { list: "Gone" }),
    );
    const request = sent.find((s) => s.command === "batch_create")!.request as {
      items: { prompt: { shotIntent?: ShotIntent } }[];
    };
    expect(request.items.map((i) => i.prompt.shotIntent?.targetDetailId)).toEqual([
      "DTL_A",
      "DTL_B",
    ]);
  });
});

describe("ShotIntent persistence", () => {
  it("survives a store re-init and is never written into the DNA", async () => {
    const { projectId } = await openTownhouse();
    const chosen = { projectType: "townhouse" as const, cameraId: null, targetSpaceId: "SPC_9" };
    useStudio.getState().setShotIntent(chosen);
    await useStudio.getState().flushDna();
    expect(JSON.stringify(db.dna[projectId])).not.toContain("SPC_9");

    // A restart: the store module is loaded again with an empty session cache.
    vi.resetModules();
    const fresh = await import("../src/app/store");
    const bridge = await import("../src/lib/bridge");
    bridge.setTransport(createMockTransport(db));
    await fresh.useStudio.getState().openProject(projectId);
    expect(fresh.useStudio.getState().workspace?.shotIntent).toEqual(chosen);
    bridge.setTransport(null);
  });

  it("ignores and removes corrupt or invalid stored data", () => {
    const key = (id: string) => `${SHOT_INTENT_STORAGE_PREFIX}${id}`;
    localStorage.setItem(key("PRJ_bad_json"), "{not json");
    expect(loadShotIntent("PRJ_bad_json")).toBeUndefined();
    expect(localStorage.getItem(key("PRJ_bad_json"))).toBeNull();

    localStorage.setItem(key("PRJ_bad_shape"), JSON.stringify({ projectType: "spaceship" }));
    expect(loadShotIntent("PRJ_bad_shape")).toBeUndefined();
    expect(localStorage.getItem(key("PRJ_bad_shape"))).toBeNull();

    saveShotIntent("PRJ_ok", { projectType: "townhouse", cameraId: null, detailShotCount: 2 });
    expect(loadShotIntent("PRJ_ok")).toEqual({
      projectType: "townhouse",
      cameraId: null,
      detailShotCount: 2,
    });
  });
});
