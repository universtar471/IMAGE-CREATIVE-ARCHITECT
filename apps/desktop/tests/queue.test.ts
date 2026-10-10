/** Phase 3 job queue: the mock's queue rules, events and the store's handling of them. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  GENERATION_UPDATED_EVENT,
  JOB_UPDATED_EVENT,
  type GenerationDTO,
  type GenerationSubmitRequest,
  type JobDTO,
} from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, startBackendSync, useStudio } from "../src/app/store";
import { jobElapsedMs, visibleJobs } from "../src/features/jobs/JobsTab";
import { call, eventsReady, setTransport, subscribe, type Transport } from "../src/lib/bridge";
import { createMockTransport, MOCK_PROVIDER_SLOTS } from "../src/lib/mockBackend";
import { asset, confirmAllDna, deferredTransport, settled, sleep, waitFor } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let stopSync: (() => void) | null = null;

function useMock(delayMs: number, retryDelaysMs: [number, number] = [10, 20]) {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db, { generationDelayMs: delayMs, retryDelaysMs }));
}

beforeEach(() => {
  useMock(30);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  stopSync?.();
  stopSync = null;
  setTransport(null);
});

const request = (projectId: string, over: Partial<GenerationSubmitRequest> = {}) =>
  ({
    projectId,
    providerId: "local_preview",
    modelId: "placeholder-v1",
    purpose: "variation",
    prompt: {
      compilerVersion: COMPILER_VERSION,
      positivePrompt: "A villa",
      negativePrompt: "",
      referenceInstructions: "",
      preservationInstructions: "",
      metadata: {},
    },
    referenceAssetIds: [],
    params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    cameraId: null,
    ...over,
  }) satisfies GenerationSubmitRequest;

const geminiRequest = (projectId: string, prompt = "A villa") =>
  request(projectId, {
    providerId: "gemini",
    modelId: "gemini-nano-banana-2.1",
    params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    prompt: { ...request(projectId).prompt, positivePrompt: prompt },
  });

async function newProject() {
  const p = await createProject({
    name: "Queue test",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  const masterId = `AST_M_${p.id}`;
  db.assets[masterId] = asset(p.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: p.id, assetId: masterId });
  await confirmAllDna(p.id, { approveMaster: true });
  // Keep the approved-master fact for variation gates without adding a fixture image
  // to assertions that count generated outputs.
  delete db.assets[masterId];
  return p;
}

/** Records every event in order. */
async function recordEvents() {
  const jobs: JobDTO[] = [];
  const gens: GenerationDTO[] = [];
  const off1 = subscribe(JOB_UPDATED_EVENT, (j) => jobs.push(j));
  const off2 = subscribe(GENERATION_UPDATED_EVENT, (g) => gens.push(g));
  await eventsReady();
  return {
    jobs,
    gens,
    stop: () => {
      off1();
      off2();
    },
  };
}

const jobOf = async (generationId: string) =>
  (await call("job_list", { projectId: null })).find((j) => j.generationId === generationId)!;

