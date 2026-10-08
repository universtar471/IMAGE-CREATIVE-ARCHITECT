/**
 * In-memory backend for running the UI in a plain browser (`npm run dev` without Tauri)
 * and for UI tests. It mirrors the Rust services' rules closely enough to exercise the
 * UI, but it is NOT the source of truth — the Rust backend and its tests are.
 * Data persists to localStorage so reloads behave like reopening the app.
 *
 * Phase 2: two mock providers mirror the Rust registry (`gemini`, `local_preview`).
 * API keys are never stored here — only a "configured" boolean per provider.
 * Generated outputs are cheap SVG placeholders. A positive prompt containing `[fail]`
 * produces a `failed` generation so the error UI can be exercised.
 *
 * Phase 3 (ADR-017/018): every generation runs as a job in an in-process queue with the
 * backend's rules — per-provider concurrency (local 2, remote 1), priority then age,
 * retry with backoff for retryable errors (delays scaled down), cancel, restart recovery —
 * and emits `job://updated` / `generation://updated` through `connectEvents`.
 * `[flaky]` in the prompt fails the first attempt with `rate_limited`, then succeeds.
 */
import {
  GENERATION_UPDATED_EVENT,
  generationParentAssetId,
  JOB_UPDATED_EVENT,
  TERMINAL_JOB_STATUSES,
  isDnaReady,
  ProjectDNASchema,
  validateGenerationRequest,
  validateProjectDNA,
  type AppError,
  type AssetDTO,
  type AssetRole,
  type BatchDTO,
  type CameraAnchorDTO,
  type GenerationDTO,
  type GenerationError,
  type GenerationPurpose,
  type GenerationSubmitRequest,
  type JobCounts,
  type JobDTO,
  type ModelCapabilities,
  type ProjectDNA,
  type ProjectDTO,
  type ProjectStatus,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import type { CommandName, EventSink, Requests, Transport, VersionDTO } from "./bridge";

type Db = {
  projects: Record<string, ProjectDTO & { masterApprovedAt: string | null }>;
  dna: Record<string, ProjectDNA>;
  assets: Record<string, AssetDTO>;
  versions: VersionDTO[];
  /** Phase 2 (optional so Phase 1 snapshots and test fixtures still load). */
  generations?: GenerationDTO[];
  /** providerId → a key has been "set". Never the key itself. */
  providerKeys?: Record<string, boolean>;
  /** Phase 3 queue (optional so older snapshots still load). */
  jobs?: MockJob[];
  batches?: MockBatch[];
  anchors?: CameraAnchorDTO[];
};

/** A job plus what the mock needs to run and retry it (never sent to the UI). */
type MockJob = JobDTO & { seq: number; request: GenerationSubmitRequest };
type MockBatch = Omit<BatchDTO, "counts">;

export type MockOptions = {
  /** Simulated provider latency per attempt (ms). */
  generationDelayMs?: number;
  /** Backoff before attempts 2 and 3 (ms). The backend waits 15 s and 60 s. */
  retryDelaysMs?: readonly [number, number];
};

/** ADR-017: concurrent jobs per provider, by provider kind. */
export const MOCK_PROVIDER_SLOTS = { local: 2, remote: 1 } as const;
export const MOCK_MAX_ATTEMPTS = 3;
const RETRYABLE_KINDS: readonly GenerationError["kind"][] = ["rate_limited", "network", "timeout"];

const PURPOSE_TITLES: Record<GenerationPurpose, string> = {
  hero: "Hero",
  variation: "Variation",
  anchor: "Anchor",
  production: "Production",
};

type MockProvider = Omit<ProviderDescriptorDTO, "configured" | "keySource">;

const RATIOS_EXTENDED = [
  "1:1",
  "1:4",
  "1:8",
  "2:3",
  "3:2",
  "3:4",
  "4:1",
  "4:3",
  "4:5",
  "5:4",
  "8:1",
  "9:16",
  "16:9",
  "21:9",
];
const RATIOS_STANDARD = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

/** Mirrors `providers/gemini/models.rs` (P2-B): one image per call, up to 4 sequential outputs. */
const GEMINI_MODELS: ModelCapabilities[] = (
  [
    ["gemini-nano-banana-2.1", "Nano Banana 2.1 (Gemini)", 14, RATIOS_EXTENDED, ["1K", "2K", "4K"]],
    [
      "gemini-3-pro-image",
      "Nano Banana Pro (Gemini 3 Pro Image)",
      14,
      RATIOS_STANDARD,
      ["1K", "2K", "4K"],
    ],
    [
      "gemini-3.1-flash-image",
      "Nano Banana 2 (Gemini 3.1 Flash Image)",
      14,
      RATIOS_EXTENDED,
      ["512", "1K", "2K", "4K"],
    ],
    [
      "gemini-3.1-flash-lite-image",
      "Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
      14,
      RATIOS_STANDARD,
      ["1K"],
    ],
    [
      "gemini-2.5-flash-image",
      "Nano Banana (Gemini 2.5 Flash Image, legacy)",
      3,
      RATIOS_STANDARD,
      [],
    ],
  ] as const
).map(([id, label, maxReferenceImages, aspectRatios, imageSizes]) => ({
  id,
  label,
  textToImage: true,
  imageToImage: true,
  maxReferenceImages,
  maxOutputs: 4,
  aspectRatios: [...aspectRatios],
  imageSizes: [...imageSizes],
  supportsNegativePrompt: false,
  supportsSeed: false,
}));

/** Mirrors `ProviderRegistry::builtin()` in src-tauri/src/providers. */
export const MOCK_PROVIDERS: readonly MockProvider[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "remote",
    requiresApiKey: true,
    models: GEMINI_MODELS,
  },
  {
    id: "local_preview",
    label: "Local preview (offline)",
    kind: "local",
    requiresApiKey: false,
    models: [
      {
        id: "placeholder-v1",
        label: "Placeholder renderer",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 14,
        maxOutputs: 4,
        aspectRatios: ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"],
        imageSizes: ["1K"],
        supportsNegativePrompt: true,
        supportsSeed: true,
      },
    ],
  },
];

const STORAGE_KEY = "arch-studio-mock-db-v1";
const browserFiles = new Map<string, File>();

/** Register a browser File and return a fake "path" the mock import understands. */
export function registerBrowserFile(file: File): string {
  const handle = `browser-file://${crypto.randomUUID()}/${file.name}`;
  browserFiles.set(handle, file);
  return handle;
}

const fail = (code: AppError["code"], message: string, details?: unknown): never => {
  throw { code, message, details } satisfies AppError;
};

const ULID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function newId(prefix: string): string {
  let s = Date.now().toString(32).toUpperCase().padStart(10, "0").slice(-10);
  for (let i = 0; i < 16; i++) s += ULID_CHARS[Math.floor(Math.random() * 32)];
  return `${prefix}_${s.replace(/[ILOU]/g, "X")}`;
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      const interrupted: GenerationError = {
        kind: "interrupted",
        message: "The app was closed while this generation was running.",
        retryable: true,
      };
      // Like the Rust startup sweep (ADR-014/017): a reload mid-call leaves it interrupted;
      // queued and retrying jobs resume.
      for (const g of db.generations ?? []) {
        if (g.status === "running") {
          g.status = "interrupted";
          g.error = interrupted;
        }
      }
      for (const j of db.jobs ?? []) {
        if (j.status === "running") {
          j.status = "interrupted";
          j.error = interrupted;
          j.finishedAt = new Date().toISOString();
        }
      }
      return db;
    }
  } catch {
    /* fall through to empty db */
  }
  return { projects: {}, dna: {}, assets: {}, versions: [] };
}