describe("mock queue", () => {
  it("cancelling a job that already ended refreshes the tray instead of erroring", async () => {
    const p = await newProject();
    await useStudio.getState().openProject(p.id);
    const g = await call("generation_submit", request(p.id));
    let job = await jobOf(g.id);
    for (let i = 0; i < 100 && job.status !== "completed"; i++) {
      await sleep(10);
      job = await jobOf(g.id);
    }
    expect(job.status).toBe("completed");
    // The UI missed the events and still shows the job as running.
    useStudio.setState({ jobs: [{ ...job, status: "running", finishedAt: null }], toasts: [] });

    await useStudio.getState().cancelJob(job.id);

    const s = useStudio.getState();
    expect(s.jobs.find((j) => j.id === job.id)?.status).toBe("completed");
    expect(s.toasts.map((x) => x.kind)).toEqual(["info"]);
  });

  it("emits queued → running → completed for a job and its generation", async () => {
    const p = await newProject();
    const rec = await recordEvents();
    const g = await call("generation_submit", request(p.id));
    expect(g).toMatchObject({ status: "queued", startedAt: null, batchId: null });
    await settled(p.id, g.id);
    rec.stop();
    expect(rec.jobs.map((j) => j.status)).toEqual(["queued", "running", "completed"]);
    expect(rec.gens.map((x) => x.status)).toEqual(["queued", "running", "completed"]);
    expect(rec.jobs.at(-1)).toMatchObject({ attempt: 1, maxAttempts: 3, generationId: g.id });
    expect(rec.gens.at(-1)!.outputAssetIds).toHaveLength(1);
  });

  it("runs local jobs two at a time and remote jobs one at a time, in parallel", async () => {
    expect(MOCK_PROVIDER_SLOTS).toEqual({ local: 2, remote: 1 });
    const p = await newProject();
    await call("provider_set_api_key", { providerId: "gemini", apiKey: "test-key" });
    let maxLocal = 0;
    let maxRemote = 0;
    let both = false;
    const running = new Map<string, string>();
    const off = subscribe(JOB_UPDATED_EVENT, (j) => {
      if (j.status === "running") running.set(j.id, j.providerId);
      else running.delete(j.id);
      const local = [...running.values()].filter((x) => x === "local_preview").length;
      const remote = [...running.values()].filter((x) => x === "gemini").length;
      maxLocal = Math.max(maxLocal, local);
      maxRemote = Math.max(maxRemote, remote);
      if (local > 0 && remote > 0) both = true;
    });
    await eventsReady();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await call("generation_submit", request(p.id))).id);
    for (let i = 0; i < 2; i++) ids.push((await call("generation_submit", geminiRequest(p.id))).id);
    for (const id of ids) await settled(p.id, id);
    off();
    expect(maxLocal).toBe(2);
    expect(maxRemote).toBe(1);
    expect(both).toBe(true);
  });

  it("retries a [flaky] job after rate_limited, then succeeds", async () => {
    const p = await newProject();
    const rec = await recordEvents();
    const g = await call(
      "generation_submit",
      request(p.id, { prompt: { ...request(p.id).prompt, positivePrompt: "x [flaky] y" } }),
    );
    const done = await settled(p.id, g.id);
    rec.stop();
    expect(done.status).toBe("completed");
    expect(rec.jobs.map((j) => j.status)).toEqual([
      "queued",
      "running",
      "retrying",
      "running",
      "completed",
    ]);
    const retrying = rec.jobs.find((j) => j.status === "retrying")!;
    expect(retrying.error).toMatchObject({ kind: "rate_limited" });
    expect(retrying.nextAttemptAt).not.toBeNull();
    expect((await jobOf(g.id)).attempt).toBe(2);
  });

  it("fails a non-retryable error at once", async () => {
    const p = await newProject();
    const g = await call(
      "generation_submit",
      request(p.id, { prompt: { ...request(p.id).prompt, positivePrompt: "[fail]" } }),
    );
    expect((await settled(p.id, g.id)).status).toBe("failed");
    expect(await jobOf(g.id)).toMatchObject({ status: "failed", attempt: 1 });
  });

  it("cancels a queued job at once and discards a running job's result", async () => {
    useMock(40);
    const p = await newProject();
    await call("provider_set_api_key", { providerId: "gemini", apiKey: "k" });
    const first = await call("generation_submit", geminiRequest(p.id));
    const second = await call("generation_submit", geminiRequest(p.id));
    await sleep(5);
    const runningJob = await jobOf(first.id);
    const queuedJob = await jobOf(second.id);
    expect(runningJob.status).toBe("running");
    expect(queuedJob.status).toBe("queued");

    expect((await call("job_cancel", { jobId: queuedJob.id })).status).toBe("cancelled");
    expect((await call("job_cancel", { jobId: runningJob.id })).status).toBe("cancelled");
    await sleep(80);
    const g1 = await call("generation_get", { projectId: p.id, generationId: first.id });
    expect(g1).toMatchObject({ status: "cancelled", outputAssetIds: [] });
    expect((await call("asset_list", { projectId: p.id })).length).toBe(0);
    await expect(call("job_cancel", { jobId: runningJob.id })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("job_retry copies the request into a new generation and job", async () => {
    const p = await newProject();
    const g = await call("generation_submit", request(p.id));
    const job = await jobOf(g.id);
    await call("job_cancel", { jobId: job.id });
    const copy = await call("job_retry", { jobId: job.id });
    expect(copy.id).not.toBe(job.id);
    expect(copy.generationId).not.toBe(g.id);
    expect((await settled(p.id, copy.generationId)).status).toBe("completed");
    await expect(call("job_retry", { jobId: copy.id })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("job_list returns active jobs and recent history for one or all projects", async () => {
    const a = await newProject();
    const b = await newProject();
    const ga = await call("generation_submit", request(a.id));
    await call("generation_submit", request(b.id));
    expect((await call("job_list", { projectId: a.id })).map((j) => j.generationId)).toEqual([
      ga.id,
    ]);
    expect(await call("job_list", { projectId: null })).toHaveLength(2);
  });

  it("batch_create is all-or-nothing and keeps item order", async () => {
    const p = await newProject();
    const item = (label: string, over: object = {}) => ({
      cameraId: null,
      label,
      prompt: request(p.id).prompt,
      referenceAssetIds: [],
      params: request(p.id).params,
      ...over,
    });
    const bad = call("batch_create", {
      projectId: p.id,
      name: "B",
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "production",
      priority: 0,
      items: [item("one"), item("two", { referenceAssetIds: ["AST_nope"] })],
    });
    await expect(bad).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await call("job_list", { projectId: p.id })).toEqual([]);

    const batch = await call("batch_create", {
      projectId: p.id,
      name: "B",
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "production",
      priority: 0,
      items: [item("one"), item("two"), item("three")],
    });
    expect(batch.counts.queued).toBe(3);
    const jobs = await call("job_list", { projectId: p.id });
    expect(batch.jobIds.map((id) => jobs.find((j) => j.id === id)!.label)).toEqual([
      "one",
      "two",
      "three",
    ]);
    for (const j of jobs) await settled(p.id, j.generationId);
    expect((await call("batch_list", { projectId: p.id }))[0]!.counts.completed).toBe(3);
  });

  it("after a reload running jobs are interrupted and queued ones resume", async () => {
    const p = await newProject();
    await call("generation_submit", request(p.id));
    // Snapshot as if the app closed now: put it in localStorage and load a fresh mock.
    const snapshot = structuredClone(db);
    snapshot.jobs![0]!.status = "running";
    snapshot.generations![0]!.status = "running";
    snapshot.jobs!.push({ ...snapshot.jobs![0]!, id: "JOB_QUEUED", status: "queued", seq: 99 });
    snapshot.generations!.push({
      ...snapshot.generations![0]!,
      id: "GEN_QUEUED",
      jobId: "JOB_QUEUED",
      status: "queued",
    });
    snapshot.jobs!.at(-1)!.generationId = "GEN_QUEUED";
    localStorage.setItem("arch-studio-mock-db-v1", JSON.stringify(snapshot));
    setTransport(createMockTransport(undefined, { generationDelayMs: 5 }));
    const list = await call("job_list", { projectId: p.id });
    expect(list.find((j) => j.id !== "JOB_QUEUED")!.status).toBe("interrupted");
    expect((await settled(p.id, "GEN_QUEUED")).status).toBe("completed");
    localStorage.removeItem("arch-studio-mock-db-v1");
  });
});

describe("store with backend events", () => {
  async function openWithMaster() {
    const p = await newProject();
    db.assets["AST_M"] = asset(p.id, "AST_M", { role: "master_architecture" });
    db.projects[p.id]!.activeMasterAssetId = "AST_M";
    await useStudio.getState().openProject(p.id);
    return p;
  }

  it("a queued job → running → completed updates jobs, history and assets", async () => {
    stopSync = startBackendSync();
    await eventsReady();
    const p = await openWithMaster();
    const seen: string[] = [];
    const unsub = useStudio.subscribe((s) => {
      const st = s.workspace?.generations[0]?.status;
      if (st && seen.at(-1) !== st) seen.push(st);
    });
    const g = await useStudio.getState().submitGeneration({
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "hero",
      referenceAssetIds: ["AST_M"],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 2, seed: null, quality: null },
    });
    await waitFor(
      () => useStudio.getState().workspace!.assets.length === 3,
      "two outputs in the workspace",
    );
    unsub();
    expect(seen).toEqual(["queued", "running", "completed"]);
    const s = useStudio.getState();
    expect(s.jobs.find((j) => j.generationId === g!.id)?.status).toBe("completed");
    expect(s.workspace!.generations[0]!.outputAssetIds).toHaveLength(2);
  });

  it("cancel and retry through the store", async () => {
    useMock(40);
    stopSync = startBackendSync();
    await eventsReady();
    const p = await openWithMaster();
    const input = {
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation" as const,
      referenceAssetIds: [],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    };
    const g = (await useStudio.getState().submitGeneration(input))!;
    await useStudio.getState().cancelJob(g.jobId!);
    await waitFor(
      () => useStudio.getState().workspace!.generations[0]?.status === "cancelled",
      "cancelled generation in history",
    );
    expect(useStudio.getState().jobs.find((j) => j.id === g.jobId)?.status).toBe("cancelled");

    const cancelled = useStudio.getState().workspace!.generations[0]!;
    const retried = await useStudio.getState().retryGeneration(cancelled);
    expect(retried?.id).not.toBe(g.id);
    expect(useStudio.getState().run).toMatchObject({ status: "tracking" });
    await waitFor(
      () =>
        useStudio.getState().workspace!.generations.find((x) => x.id === retried!.id)?.status ===
        "completed",
      "retried generation to complete",
    );
  });

  it("job_list refresh resyncs the project when events were missed", async () => {
    // No startBackendSync: only refreshJobs sees progress.
    const p = await openWithMaster();
    const g = (await useStudio.getState().submitGeneration({
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation",
      referenceAssetIds: [],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    }))!;
    await useStudio.getState().refreshJobs();
    await settled(p.id, g.id);
    await useStudio.getState().refreshJobs();
    const s = useStudio.getState();
    expect(s.workspace!.generations[0]).toMatchObject({ id: g.id, status: "completed" });
    expect(s.workspace!.assets.some((a) => a.source === "ai_generated")).toBe(true);
  });
});

describe("stale polls never overwrite newer state", () => {
  function useDeferredMock(delayMs: number) {
    db = { projects: {}, dna: {}, assets: {}, versions: [] };
    const d = deferredTransport(createMockTransport(db, { generationDelayMs: delayMs }));
    setTransport(d.transport);
    return d;
  }

  async function openAndSubmit() {
    const p = await newProject();
    await useStudio.getState().openProject(p.id);
    const g = (await useStudio.getState().submitGeneration({
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation",
      referenceAssetIds: [],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    }))!;
    return { p, g };
  }

  const storeJob = (generationId: string) =>
    useStudio.getState().jobs.find((j) => j.generationId === generationId);
  const storeGen = (id: string) =>
    useStudio.getState().workspace!.generations.find((x) => x.id === id);

  it("a poll answered after the completed event keeps the completed status", async () => {
    const d = useDeferredMock(40);
    stopSync = startBackendSync();
    await eventsReady();
    const { g } = await openAndSubmit();
    await waitFor(
      () => storeJob(g.id)?.status === "running" && storeGen(g.id)?.status === "running",
      "running job and generation",
    );
    // Both polls read the backend now (running) but answer only when released.
    d.hold("job_list");
    d.hold("generation_list");
    const polls = [useStudio.getState().refreshJobs(), useStudio.getState().refreshGenerations()];
    await waitFor(() => d.pending("job_list") === 1 && d.pending("generation_list") === 1);
    await waitFor(
      () => storeJob(g.id)?.status === "completed" && storeGen(g.id)?.status === "completed",
      "completed through events",
    );
    d.release("job_list");
    d.release("generation_list");
    await Promise.all(polls);
    expect(storeJob(g.id)?.status).toBe("completed");
    expect(storeGen(g.id)?.status).toBe("completed");
    expect(storeGen(g.id)?.outputAssetIds).toHaveLength(1);
  });

  it("a poll sent before submit or retry does not drop the returned generation", async () => {
    // No events: the command results are the only news.
    const d = useDeferredMock(30);
    const p = await newProject();
    await useStudio.getState().openProject(p.id);
    const input = {
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation" as const,
      referenceAssetIds: [],
      params: { aspectRatio: "16:9", imageSize: "1K", outputCount: 1, seed: null, quality: null },
    };
    const failing = { ...request(p.id).prompt, positivePrompt: "[fail]" };

    d.hold("generation_list");
    const before = useStudio.getState().refreshGenerations(); // reads an empty history
    await waitFor(() => d.pending("generation_list") === 1);
    const g = (await useStudio.getState().submitGeneration(input, failing))!;
    expect(storeGen(g.id)).toBeDefined();
    d.release("generation_list");
    await before;
    expect(storeGen(g.id)?.id).toBe(g.id);

    await settled(p.id, g.id);
    await useStudio.getState().refreshGenerations();
    expect(storeGen(g.id)?.status).toBe("failed");
    d.hold("generation_list");
    const beforeRetry = useStudio.getState().refreshGenerations(); // no retried generation yet
    await waitFor(() => d.pending("generation_list") === 1);
    const retried = (await useStudio.getState().retryGeneration(storeGen(g.id)!))!;
    expect(retried.id).not.toBe(g.id);
    d.release("generation_list");
    await beforeRetry;
    expect(storeGen(retried.id)?.id).toBe(retried.id);
  });

  async function untilBackendRunning(generationId: string) {
    for (let i = 0; i < 600; i++) {
      if ((await jobOf(generationId)).status === "running") return;
      await sleep(5);
    }
    throw new Error("job never ran");
  }

  it("an older job_list answered after a newer one is dropped", async () => {
    // No events: only polls see progress.
    const d = useDeferredMock(30);
    const { p, g } = await openAndSubmit();
    await untilBackendRunning(g.id);
    d.hold("job_list");
    const older = useStudio.getState().refreshJobs(); // reads "running"
    await waitFor(() => d.pending("job_list") === 1);
    await settled(p.id, g.id);
    const newer = useStudio.getState().refreshJobs(); // reads "completed"
    await waitFor(() => d.pending("job_list") === 2);
    d.releaseNewest("job_list");
    await newer;
    expect(storeJob(g.id)?.status).toBe("completed");
    d.release("job_list");
    await older;
    expect(storeJob(g.id)?.status).toBe("completed");
  });

  it("an older generation_list answered after a newer one is dropped", async () => {
    const d = useDeferredMock(30);
    const { p, g } = await openAndSubmit();
    await untilBackendRunning(g.id);
    d.hold("generation_list");
    const older = useStudio.getState().refreshGenerations();
    await waitFor(() => d.pending("generation_list") === 1);
    await settled(p.id, g.id);
    const newer = useStudio.getState().refreshGenerations();
    await waitFor(() => d.pending("generation_list") === 2);
    d.releaseNewest("generation_list");
    await newer;
    expect(storeGen(g.id)?.status).toBe("completed");
    d.release("generation_list");
    await older;
    expect(storeGen(g.id)?.status).toBe("completed");
  });
});

describe("bridge event connection", () => {
  function countingTransport() {
    const counts = { connects: 0, teardowns: 0 };
    const t: Transport = Object.assign(createMockTransport(), {
      connectEvents: () => {
        counts.connects++;
        return () => {
          counts.teardowns++;
        };
      },
    });
    setTransport(t);
    return counts;
  }

  it("tears the listener down when the last subscriber leaves", async () => {
    const counts = countingTransport();
    const offA = subscribe(JOB_UPDATED_EVENT, () => {});
    const offB = subscribe(GENERATION_UPDATED_EVENT, () => {});
    await eventsReady();
    expect(counts).toEqual({ connects: 1, teardowns: 0 });
    offA();
    expect(counts.teardowns).toBe(0);
    offB();
    expect(counts.teardowns).toBe(1);
    const offC = subscribe(JOB_UPDATED_EVENT, () => {});
    await eventsReady();
    expect(counts).toEqual({ connects: 2, teardowns: 1 });
    offC();
    expect(counts).toEqual({ connects: 2, teardowns: 2 });
  });

  it("an unsubscribe while connecting closes the listener once it opens", async () => {
    const counts = countingTransport();
    const off = subscribe(JOB_UPDATED_EVENT, () => {});
    off(); // the connection is still pending
    await sleep(0);
    expect(counts).toEqual({ connects: 1, teardowns: 1 });
    // A new subscriber still gets a live connection.
    const seen: string[] = [];
    const again = subscribe(JOB_UPDATED_EVENT, (j) => seen.push(j.id));
    await eventsReady();
    expect(counts).toEqual({ connects: 2, teardowns: 1 });
    again();
    expect(counts.teardowns).toBe(2);
  });
});

describe("jobs tray helpers", () => {
  const job = (id: string, projectId: string, status: JobDTO["status"]): JobDTO => ({
    id,
    projectId,
    batchId: null,
    generationId: `G_${id}`,
    cameraId: null,
    providerId: "local_preview",
    modelId: "placeholder-v1",
    label: id,
    status,
    priority: 0,
    attempt: 1,
    maxAttempts: 3,
    nextAttemptAt: null,
    error: null,
    createdAt: "2026-10-08T00:00:00Z",
    startedAt: "2026-10-08T00:00:10Z",
    finishedAt: status === "completed" ? "2026-10-08T00:00:25Z" : null,
  });

  it("lists active jobs first and filters to the project", () => {
    const jobs = [job("a", "P1", "completed"), job("b", "P2", "running"), job("c", "P1", "queued")];
    expect(visibleJobs(jobs, "all", "P1").map((j) => j.id)).toEqual(["b", "c", "a"]);
    expect(visibleJobs(jobs, "project", "P1").map((j) => j.id)).toEqual(["c", "a"]);
  });

  it("measures elapsed time until finish, or until now while running", () => {
    expect(jobElapsedMs(job("a", "P", "completed"), Date.parse("2026-10-08T01:00:00Z"))).toBe(
      15_000,
    );
    expect(jobElapsedMs(job("b", "P", "running"), Date.parse("2026-10-08T00:00:13Z"))).toBe(3000);
    expect(jobElapsedMs({ ...job("c", "P", "queued"), startedAt: null }, 0)).toBeNull();
  });
});