export function createMockTransport(initial?: Db, options: MockOptions = {}): Transport {
  const db: Db = initial ?? load();
  const generations = (db.generations ??= []);
  const providerKeys = (db.providerKeys ??= {});
  const jobs = (db.jobs ??= []);
  const batches = (db.batches ??= []);
  db.anchors ??= [];
  for (const v of db.versions) v.generationId ??= null;
  // Phase 2 snapshots: fill the Phase 3 generation fields.
  for (const g of generations) {
    g.createdAt ??= g.startedAt ?? new Date().toISOString();
    g.cameraId ??= null;
    g.batchId ??= null;
    g.jobId ??= null;
  }
  const generationDelayMs = options.generationDelayMs ?? 1500;
  const retryDelaysMs = options.retryDelaysMs ?? [1500, 6000];
  const sinks = new Set<EventSink>();
  let jobSeq = jobs.reduce((n, j) => Math.max(n, j.seq ?? 0), 0);

  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      /* quota exceeded: keep in memory */
    }
  };
  const now = () => new Date().toISOString();

  const getProject = (id: string) =>
    db.projects[id] ?? fail("NOT_FOUND", `Project '${id}' was not found.`);
  const writable = (id: string) => {
    const p = getProject(id);
    if (p.archivedAt)
      fail("INVALID_STATE", `'${p.name}' is archived and read-only. Restore it first.`);
    return p;
  };
  const publicProject = (p: Db["projects"][string]): ProjectDTO => {
    const { masterApprovedAt, ...dto } = p;
    return dto;
  };
  const refreshStatus = (id: string) => {
    const p = getProject(id);
    const dna = db.dna[id]!;
    let status: ProjectStatus = "draft";
    if (p.archivedAt) status = "archived";
    else if (p.activeMasterAssetId && p.masterApprovedAt) {
      // ADR-016: anchor views move an approved master into anchor generation / production.
      const views = dna.cameras.filter((c) => c.isAnchorView);
      const anchored = views.filter((c) =>
        db.anchors!.some((a) => a.projectId === id && a.cameraId === c.id),
      );
      status =
        views.length === 0
          ? "master_approved"
          : anchored.length === views.length
            ? "production"
            : "anchor_generation";
    } else if (p.activeMasterAssetId) status = "master_pending";
    else if (isDnaReady(dna, p.projectType)) status = "dna_ready";
    p.status = status;
    p.updatedAt = now();
  };
  const projectAssets = (id: string) =>
    Object.values(db.assets)
      .filter((a) => a.projectId === id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const applyMaster = (projectId: string, assetId: string | null) => {
    const p = getProject(projectId);
    if (assetId && db.assets[assetId]?.projectId !== projectId) {
      fail("VALIDATION_ERROR", "That asset belongs to a different project.");
    }
    if (p.activeMasterAssetId !== assetId) {
      for (const a of projectAssets(projectId)) {
        if (a.role === "master_architecture") a.role = "architecture_reference";
      }
      p.masterApprovedAt = null;
    }
    if (assetId) db.assets[assetId]!.role = "master_architecture";
    p.activeMasterAssetId = assetId;
    refreshStatus(projectId);
  };

  const getProvider = (id: string): MockProvider =>
    MOCK_PROVIDERS.find((p) => p.id === id) ?? fail("NOT_FOUND", `Unknown provider '${id}'.`);

  const describeProvider = (p: MockProvider): ProviderDescriptorDTO => {
    const hasKey = !!providerKeys[p.id];
    return {
      ...p,
      configured: !p.requiresApiKey || hasKey,
      keySource: p.requiresApiKey && hasKey ? "keychain" : null,
    };
  };

  /** Output IDs still present, like the backend's join on generation_outputs. */
  const publicGeneration = (g: GenerationDTO): GenerationDTO => ({
    ...g,
    outputAssetIds: g.outputAssetIds.filter((id) => db.assets[id]),
  });

  /** ADR-015: outputs are ai_generated regular images, versioned under the parent's latest. */
  const createOutputs = (gen: GenerationDTO, req: GenerationSubmitRequest): string[] => {
    const parent = gen.parentAssetId ? db.assets[gen.parentAssetId] : undefined;
    const parentVersion = parent
      ? db.versions.filter((v) => v.assetId === parent.id).at(-1)
      : undefined;
    const [w, h] = outputSize(req.params.aspectRatio, parent);
    const purpose = PURPOSE_TITLES[req.purpose];
    const camera = req.cameraId
      ? db.dna[req.projectId]?.cameras.find((c) => c.id === req.cameraId)
      : undefined;
    const ids: string[] = [];
    for (let i = 0; i < req.params.outputCount; i++) {
      const id = newId("AST");
      const t = now();
      const url = placeholderSvg(
        w,
        h,
        camera ? `${camera.name} · ${purpose} ${i + 1}` : `${purpose} ${i + 1}`,
        req.modelId,
        (req.params.seed ?? 0) + i,
      );
      db.assets[id] = {
        id,
        projectId: req.projectId,
        source: "ai_generated",
        role: "regular_image",
        status: "ready",
        originalName: `${purpose.toLowerCase()}-${gen.id.slice(-6).toLowerCase()}-${i + 1}.svg`,
        managedRelPath: `assets/generated/${id}.svg`,
        absolutePath: url,
        thumbnailPath: url,
        mimeType: "image/svg+xml",
        fileSizeBytes: url.length,
        widthPx: w,
        heightPx: h,
        sha256: null,
        parentAssetId: gen.parentAssetId,
        operation: "generate",
        createdAt: t,
        updatedAt: t,
      };
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: parentVersion?.id ?? null,
        label: `${purpose} ${i + 1}/${req.params.outputCount}`,
        operation: "generate",
        generationId: gen.id,
        createdAt: t,
      });
      ids.push(id);
    }
    return ids;
  };

  // ------------------------------------------------------------------ queue (ADR-017)

  const emit = (event: Parameters<EventSink>[0], payload: unknown) => {
    for (const sink of [...sinks]) sink(event, structuredClone(payload));
  };
  const publicJob = (j: MockJob): JobDTO => {
    const { seq: _seq, request: _request, ...dto } = j;
    return dto;
  };
  const emitJob = (j: MockJob) => emit(JOB_UPDATED_EVENT, publicJob(j));
  const emitGeneration = (g: GenerationDTO) => emit(GENERATION_UPDATED_EVENT, publicGeneration(g));
  const isTerminal = (j: JobDTO) => TERMINAL_JOB_STATUSES.includes(j.status);
  const generationOf = (j: JobDTO) => generations.find((g) => g.id === j.generationId)!;

  /** Validate a request exactly like `generation_submit` (throws AppError-shaped values). */
  const validateRequest = (req: GenerationSubmitRequest) => {
    writable(req.projectId);
    const provider = getProvider(req.providerId);
    const model =
      provider.models.find((m) => m.id === req.modelId) ??
      fail("NOT_FOUND", `Model '${req.modelId}' is not offered by ${provider.label}.`);
    const assets = projectAssets(req.projectId);
    for (const id of req.referenceAssetIds) {
      const a =
        assets.find((x) => x.id === id) ??
        fail("NOT_FOUND", `Reference asset '${id}' was not found in this project.`);
      if (a.status !== "ready")
        fail("INVALID_STATE", `The file of reference '${a.originalName ?? id}' is missing.`);
    }
    const issues = validateGenerationRequest(req, model);
    if (issues.length) fail("VALIDATION_ERROR", issues[0]!.message, { issues });
    // §9 / Rust: a model that lists no ratios or sizes only accepts null (the provider decides).
    if (!model.aspectRatios.length && req.params.aspectRatio !== null)
      fail("VALIDATION_ERROR", `${model.label} chooses the aspect ratio itself; send null.`);
    if (!model.imageSizes.length && req.params.imageSize !== null)
      fail("VALIDATION_ERROR", `${model.label} chooses the image size itself; send null.`);
    if (req.cameraId && !db.dna[req.projectId]!.cameras.some((c) => c.id === req.cameraId)) {
      fail("VALIDATION_ERROR", `Camera '${req.cameraId}' does not exist in the Design DNA.`);
    }
    if (provider.requiresApiKey && !providerKeys[provider.id]) {
      fail(
        "PROVIDER_NOT_CONFIGURED",
        `${provider.label} has no API key yet. Add one in provider settings.`,
        { providerId: provider.id },
      );
    }
  };

  /** Insert a queued generation + its job (no validation here). */
  const enqueue = (
    req: GenerationSubmitRequest,
    extra: { batchId: string | null; label: string; priority: number },
  ): MockJob => {
    const t = now();
    const genId = newId("GEN");
    const jobId = newId("JOB");
    const gen: GenerationDTO = {
      id: genId,
      projectId: req.projectId,
      providerId: req.providerId,
      modelId: req.modelId,
      purpose: req.purpose,
      status: "queued",
      prompt: req.prompt,
      referenceAssetIds: [...req.referenceAssetIds],
      params: req.params,
      parentAssetId: generationParentAssetId(req.referenceAssetIds, projectAssets(req.projectId)),
      outputAssetIds: [],
      error: null,
      cameraId: req.cameraId ?? null,
      batchId: extra.batchId,
      jobId,
      createdAt: t,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    };
    const job: MockJob = {
      id: jobId,
      projectId: req.projectId,
      batchId: extra.batchId,
      generationId: genId,
      cameraId: req.cameraId ?? null,
      providerId: req.providerId,
      modelId: req.modelId,
      label: extra.label,
      status: "queued",
      priority: extra.priority,
      attempt: 0,
      maxAttempts: MOCK_MAX_ATTEMPTS,
      nextAttemptAt: null,
      error: null,
      createdAt: t,
      startedAt: null,
      finishedAt: null,
      seq: ++jobSeq,
      request: structuredClone(req),
    };
    generations.push(gen);
    jobs.push(job);
    emitGeneration(gen);
    emitJob(job);
    return job;
  };

  const defaultLabel = (req: GenerationSubmitRequest) => {
    const camera = req.cameraId
      ? db.dna[req.projectId]?.cameras.find((c) => c.id === req.cameraId)
      : undefined;
    return camera
      ? `${camera.name} — ${PURPOSE_TITLES[req.purpose].toLowerCase()}`
      : PURPOSE_TITLES[req.purpose];
  };

  /** Jobs whose provider call is in flight (a cancelled call keeps its slot until it returns). */
  const inFlight = new Map<string, string>();
  let pumpScheduled = false;
  /** Start every runnable job that has a free provider slot (priority, then age). */
  const pump = () => {
    pumpScheduled = false;
    const nowMs = Date.now();
    const runnable = jobs
      .filter(
        (j) =>
          j.status === "queued" ||
          (j.status === "retrying" && Date.parse(j.nextAttemptAt ?? "") <= nowMs),
      )
      .sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    for (const j of runnable) {
      const provider = MOCK_PROVIDERS.find((p) => p.id === j.providerId);
      const slots = MOCK_PROVIDER_SLOTS[provider?.kind ?? "remote"];
      const busy = [...inFlight.values()].filter((p) => p === j.providerId).length;
      if (busy < slots) startAttempt(j);
    }
  };
  const schedulePump = (delayMs = 0) => {
    if (delayMs > 0) {
      setTimeout(pump, delayMs);
      return;
    }
    if (pumpScheduled) return;
    pumpScheduled = true;
    setTimeout(pump, 0);
  };

  const startAttempt = (j: MockJob) => {
    const t = now();
    j.status = "running";
    j.attempt += 1;
    j.startedAt ??= t;
    j.nextAttemptAt = null;
    const gen = generationOf(j);
    gen.status = "running";
    // Like the backend: a job-backed generation's startedAt is the latest attempt's start.
    gen.startedAt = t;
    gen.error = null;
    inFlight.set(j.id, j.providerId);
    save();
    emitJob(j);
    emitGeneration(gen);
    const attempt = j.attempt;
    setTimeout(() => finishAttempt(j.id, attempt), generationDelayMs);
  };

  const finishAttempt = (jobId: string, attempt: number) => {
    inFlight.delete(jobId);
    const j = jobs.find((x) => x.id === jobId);
    // Cancelled (or otherwise moved on) while the call ran: discard the result, write nothing.
    if (!j || j.status !== "running" || j.attempt !== attempt) {
      schedulePump();
      return;
    }
    const gen = generationOf(j);
    const prompt = j.request.prompt.positivePrompt;
    let error: GenerationError | null = null;
    if (/\[fail\]/i.test(prompt)) {
      error = {
        kind: "bad_response",
        message: "The mock provider was told to fail ([fail] found in the prompt).",
        retryable: true,
      };
    } else if (/\[flaky\]/i.test(prompt) && attempt === 1) {
      error = {
        kind: "rate_limited",
        message: "The mock provider is rate limited ([flaky] fails the first attempt).",
        retryable: true,
      };
    }
    const t = now();
    if (error && RETRYABLE_KINDS.includes(error.kind) && attempt < j.maxAttempts) {
      const delay = retryDelaysMs[attempt - 1] ?? retryDelaysMs[1];
      j.status = "retrying";
      j.error = error;
      j.nextAttemptAt = new Date(Date.now() + delay).toISOString();
      // The generation waits in the queue again until the next attempt starts; the job
      // carries the error (backend: generation error null, startedAt null while waiting).
      gen.status = "queued";
      gen.error = null;
      gen.startedAt = null;
      schedulePump(delay + 1);
    } else if (error) {
      j.status = "failed";
      j.error = error;
      j.finishedAt = t;
      gen.status = "failed";
      gen.error = error;
    } else {
      j.status = "completed";
      j.error = null;
      j.finishedAt = t;
      gen.status = "completed";
      gen.error = null;
      gen.outputAssetIds = createOutputs(gen, j.request);
    }
    if (j.status !== "retrying") {
      gen.finishedAt = t;
      gen.durationMs = Math.max(0, Date.parse(t) - Date.parse(gen.startedAt ?? t));
    }
    save();
    emitJob(j);
    emitGeneration(gen);
    schedulePump();
  };

  const getJob = (id: string) =>
    jobs.find((j) => j.id === id) ?? fail("NOT_FOUND", `Job '${id}' was not found.`);

  const countsOf = (jobIds: readonly string[]): JobCounts => {
    const counts: JobCounts = {
      queued: 0,
      running: 0,
      retrying: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      interrupted: 0,
    };
    for (const id of jobIds) {
      const j = jobs.find((x) => x.id === id);
      if (j) counts[j.status] += 1;
    }
    return counts;
  };
  const publicBatch = (b: MockBatch): BatchDTO => ({ ...b, counts: countsOf(b.jobIds) });
  const projectAnchors = (projectId: string) =>
    db.anchors!.filter((a) => a.projectId === projectId);

  // Resume queued/retrying jobs left from a previous session.
  if (jobs.some((j) => !isTerminal(j))) schedulePump();

  const handlers: { [C in CommandName]: (req: Requests[C]) => unknown | Promise<unknown> } = {
    app_info: () => ({
      dataRoot: "browser (in-memory preview)",
      schemaVersion: 1,
      appVersion: "dev",
    }),

    project_create: (req) => {
      if (!req.name.trim()) fail("VALIDATION_ERROR", "Project name cannot be empty.");
      const v = validateProjectDNA(req.dna);
      if (!v.ok)
        fail("VALIDATION_ERROR", "The design DNA has invalid values.", {
          fieldErrors: v.fieldErrors,
        });
      const t = now();
      const id = newId("PRJ");
      db.projects[id] = {
        id,
        name: req.name.trim(),
        projectType: req.projectType,
        subtype: req.subtype?.trim() || null,
        status: "draft",
        activeMasterAssetId: null,
        masterApprovedAt: null,
        createdAt: t,
        updatedAt: t,
        archivedAt: null,
      };
      db.dna[id] = ProjectDNASchema.parse(req.dna);
      refreshStatus(id);
      save();
      return publicProject(db.projects[id]!);
    },

    project_list: (req) =>
      Object.values(db.projects)
        .filter((p) => req.includeArchived || !p.archivedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({
          ...publicProject(p),
          assetCount: projectAssets(p.id).length,
          thumbnailPath: p.activeMasterAssetId
            ? (db.assets[p.activeMasterAssetId]?.thumbnailPath ?? null)
            : null,
        })),

    project_get: (req) => ({
      project: publicProject(getProject(req.projectId)),
      dna: db.dna[req.projectId],
      assets: projectAssets(req.projectId),
    }),

    project_update_metadata: (req) => {
      const p = writable(req.projectId);
      if (req.name !== undefined) {
        if (!req.name.trim()) fail("VALIDATION_ERROR", "Project name cannot be empty.");
        p.name = req.name.trim();
      }
      if (req.subtype !== undefined) p.subtype = req.subtype.trim() || null;
      p.updatedAt = now();
      save();
      return publicProject(p);
    },

    project_set_archived: (req) => {
      const p = getProject(req.projectId);
      p.archivedAt = req.archived ? (p.archivedAt ?? now()) : null;
      refreshStatus(p.id);
      save();
      return publicProject(p);
    },

    project_approve_master: (req) => {
      const p = writable(req.projectId);
      if (req.approved && !p.activeMasterAssetId) {
        fail("INVALID_STATE", "Choose a master architecture image before approving it.");
      }
      p.masterApprovedAt = req.approved ? now() : null;
      refreshStatus(p.id);
      save();
      return publicProject(p);
    },

    dna_get: (req) => {
      getProject(req.projectId);
      return db.dna[req.projectId];
    },

    dna_update: (req) => {
      const v = validateProjectDNA(req.dna);
      if (!v.ok)
        fail("VALIDATION_ERROR", "The design DNA has invalid values and was not saved.", {
          fieldErrors: v.fieldErrors,
        });
      writable(req.projectId);
      db.dna[req.projectId] = JSON.parse(JSON.stringify(req.dna)) as ProjectDNA;
      // ADR-016: anchors of cameras that no longer exist are dropped.
      const cameraIds = new Set(req.dna.cameras.map((c) => c.id));
      db.anchors = db.anchors!.filter(
        (x) => x.projectId !== req.projectId || cameraIds.has(x.cameraId),
      );
      refreshStatus(req.projectId);
      save();
      return publicProject(getProject(req.projectId));
    },

    asset_import: async (req) => {
      writable(req.projectId);
      const file =
        browserFiles.get(req.sourcePath) ?? fail("IO_ERROR", "Cannot read the selected file.");
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        fail(
          "UNSUPPORTED_FILE",
          `'${file.name}' is not a supported image. Supported formats: JPEG, PNG and WebP.`,
        );
      }
      const bytes = await file.arrayBuffer();
      const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const existing = projectAssets(req.projectId).find((a) => a.sha256 === sha256);
      if (existing && !req.allowDuplicate) {
        fail(
          "DUPLICATE_ASSET",
          `'${file.name}' is identical to '${existing.originalName}' already in this project.`,
          {
            existingAssetId: existing.id,
            fileName: file.name,
          },
        );
      }
      const url = URL.createObjectURL(file);
      const { width, height, thumb } = await inspectImage(url);
      const id = newId("AST");
      const t = now();
      const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
      db.assets[id] = {
        id,
        projectId: req.projectId,
        source: req.source,
        role: req.role === "master_architecture" ? "regular_image" : req.role,
        status: "ready",
        originalName: file.name,
        managedRelPath: `assets/original/${id}.${ext}`,
        absolutePath: url,
        thumbnailPath: thumb,
        mimeType: file.type,
        fileSizeBytes: file.size,
        widthPx: width,
        heightPx: height,
        sha256,
        parentAssetId: null,
        operation: "import",
        createdAt: t,
        updatedAt: t,
      };
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: null,
        label: file.name,
        operation: "import",
        generationId: null,
        createdAt: t,
      });
      if (req.role === "master_architecture") applyMaster(req.projectId, id);
      save();
      return db.assets[id];
    },

    asset_list: (req) => {
      getProject(req.projectId);
      return projectAssets(req.projectId);
    },

    asset_update_role: (req) => {
      writable(req.projectId);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      if (req.role === "master_architecture") applyMaster(req.projectId, req.assetId);
      else {
        if (asset!.role === "master_architecture") applyMaster(req.projectId, null);
        asset!.role = req.role as AssetRole;
      }
      save();
      return projectAssets(req.projectId);
    },

    asset_set_master: (req) => {
      writable(req.projectId);
      applyMaster(req.projectId, req.assetId);
      save();
      return projectAssets(req.projectId);
    },

    asset_remove: (req) => {
      const p = writable(req.projectId);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      if (p.activeMasterAssetId === req.assetId) applyMaster(req.projectId, null);
      delete db.assets[req.assetId];
      db.versions = db.versions.filter((v) => v.assetId !== req.assetId);
      db.anchors = db.anchors!.filter((x) => x.assetId !== req.assetId);
      refreshStatus(req.projectId);
      save();
      return { assetId: req.assetId, fileCleanupWarning: null };
    },

    version_list: (req) => db.versions.filter((v) => v.projectId === req.projectId),

    provider_list: () => MOCK_PROVIDERS.map(describeProvider),

    provider_set_api_key: (req) => {
      const p = getProvider(req.providerId);
      if (!p.requiresApiKey) fail("INVALID_STATE", `${p.label} does not use an API key.`);
      if (!req.apiKey.trim()) fail("VALIDATION_ERROR", "The API key cannot be empty.");
      // Only the fact that a key exists is kept; the string itself is dropped here.
      providerKeys[p.id] = true;
      save();
      return describeProvider(p);
    },

    provider_clear_api_key: (req) => {
      const p = getProvider(req.providerId);
      delete providerKeys[p.id];
      save();
      return describeProvider(p);
    },

    provider_test: (req) => {
      const p = describeProvider(getProvider(req.providerId));
      if (!p.configured) return { ok: false, message: `No API key is set for ${p.label}.` };
      return {
        ok: true,
        message:
          p.kind === "local"
            ? "Offline provider, always available."
            : "Key accepted (browser preview mock — no network call was made).",
      };
    },

    generation_submit: (req) => {
      validateRequest(req);
      const job = enqueue(
        { ...req, cameraId: req.cameraId ?? null },
        { batchId: null, label: defaultLabel(req), priority: 0 },
      );
      save();
      schedulePump();
      return publicGeneration(generationOf(job));
    },

    generation_list: (req) => {
      getProject(req.projectId);
      return generations
        .filter((g) => g.projectId === req.projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(publicGeneration);
    },

    generation_get: (req) => {
      const g = generations.find((x) => x.id === req.generationId && x.projectId === req.projectId);
      return g ? publicGeneration(g) : fail("NOT_FOUND", "Generation not found in this project.");
    },

    batch_create: (req) => {
      if (!req.name.trim()) fail("VALIDATION_ERROR", "The batch needs a name.");
      if (req.items.length < 1 || req.items.length > 50)
        fail("VALIDATION_ERROR", "A batch has between 1 and 50 items.");
      // All-or-nothing: validate every item before inserting anything.
      const requests = req.items.map((item, i) => {
        const r: GenerationSubmitRequest = {
          projectId: req.projectId,
          providerId: req.providerId,
          modelId: req.modelId,
          purpose: req.purpose,
          prompt: item.prompt,
          referenceAssetIds: item.referenceAssetIds,
          params: item.params,
          cameraId: item.cameraId,
        };
        try {
          validateRequest(r);
        } catch (e) {
          const err = e as AppError;
          throw {
            ...err,
            message: `Item ${i + 1} (${item.label}): ${err.message}`,
            details: { ...(err.details as object | undefined), itemIndex: i },
          };
        }
        return { r, label: item.label };
      });
      const batch: MockBatch = {
        id: newId("BAT"),
        projectId: req.projectId,
        name: req.name.trim(),
        providerId: req.providerId,
        modelId: req.modelId,
        purpose: req.purpose,
        createdAt: now(),
        jobIds: [],
      };
      batches.push(batch);
      for (const { r, label } of requests) {
        const job = enqueue(r, { batchId: batch.id, label, priority: req.priority ?? 0 });
        batch.jobIds.push(job.id);
      }
      save();
      schedulePump();
      return publicBatch(batch);
    },

    batch_list: (req) => {
      getProject(req.projectId);
      return batches
        .filter((b) => b.projectId === req.projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(publicBatch);
    },

    job_list: (req) => {
      const mine = jobs
        .filter((j) => req.projectId === null || j.projectId === req.projectId)
        .sort((a, b) => b.seq - a.seq);
      const active = mine.filter((j) => !isTerminal(j));
      const done = mine.filter(isTerminal).slice(0, 100);
      return [...active, ...done].sort((a, b) => b.seq - a.seq).map(publicJob);
    },

    job_cancel: (req) => {
      const j = getJob(req.jobId);
      if (isTerminal(j)) fail("INVALID_STATE", `This job is already ${j.status}.`);
      const t = now();
      j.status = "cancelled";
      j.finishedAt = t;
      j.nextAttemptAt = null;
      const gen = generationOf(j);
      gen.status = "cancelled";
      gen.finishedAt = t;
      save();
      emitJob(j);
      emitGeneration(gen);
      schedulePump();
      return publicJob(j);
    },

    job_retry: (req) => {
      const j = getJob(req.jobId);
      if (!["failed", "cancelled", "interrupted"].includes(j.status))
        fail("INVALID_STATE", "Only failed, cancelled or interrupted jobs can be retried.");
      validateRequest(j.request);
      const copy = enqueue(j.request, { batchId: j.batchId, label: j.label, priority: j.priority });
      if (copy.batchId) batches.find((b) => b.id === copy.batchId)?.jobIds.push(copy.id);
      save();
      schedulePump();
      return publicJob(copy);
    },

    camera_anchor_list: (req) => {
      getProject(req.projectId);
      return projectAnchors(req.projectId);
    },

    camera_anchor_set: (req) => {
      writable(req.projectId);
      const camera =
        db.dna[req.projectId]!.cameras.find((c) => c.id === req.cameraId) ??
        fail("NOT_FOUND", "That camera does not exist in the Design DNA.");
      if (!camera.isAnchorView)
        fail("VALIDATION_ERROR", `'${camera.name}' is not an anchor view. Mark it first.`);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "That image is not part of this project.");
      if (asset!.status !== "ready") fail("INVALID_STATE", "The image file is missing.");
      db.anchors = db.anchors!.filter(
        (a) => !(a.projectId === req.projectId && a.cameraId === req.cameraId),
      );
      db.anchors.push({
        projectId: req.projectId,
        cameraId: req.cameraId,
        assetId: req.assetId,
        approvedAt: now(),
      });
      refreshStatus(req.projectId);
      save();
      return projectAnchors(req.projectId);
    },

    camera_anchor_clear: (req) => {
      writable(req.projectId);
      db.anchors = db.anchors!.filter(
        (a) => !(a.projectId === req.projectId && a.cameraId === req.cameraId),
      );
      refreshStatus(req.projectId);
      save();
      return projectAnchors(req.projectId);
    },
  };

  const transport: Transport = async (command, args) => {
    const handler = handlers[command] as (req: unknown) => unknown;
    return structuredClone(await handler(args.request));
  };
  transport.connectEvents = (sink) => {
    sinks.add(sink);
    return () => {
      sinks.delete(sink);
    };
  };
  return transport;
}

function outputSize(aspectRatio: string | null, parent: AssetDTO | undefined): [number, number] {
  const LONG = 1024;
  let ratio = 4 / 3;
  const m = aspectRatio?.match(/^(\d+):(\d+)$/);
  if (m) ratio = Number(m[1]) / Number(m[2]);
  else if (parent?.widthPx && parent.heightPx) ratio = parent.widthPx / parent.heightPx;
  return ratio >= 1 ? [LONG, Math.round(LONG / ratio)] : [Math.round(LONG * ratio), LONG];
}

/** A tiny, displayable placeholder image (no canvas needed, so it also works under jsdom). */
function placeholderSvg(w: number, h: number, title: string, model: string, seed: number): string {
  const hue = (seed * 47 + 200) % 360;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`,
    `<stop offset="0" stop-color="hsl(${hue},45%,62%)"/>`,
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360},35%,22%)"/>`,
    `</linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
    `<rect x="${w * 0.3}" y="${h * 0.4}" width="${w * 0.4}" height="${h * 0.4}" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.6)" stroke-width="3"/>`,
    `<polygon points="${w * 0.27},${h * 0.42} ${w * 0.5},${h * 0.22} ${w * 0.73},${h * 0.42}" fill="rgba(255,255,255,0.28)"/>`,
    `<rect y="${h * 0.84}" width="${w}" height="${h * 0.16}" fill="rgba(0,0,0,0.35)"/>`,
    `<text x="${w / 2}" y="${h * 0.93}" fill="#fff" font-family="Segoe UI, sans-serif" font-size="${Math.round(h * 0.045)}" text-anchor="middle">${title} · ${model} · mock</text>`,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function inspectImage(
  url: string,
): Promise<{ width: number; height: number; thumb: string }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 384 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    thumb: canvas.toDataURL("image/jpeg", 0.8),
  };
}
