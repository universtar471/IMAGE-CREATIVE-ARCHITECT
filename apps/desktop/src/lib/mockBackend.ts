/**
 * In-memory backend for running the UI in a plain browser (`npm run dev` without Tauri)
 * and for UI tests. It mirrors the Rust services' rules closely enough to exercise the
 * UI, but it is NOT the source of truth — the Rust backend and its tests are.
 * Data persists to localStorage so reloads behave like reopening the app.
 *
 * Mock providers mirror the Rust registry (`gemini`, `openai`, `local_preview`).
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
  PublicationDocumentSchema,
  validateGenerationRequest,
  validateProjectDNA,
  resolveUpscaleSize,
  type AppError,
  type AssetDTO,
  type CanvasLayout,
  CanvasLayoutSchema,
  isVideoAsset,
  type UserPresetDTO,
  USER_PRESET_NAME_MAX,
  type AssetRole,
  type BatchDTO,
  type CameraAnchorDTO,
  type EnhanceCheck,
  type EnhanceParams,
  type GenerationDTO,
  type GenerationError,
  type GenerationParams,
  type GenerationSubmitRequest,
  type JobCounts,
  type JobDTO,
  type ModelCapabilities,
  type ProjectDNA,
  type ProjectDTO,
  type ProjectStatus,
  type ProviderDescriptorDTO,
  type PublicationRecordDTO,
  ARCH_LUT_FILTER,
} from "@arch/domain";
import type {
  CommandName,
  EventSink,
  RegionGenerationSubmitRequest,
  Requests,
  Transport,
  VersionDTO,
} from "./bridge";
import {
  buildRegionEditPrompt,
  maskCoveragePct,
  newRegionId,
  rasterizeMask,
  type RegionDTO,
  type RegionEditParams,
  type RegionShape,
  type SceneDNA,
} from "./regions";
import { neutralGrade } from "./grade";
import { DNA_STEP_IDS, confirmStep, reopenStep, type WorkflowStepState } from "./workflow";

type MockAsset = AssetDTO & {
  operationJson?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

type Db = {
  projects: Record<string, ProjectDTO & { masterApprovedAt: string | null }>;
  dna: Record<string, ProjectDNA>;
  assets: Record<string, MockAsset>;
  versions: VersionDTO[];
  /** Phase 2 (optional so Phase 1 snapshots and test fixtures still load). */
  generations?: GenerationDTO[];
  /** providerId → a key has been "set". Never the key itself. */
  providerKeys?: Record<string, boolean>;
  /** Phase 3 queue (optional so older snapshots still load). */
  jobs?: MockJob[];
  batches?: MockBatch[];
  anchors?: CameraAnchorDTO[];
  workflow?: Record<string, WorkflowStepState[]>;
  regions?: RegionDTO[];
  /** SRS P5b Publishing Studio books (optional so older snapshots still load). */
  publications?: PublicationRecordDTO[];
  /** ADR-040: saved preset combinations, shared by every project. */
  userPresets?: UserPresetDTO[];
  /** ADR-041: branch canvas node positions per project. */
  canvasLayouts?: Record<string, { layout: CanvasLayout; updatedAt: string }>;
  /** ADR-040: views waiting in the SketchUp inbox (the extension cannot run in a browser). */
  sketchupInbox?: MockInboxView[];
  /** Inbox views already imported, by file name (the `imported/` folder of the backend). */
  sketchupImported?: string[];
};

/** A waiting SketchUp view; `fingerprint` stands in for the PNG's SHA-256. */
export type MockInboxView = {
  fileName: string;
  fingerprint: string;
  scene?: string;
  model?: string;
  width?: number;
  height?: number;
  capturedAt?: string;
};

export const MOCK_INBOX_PATH = "mock://app-data/inbox/sketchup";

/** The mock's answer to an evidence-board request (ADR-042). */
export const MOCK_ANALYSIS = {
  materials: [
    { name: "Painted render", location: "main facade walls", confidence: "high" },
    { name: "Timber louvres", location: "upper floor screen", confidence: "medium" },
    { name: "Clear glazing", location: "ground floor shopfront", confidence: "high" },
  ],
  palette: [
    { hex: "#E9E4DA", name: "Warm white" },
    { hex: "#9C7A5B", name: "Timber" },
    { hex: "#4B5563", name: "Dark frames" },
  ],
  composition: {
    viewpoint: "Street-level oblique view of the front facade",
    lighting: "Soft daylight from the left",
    focus: "Entrance and upper-floor louvres",
  },
  observations: ["Planting at the base softens the street edge."],
};

/** A neutral grey placeholder standing in for a SketchUp viewport capture. */
const VIEWPORT_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#cfd4da"/><path d="M60 140 L160 60 L260 140 Z" fill="#9aa3ad"/><rect x="110" y="100" width="100" height="40" fill="#e9ecef"/></svg>',
  );

/** A job plus what the mock needs to run and retry it (never sent to the UI). */
type RegionOrGenerationRequest = GenerationSubmitRequest | RegionGenerationSubmitRequest;
type MockJob = JobDTO & { seq: number; request: RegionOrGenerationRequest };
type MockBatch = Omit<BatchDTO, "counts">;

export type MockOptions = {
  /** Simulated provider latency per attempt (ms). */
  generationDelayMs?: number;
  /** Backoff before attempts 2 and 3 (ms). The backend waits 15 s and 60 s. */
  retryDelaysMs?: readonly [number, number];
  /** Pretend FFmpeg is on PATH (diagram video export, ADR-037). Default: missing. */
  ffmpeg?: boolean;
};

/** ADR-017: concurrent jobs per provider, by provider kind. */
export const MOCK_PROVIDER_SLOTS = { local: 2, remote: 1 } as const;
export const MOCK_MAX_ATTEMPTS = 3;
const RETRYABLE_KINDS: readonly GenerationError["kind"][] = ["rate_limited", "network", "timeout"];

/** Mirrors Rust `assets::ensure_image_role` (ADR-043). */
const VIDEO_ROLE_ERROR = "A video cannot be a reference or the master. Use an image for this role.";

const PURPOSE_TITLES: Record<string, string> = {
  hero: "Hero",
  variation: "Variation",
  anchor: "Anchor",
  production: "Production",
  enhance: "Enhance",
  repair: "Repair",
  region_edit: "Region edit",
  video: "Video",
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
  qualityOptions: [],
  priceHint: null,
}));

/**
 * Mirrors `providers/openai/models.rs`: one request with `n` outputs (max 4), up to 16
 * references, no resolution tiers (`imageSizes` empty): the adapter maps the aspect ratio to a size.
 */
const OPENAI_MODELS: ModelCapabilities[] = (
  [
    ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst"],
    ["gpt-image-2.5-flare", "GPT Image 2.5 Flare"],
    ["gpt-image-2", "GPT Image 2 (earlier model)"],
  ] as const
).map(([id, label]) => ({
  id,
  label,
  textToImage: true,
  imageToImage: true,
  maxReferenceImages: 16,
  maxOutputs: 4,
  aspectRatios: [...RATIOS_STANDARD],
  imageSizes: [],
  supportsNegativePrompt: false,
  supportsSeed: false,
  // Official OpenAI always sends `quality: high`; no choice.
  qualityOptions: [],
  priceHint: null,
}));

/**
 * Mirrors `providers/hhtech/catalog.rs` with no HHTECH_* settings besides the base URL (the
 * contract fixture's environment): the full catalog, best first. GPT models take the tier from
 * `size` and offer a quality choice; Gemini models offer only the published 2K / 4K tiers
 * (sent as `<base>-2k` / `<base>-4k`) and send no quality.
 */
const HHTECH_MODELS: ModelCapabilities[] = (
  [
    ["gpt-image-2.5-sunburst", "GPT Image 2.5 Sunburst", "gpt", [280, 600, 900]],
    ["gemini-3-pro-image", "Gemini 3 Pro Image (Banana)", "gemini", [null, 500, 800]],
    ["gpt-image-2.5-flare", "GPT Image 2.5 Flare", "gpt", [280, 600, 900]],
    ["gpt-image-2", "GPT Image 2", "gpt", [180, 500, 800]],
    ["gemini-3.1-flash-image", "Gemini 3.1 Flash Image", "gemini", [null, 500, 800]],
    ["gemini-2.5-flash-image", "Gemini 2.5 Flash Image", "gemini", [null, 500, 800]],
  ] as const
).map(([id, label, family, prices]) => {
  const priced = (["1K", "2K", "4K"] as const).flatMap((tier, i) => {
    const price = prices[i];
    return price === null || price === undefined ? [] : [[tier, price] as const];
  });
  return {
    id,
    label: `${label} · ${priced.map(([tier, price]) => `${tier} ${price}đ`).join(" / ")}`,
    textToImage: true,
    imageToImage: true,
    maxReferenceImages: family === "gpt" ? 16 : 14,
    maxOutputs: 4,
    aspectRatios: [...RATIOS_STANDARD],
    imageSizes: priced.map(([tier]) => tier),
    supportsNegativePrompt: false,
    supportsSeed: false,
    qualityOptions: family === "gpt" ? ["low", "medium", "high"] : [],
    priceHint: Object.fromEntries(priced),
  };
});

/** Mirrors Rust `video_model`: one first frame, one clip, durations as "5s" sizes. */
function videoModel(
  id: string,
  durations: readonly number[],
  ratios: readonly string[],
  label = id,
): ModelCapabilities {
  return {
    id,
    label,
    textToImage: false,
    imageToImage: true,
    maxReferenceImages: 1,
    maxOutputs: 1,
    aspectRatios: [...ratios],
    imageSizes: durations.map((d) => `${d}s`),
    supportsNegativePrompt: true,
    supportsSeed: false,
    qualityOptions: [],
    priceHint: null,
  };
}

function videoProvider(id: string, label: string, models: ModelCapabilities[]): MockProvider {
  return { id, label, kind: "remote", requiresApiKey: true, outputKind: "video", models };
}

/** Providers whose chat model can enhance prompts (`prompt_enhance`). */
export const MOCK_CHAT_PROVIDERS: readonly string[] = ["hhtech"];

/** Mirrors `ProviderRegistry::builtin()` in src-tauri/src/providers. */
const MOCK_PROVIDERS_BASE: readonly MockProvider[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "remote",
    requiresApiKey: true,
    outputKind: "image",
    models: GEMINI_MODELS,
  },
  {
    id: "openai",
    label: "OpenAI (GPT Image)",
    kind: "remote",
    requiresApiKey: true,
    outputKind: "image",
    models: OPENAI_MODELS,
  },
  {
    id: "hhtech",
    label: "HHTECH (OpenAI-compatible)",
    kind: "remote",
    requiresApiKey: true,
    outputKind: "image",
    models: HHTECH_MODELS,
  },
  {
    // ADR-040: listed but not configured until GATEWAY_BASE_URL / GATEWAY_IMAGE_MODEL are set.
    id: "gateway",
    label: "Custom gateway (OpenAI-compatible)",
    kind: "remote",
    requiresApiKey: true,
    outputKind: "image",
    models: [],
  },
  {
    id: "local_preview",
    label: "Local preview (offline)",
    kind: "local",
    requiresApiKey: false,
    outputKind: "image",
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
        qualityOptions: [],
        priceHint: null,
      },
    ],
  },
  {
    id: "local_upscale",
    label: "Local upscale",
    kind: "local",
    requiresApiKey: false,
    outputKind: "image",
    models: [
      {
        id: "lanczos3",
        label: "Conservative upscale (local)",
        textToImage: false,
        imageToImage: true,
        maxReferenceImages: 1,
        maxOutputs: 1,
        aspectRatios: [],
        imageSizes: [],
        supportsNegativePrompt: false,
        supportsSeed: false,
        qualityOptions: [],
        priceHint: null,
      },
    ],
  },
  // ADR-043: the video providers. Mirrors `providers/video/*` with no VIDEO env settings.
  videoProvider("kling", "Kling (video)", [videoModel("kling-v2-1", [5, 10], [])]),
  videoProvider("veo", "Veo (video)", [
    videoModel("veo-3.1-generate-preview", [4, 6, 8], ["16:9", "9:16"]),
  ]),
  videoProvider("seedance", "Seedance (video)", [
    {
      ...videoModel("seedance-1-0-pro-250528", [5, 10], ["adaptive", "16:9", "9:16", "1:1"]),
      supportsNegativePrompt: false,
    },
  ]),
  // Not set up until COMFY_VIDEO_WORKFLOW names a workflow file, so it cannot run in the mock.
  videoProvider("comfy_cloud", "Comfy Cloud (video workflow)", [
    videoModel("workflow", [5, 10], [], "Your exported workflow"),
  ]),
  // Mock only: a free "video" (the source image as a still poster) to try the flow.
  {
    id: "local_video_preview",
    label: "Local video preview (mock, still poster)",
    kind: "local",
    requiresApiKey: false,
    outputKind: "video",
    models: [videoModel("still-v1", [5, 10], [], "Still poster (no motion)")],
  },
];

/** §16.3: only official OpenAI and HHTECH GPT models receive native masks. */
const MOCK_PROVIDER_REGISTRY: readonly MockProvider[] = MOCK_PROVIDERS_BASE.map((provider) => ({
  ...provider,
  models: provider.models.map((model) => ({
    ...model,
    supportsMask:
      (provider.id === "openai" || provider.id === "hhtech") && !model.id.startsWith("gemini-"),
  })) as ModelCapabilities[],
}));
/** Legacy fixture comparison keeps this export provider-neutral; runtime descriptors carry §16.3. */
export const MOCK_PROVIDERS: readonly MockProvider[] = MOCK_PROVIDER_REGISTRY;

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
  const lutSources = new Map<
    string,
    { id: string; path: string; addedAt: string; lastScanAt: string; lutCount: number }
  >();
  const luts = new Map<
    string,
    {
      id: string;
      sourceId: string;
      relPath: string;
      pack: string;
      category: string;
      name: string;
      size: number;
      isLog: boolean;
      favorite: boolean;
      status: string;
    }
  >();
  const sampleNames = ["Natural Earthy", "Urban Film", "Portrait Wedding", "D-Log"];
  const previewJpeg = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=="), (char) =>
    char.charCodeAt(0),
  );
  const lutHandlers: Record<string, (request: unknown) => unknown> = {
    lut_source_add: (request) => {
      const { path } = request as { path: string };
      if (!path.trim()) fail("VALIDATION_ERROR", "A source path is required.");
      if ([...lutSources.values()].some((source) => source.path === path))
        fail("VALIDATION_ERROR", "Source already added.");
      const id = newId("LTS");
      const timestamp = new Date().toISOString();
      const source = {
        id,
        path,
        addedAt: timestamp,
        lastScanAt: timestamp,
        lutCount: sampleNames.length,
      };
      lutSources.set(id, source);
      sampleNames.forEach((name) => {
        const lutId = newId("LUT");
        luts.set(lutId, {
          id: lutId,
          sourceId: id,
          relPath: name + ".cube",
          pack: "Sample",
          category: "Sample",
          name,
          size: 33,
          isLog: name === "D-Log",
          favorite: false,
          status: "ok",
        });
      });
      return { source, added: sampleNames.length, invalid: 0 };
    },
    lut_source_list: () => [...lutSources.values()],
    lut_source_remove: (request) => {
      const { sourceId } = request as { sourceId: string };
      if (!lutSources.delete(sourceId)) fail("NOT_FOUND", "LUT source not found.");
      for (const [id, lut] of luts) if (lut.sourceId === sourceId) luts.delete(id);
      return { removed: true };
    },
    lut_source_rescan: (request) => {
      const { sourceId } = request as { sourceId: string };
      const source = lutSources.get(sourceId) ?? fail("NOT_FOUND", "LUT source not found.");
      source.lastScanAt = new Date().toISOString();
      return { source, added: 0, invalid: 0 };
    },
    lut_list: (rawRequest) => {
      const request = rawRequest as {
        query?: string;
        sourceId?: string;
        pack?: string;
        category?: string;
        favoritesOnly?: boolean;
        archOnly?: boolean;
        limit?: number;
        offset?: number;
      };
      const items = [...luts.values()].filter((lut) => {
        const label = (lut.pack + " " + lut.category + " " + lut.name).toLowerCase();
        return (
          (!request.query || label.includes(request.query.toLowerCase())) &&
          (!request.sourceId || lut.sourceId === request.sourceId) &&
          (!request.pack || lut.pack === request.pack) &&
          (!request.category || lut.category === request.category) &&
          (!request.favoritesOnly || lut.favorite) &&
          (!request.archOnly ||
            (!ARCH_LUT_FILTER.exclude.some((word) => label.includes(word)) &&
              ARCH_LUT_FILTER.prefer.some((word) => label.includes(word))))
        );
      });
      return {
        items: items.slice(request.offset ?? 0, (request.offset ?? 0) + (request.limit ?? 100)),
        total: items.length,
      };
    },
    lut_set_favorite: (request) => {
      const { lutId, favorite } = request as { lutId: string; favorite: boolean };
      const lut = luts.get(lutId) ?? fail("NOT_FOUND", "LUT not found.");
      lut.favorite = favorite;
      return lut;
    },
    lut_preview: (request) => {
      const { lutId } = request as { lutId: string };
      if (!luts.has(lutId)) fail("NOT_FOUND", "LUT not found.");
      return previewJpeg;
    },
    grade_preview: () => previewJpeg,
  };
  const db: Db = initial ?? load();
  const generations = (db.generations ??= []);
  const providerKeys = (db.providerKeys ??= {});
  const jobs = (db.jobs ??= []);
  const batches = (db.batches ??= []);
  db.anchors ??= [];
  db.workflow ??= {};
  db.regions ??= [];
  const publications = (db.publications ??= []);
  const userPresets = (db.userPresets ??= []);
  // Migration stand-in: projects that already had an approved master are grandfathered in.
  const workflowMigrationTime = new Date().toISOString();
  for (const [projectId, project] of Object.entries(db.projects)) {
    if (project.masterApprovedAt && !db.workflow[projectId]) {
      db.workflow[projectId] = DNA_STEP_IDS.map((stepId) => ({
        stepId,
        status: "confirmed",
        confirmedAt: workflowMigrationTime,
      }));
    }
  }
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
  const projectRegions = (projectId: string, assetId?: string) =>
    db.regions!.filter(
      (region) => region.projectId === projectId && (!assetId || region.assetId === assetId),
    );
  const projectScene = (projectId: string): SceneDNA => {
    const dna = db.dna[projectId] as ProjectDNA & { scene?: SceneDNA };
    return dna.scene ?? { schemaVersion: 1, objects: [] };
  };
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
    MOCK_PROVIDER_REGISTRY.find((p) => p.id === id) ??
    fail("NOT_FOUND", `Unknown provider '${id}'.`);

  const describeProvider = (p: MockProvider): ProviderDescriptorDTO => {
    const hasKey = !!providerKeys[p.id];
    return {
      ...p,
      // A provider without models is not set up (the custom gateway before GATEWAY_*).
      configured: (!p.requiresApiKey || hasKey) && p.models.length > 0,
      keySource: p.requiresApiKey && hasKey ? "keychain" : null,
    };
  };

  /** Output IDs still present, like the backend's join on generation_outputs. */
  const publicGeneration = (g: GenerationDTO): GenerationDTO => ({
    ...g,
    outputAssetIds: g.outputAssetIds.filter((id) => db.assets[id]),
  });

  /**
   * ADR-043: a video output. The mock cannot encode a clip, so the "video" is the source image
   * as a still poster; the asset still carries `mediaKind`, the duration and the lineage.
   */
  const createVideoOutput = (
    gen: GenerationDTO,
    req: RegionOrGenerationRequest,
    parent: AssetDTO | undefined,
  ): string => {
    const id = newId("AST");
    const t = now();
    const durationSec = Number.parseInt(req.params.imageSize ?? "5", 10) || 5;
    const poster =
      parent?.thumbnailPath ??
      parent?.absolutePath ??
      placeholderSvg(1280, 720, "Video", req.modelId, 0);
    db.assets[id] = {
      id,
      projectId: req.projectId,
      source: "ai_generated",
      role: "regular_image",
      status: "ready",
      originalName: `video-${gen.id.slice(-6).toLowerCase()}.mp4`,
      managedRelPath: `assets/original/${id}.mp4`,
      absolutePath: poster,
      thumbnailPath: poster,
      mimeType: "video/mp4",
      fileSizeBytes: null,
      widthPx: null,
      heightPx: null,
      sha256: null,
      parentAssetId: gen.parentAssetId,
      operation: "video",
      mediaKind: "video",
      durationMs: durationSec * 1000,
      // The mock "clip" is the source image, never a frame of a real clip.
      posterSource: "source",
      createdAt: t,
      updatedAt: t,
    };
    db.versions.push({
      id: newId("VER"),
      projectId: req.projectId,
      assetId: id,
      parentVersionId: parent
        ? (db.versions.filter((v) => v.assetId === parent.id).at(-1)?.id ?? null)
        : null,
      label: `Video — ${req.modelId}`,
      operation: "video",
      generationId: gen.id,
      createdAt: t,
    });
    return id;
  };

  /** ADR-015: outputs are ai_generated regular images, versioned under the parent's latest. */
  const createOutputs = (gen: GenerationDTO, req: RegionOrGenerationRequest): string[] => {
    const parent = gen.parentAssetId ? db.assets[gen.parentAssetId] : undefined;
    if (req.purpose === "video") return [createVideoOutput(gen, req, parent)];
    const parentVersion = parent
      ? db.versions.filter((v) => v.assetId === parent.id).at(-1)
      : undefined;
    const enhance = (req.params as GenerationParams & { enhance?: EnhanceParams }).enhance;
    const region = (req.params as GenerationParams & { region?: RegionEditParams }).region;
    const regionMetadata = (() => {
      if (!region || !parent) return null;
      const shapes = projectRegions(req.projectId, parent.id)
        .filter((item) => region.regionIds.includes(item.id))
        .map((item) => item.shape);
      const mask = rasterizeMask(shapes, parent.widthPx ?? 1, parent.heightPx ?? 1);
      const provider = getProvider(req.providerId);
      const model = provider.models.find((item) => item.id === req.modelId);
      const nativeMask = Boolean(
        (model as (ModelCapabilities & { supportsMask?: boolean }) | undefined)?.supportsMask,
      );
      return { shapes, nativeMask, maskCoveragePct: maskCoveragePct(mask) };
    })();
    const [w, h] = enhance
      ? enhanceOutputSize(enhance, parent)
      : outputSize(req.params.aspectRatio, parent);
    if (enhance?.preservationMode) gen.enhanceCheck = mockEnhanceCheck(enhance, parent, [w, h]);
    const purpose = PURPOSE_TITLES[req.purpose] ?? "Generation";
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
        mimeType: enhance ? "image/png" : "image/svg+xml",
        fileSizeBytes: url.length,
        widthPx: w,
        heightPx: h,
        sha256: null,
        parentAssetId: gen.parentAssetId,
        operation: region ? "region_edit" : enhance ? "enhance" : "generate",
        ...(region && regionMetadata
          ? {
              operationJson: {
                params: req.params,
                regionShapes: regionMetadata.shapes,
                nativeMask: regionMetadata.nativeMask,
                maskCoveragePct: regionMetadata.maskCoveragePct,
                providerId: req.providerId,
                model: req.modelId,
              },
              meta: {
                nativeMask: regionMetadata.nativeMask,
                maskCoveragePct: regionMetadata.maskCoveragePct,
              },
            }
          : {}),
        createdAt: t,
        updatedAt: t,
      };
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: parentVersion?.id ?? null,
        label: region
          ? `Region edit · ${region.regionIds.length} region(s)`
          : `${purpose} ${i + 1}/${req.params.outputCount}`,
        operation: region ? "region_edit" : enhance ? "enhance" : "generate",
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
  const validateRequest = (req: RegionOrGenerationRequest) => {
    writable(req.projectId);
    const purpose = req.purpose as string;
    // Repairs came only from QC reports; QC was removed (ADR-033), so none are created now.
    if (purpose === "repair")
      fail("VALIDATION_ERROR", "Repair generations can no longer be submitted.");
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
      if (isVideoAsset(a))
        fail(
          "VALIDATION_ERROR",
          `'${a.originalName ?? id}' is a video and cannot be used as a reference image. Pick an image instead.`,
        );
    }
    // ADR-043: purpose and provider must agree, as in Rust `video::validate_purpose`.
    const videoProvider = provider.outputKind === "video";
    if (videoProvider && req.purpose !== "video")
      fail("VALIDATION_ERROR", `${provider.label} makes videos; use it from the Video module.`);
    if (!videoProvider && req.purpose === "video")
      fail("VALIDATION_ERROR", `${provider.label} makes images; pick a video provider.`);
    if (req.purpose === "video") {
      if (req.referenceAssetIds.length !== 1)
        fail("VALIDATION_ERROR", "A video starts from exactly one source image.");
      if (!/^\d+s$/.test(req.params.imageSize ?? ""))
        fail("VALIDATION_ERROR", "Pick a clip length for the video.");
    }
    const enhance = (req.params as GenerationParams & { enhance?: EnhanceParams }).enhance;
    if (req.purpose === "enhance") {
      const enhancement =
        enhance ??
        fail("VALIDATION_ERROR", "Enhancement parameters are required at params.enhance.");
      if (req.referenceAssetIds.length !== 1)
        fail("VALIDATION_ERROR", "Enhancement requires exactly one source reference.");
      if (
        !Number.isInteger(enhancement.detailStrength) ||
        enhancement.detailStrength < 0 ||
        enhancement.detailStrength > 100
      )
        fail("VALIDATION_ERROR", "detailStrength must be an integer from 0 to 100.");
      if (enhancement.mode === "conservative" && req.providerId !== "local_upscale")
        fail("VALIDATION_ERROR", "Conservative enhancement uses local_upscale.");
      const source = assets.find((item) => item.id === req.referenceAssetIds[0]);
      const sourceEdge = Math.max(source?.widthPx ?? 0, source?.heightPx ?? 0);
      if (
        enhancement.preservationMode === "strict" &&
        (enhancement.mode !== "conservative" || req.providerId !== "local_upscale")
      )
        fail("VALIDATION_ERROR", "Strict enhancement is local only.");
      if (enhancement.upscale) {
        const size = resolveUpscaleSize(
          { width: source?.widthPx ?? 1024, height: source?.heightPx ?? 768 },
          enhancement.upscale.target,
          enhancement.upscale.ifAlreadyLarger,
        );
        if (size.action === "skip")
          fail("VALIDATION_ERROR", "The source already exceeds the size target; it is skipped.");
      } else {
        if (enhancement.mode === "conservative" && enhancement.targetLongEdge === null)
          fail("VALIDATION_ERROR", "Conservative enhancement requires a target size.");
        if (enhancement.targetLongEdge !== null && enhancement.targetLongEdge < sourceEdge)
          fail("VALIDATION_ERROR", "Enhancement never downsizes; pick a larger target.");
        if (enhancement.targetLongEdge !== null && enhancement.targetLongEdge > 8192)
          fail("VALIDATION_ERROR", "Enhancement target cannot exceed 8192px.");
      }
    }
    if (req.purpose === "region_edit") {
      const region =
        (req.params as GenerationParams & { region?: RegionEditParams }).region ??
        fail("VALIDATION_ERROR", "Region edit requires at least one region.");
      if (region.regionIds.length < 1)
        fail("VALIDATION_ERROR", "Region edit requires at least one region.");
      if (req.referenceAssetIds.length !== 1)
        fail("VALIDATION_ERROR", "Region edit requires exactly one source reference.");
      if (region.mode === "material_replace" && !region.material?.trim())
        fail("VALIDATION_ERROR", "Material replacement requires a material.");
      if (region.mode === "edit" && !region.instruction.trim())
        fail("VALIDATION_ERROR", "Region edit requires an instruction.");
      const selected = projectRegions(req.projectId, req.referenceAssetIds[0]);
      if (region.regionIds.some((id) => !selected.some((item) => item.id === id)))
        fail("VALIDATION_ERROR", "Every selected region must belong to the source asset.");
      const source =
        assets.find((item) => item.id === req.referenceAssetIds[0]) ??
        fail("NOT_FOUND", "Region source asset was not found.");
      const shapes = selected
        .filter((item) => region.regionIds.includes(item.id))
        .map((item) => item.shape);
      const nativeMask = Boolean(
        (model as ModelCapabilities & { supportsMask?: boolean }).supportsMask,
      );
      const mask = rasterizeMask(shapes, source.widthPx ?? 1, source.heightPx ?? 1);
      const coveragePct = maskCoveragePct(mask);
      const prompt = buildRegionEditPrompt({
        dna: { ...db.dna[req.projectId]!, scene: projectScene(req.projectId) },
        regions: selected,
        params: region,
        nativeMask,
        maskCoveragePct: coveragePct,
      });
      req.prompt.positivePrompt ||= prompt.positivePrompt;
      req.prompt.preservationInstructions ||= prompt.preservationInstructions;
      // Keep the rasterisation in the mock path so callers can inspect the same mask dimensions.
      void mask;
    }
    const validationRequest =
      req.purpose === "enhance" && enhance?.mode === "conservative"
        ? { ...req, prompt: { ...req.prompt, positivePrompt: "local upscale" } }
        : (req as GenerationSubmitRequest);
    const issues = validateGenerationRequest(validationRequest, model);
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
    req: RegionOrGenerationRequest,
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
      purpose: req.purpose as GenerationDTO["purpose"],
      status: "queued",
      prompt: req.prompt,
      referenceAssetIds: [...req.referenceAssetIds],
      params: req.params as GenerationParams,
      parentAssetId: req.prompt.metadata.interiorComposerVersion
        ? (req.prompt.shotIntent?.interiorGeneration?.input.assetId ?? null)
        : generationParentAssetId(req.referenceAssetIds, projectAssets(req.projectId)),
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

  const defaultLabel = (req: RegionOrGenerationRequest) => {
    const camera = req.cameraId
      ? db.dna[req.projectId]?.cameras.find((c) => c.id === req.cameraId)
      : undefined;
    return camera
      ? `${camera.name} — ${(PURPOSE_TITLES[req.purpose] ?? "Generation").toLowerCase()}`
      : (PURPOSE_TITLES[req.purpose] ?? "Generation");
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
      const provider = MOCK_PROVIDER_REGISTRY.find((p) => p.id === j.providerId);
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
    if (db.projects[j.projectId]?.archivedAt) {
      // Like Rust: the commit re-checks the project; archived mid-call → failed, no outputs.
      error = {
        kind: "interrupted",
        message: "The project was archived while this generation was running.",
        retryable: false,
      };
    } else if (/\[fail\]/i.test(prompt)) {
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
  const workflowRows = (projectId: string): WorkflowStepState[] =>
    DNA_STEP_IDS.map(
      (stepId) =>
        db.workflow![projectId]?.find((row) => row.stepId === stepId) ?? {
          stepId,
          status: "open",
          confirmedAt: null,
        },
    );

  // Resume queued/retrying jobs left from a previous session.
  if (jobs.some((j) => !isTerminal(j))) schedulePump();

  // LUT commands and grade_preview are served by `lutHandlers` above.
  const handlers: {
    [C in Exclude<CommandName, `lut_${string}` | "grade_preview">]: (
      req: Requests[C],
    ) => unknown | Promise<unknown>;
  } = {
    dna_assist: (req) => {
      getProject(req.projectId);
      const provider = getProvider("hhtech");
      if (!describeProvider(provider).configured)
        fail("PROVIDER_NOT_CONFIGURED", `${provider.label} needs an API key.`, {
          providerId: provider.id,
        });
      return {
        // ADR-042: a fixed, plausible analysis so the evidence board can be tried offline.
        raw: JSON.stringify(req.scope === "analysis" ? MOCK_ANALYSIS : { fields: [] }),
        modelId: "mock-assist",
        generationId: newId("GEN"),
      };
    },

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
      const inputScene = (req.dna as ProjectDNA & { scene?: SceneDNA }).scene;
      if (inputScene) (db.dna[id] as ProjectDNA & { scene?: SceneDNA }).scene = inputScene;
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

    workflow_get: (req) => {
      getProject(req.projectId);
      return { steps: workflowRows(req.projectId) };
    },

    workflow_confirm_step: (req) => {
      writable(req.projectId);
      try {
        const next = confirmStep(workflowRows(req.projectId), req.stepId, now());
        db.workflow![req.projectId] = next;
        save();
        return { steps: next };
      } catch (error) {
        fail("VALIDATION_ERROR", error instanceof Error ? error.message : String(error));
      }
    },

    workflow_reopen_step: (req) => {
      writable(req.projectId);
      try {
        const next = reopenStep(workflowRows(req.projectId), req.stepId);
        db.workflow![req.projectId] = next;
        save();
        return { steps: next };
      } catch (error) {
        fail("VALIDATION_ERROR", error instanceof Error ? error.message : String(error));
      }
    },

    region_list: (req) => {
      getProject(req.projectId);
      return projectRegions(req.projectId, req.assetId).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    },

    region_save: (req) => {
      writable(req.projectId);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "Region asset was not found in this project.");
      const scene = projectScene(req.projectId);
      if (req.region.objectId && !scene.objects.some((object) => object.id === req.region.objectId))
        fail("VALIDATION_ERROR", "The linked scene object does not exist in the project DNA.");
      const shape = req.region.shape as RegionShape;
      const numbers = JSON.stringify(shape);
      if (shape.type === "polygon" && shape.points.length < 3)
        fail("VALIDATION_ERROR", "A polygon region needs at least three points.");
      if (
        shape.type === "brush" &&
        shape.strokes.some((stroke) => stroke.points.length < 1 || stroke.radius < 0)
      )
        fail("VALIDATION_ERROR", "Brush strokes need points and a non-negative radius.");
      if (!numbers) fail("VALIDATION_ERROR", "Invalid region shape.");
      const t = now();
      const existing = req.region.id
        ? db.regions!.find((item) => item.id === req.region.id)
        : undefined;
      if (existing && (existing.projectId !== req.projectId || existing.assetId !== req.assetId))
        fail("NOT_FOUND", "Region was not found for this asset.");
      const saved: RegionDTO = existing
        ? { ...existing, ...req.region, id: existing.id, updatedAt: t }
        : {
            id: req.region.id ?? newRegionId(),
            projectId: req.projectId,
            assetId: req.assetId,
            label: req.region.label,
            kind: req.region.kind,
            objectId: req.region.objectId,
            shape,
            createdAt: t,
            updatedAt: t,
          };
      if (existing) Object.assign(existing, saved);
      else db.regions!.push(saved);
      save();
      return saved;
    },

    diagram_image_save: (req) => {
      writable(req.projectId);
      const parent = db.assets[req.parentAssetId];
      if (!parent || parent.projectId !== req.projectId)
        fail("NOT_FOUND", `Asset '${req.parentAssetId}' was not found.`);
      if (!["sheet", "frame"].includes(req.kind))
        fail("VALIDATION_ERROR", `Unknown diagram image kind '${req.kind}'.`);
      if (!req.pngBase64.startsWith("iVBOR"))
        fail("UNSUPPORTED_FILE", "A diagram image must be a PNG.");
      const parentAsset = parent as AssetDTO;
      const id = newId("AST");
      const t = now();
      const url = `data:image/png;base64,${req.pngBase64}`;
      const operation = req.kind === "sheet" ? "diagram_sheet" : "diagram_frame";
      db.assets[id] = {
        ...parentAsset,
        id,
        role: "regular_image",
        status: "ready",
        originalName: req.label,
        managedRelPath: `assets/original/${id}.png`,
        absolutePath: url,
        thumbnailPath: url,
        mimeType: "image/png",
        fileSizeBytes: Math.floor((req.pngBase64.length * 3) / 4),
        sha256: null,
        parentAssetId: parentAsset.id,
        operation,
        createdAt: t,
        updatedAt: t,
      };
      const parentVersion = db.versions.filter((v) => v.assetId === parentAsset.id).at(-1);
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: parentVersion?.id ?? null,
        label: req.label,
        operation,
        generationId: null,
        createdAt: t,
      });
      save();
      return db.assets[id];
    },

    diagram_ffmpeg_status: () =>
      options.ffmpeg
        ? { available: true, version: "ffmpeg version mock" }
        : { available: false, version: null },

    diagram_video_export: (req) => {
      writable(req.projectId);
      if (!options.ffmpeg)
        fail("INVALID_STATE", "FFmpeg is not installed or not on PATH.", {
          reason: "ffmpeg_missing",
        });
      if (!req.frames.length) fail("VALIDATION_ERROR", "A diagram video needs frames.");
      return {
        path: `mock://projects/${req.projectId}/exports/diagram_${newId("DGV")}.mp4`,
        durationMs: req.frames.reduce((sum, f) => sum + f.durationMs, 0),
        frameCount: req.frames.length,
      };
    },

    region_delete: (req) => {
      writable(req.projectId);
      const before = db.regions!.length;
      db.regions = db.regions!.filter(
        (item) => !(item.projectId === req.projectId && item.id === req.regionId),
      );
      if (db.regions!.length === before) fail("NOT_FOUND", "Region was not found.");
      save();
      return { deleted: true as const };
    },

    publication_list: (req) => {
      getProject(req.projectId);
      return (
        publications
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.projectId === req.projectId)
          // Newest first; ties keep the newest insertion first (the backend's rowid order).
          .sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt) || b.index - a.index)
          .map(({ item }) => item)
          .map((item) => ({
            id: item.id,
            projectId: item.projectId,
            title: item.publication.title,
            type: item.publication.type,
            paper: item.publication.paper,
            targetPageCount: item.publication.targetPageCount,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          }))
      );
    },

    publication_get: (req) => {
      getProject(req.projectId);
      return (
        publications.find(
          (item) => item.id === req.publicationId && item.projectId === req.projectId,
        ) ?? fail("NOT_FOUND", `Publication not found: ${req.publicationId}`)
      );
    },

    publication_save: (req) => {
      const parsed = PublicationDocumentSchema.safeParse({
        publication: req.publication,
        facts: req.facts,
      });
      if (!parsed.success || parsed.data.publication.pages.length === 0)
        fail("VALIDATION_ERROR", "The publication has invalid values and was not saved.", {
          fieldErrors: Object.fromEntries(
            (parsed.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]),
          ),
        });
      writable(req.projectId);
      const t = now();
      const existing = req.publicationId
        ? (publications.find(
            (item) => item.id === req.publicationId && item.projectId === req.projectId,
          ) ?? fail("NOT_FOUND", `Publication not found: ${req.publicationId}`))
        : null;
      const record: PublicationRecordDTO = {
        id: existing?.id ?? newId("PUB"),
        projectId: req.projectId,
        publication: parsed.data!.publication,
        facts: parsed.data!.facts,
        createdAt: existing?.createdAt ?? t,
        updatedAt: t,
      };
      if (existing) Object.assign(existing, record);
      else publications.push(record);
      save();
      return record;
    },

    publication_delete: (req) => {
      writable(req.projectId);
      const index = publications.findIndex(
        (item) => item.id === req.publicationId && item.projectId === req.projectId,
      );
      if (index < 0) fail("NOT_FOUND", `Publication not found: ${req.publicationId}`);
      publications.splice(index, 1);
      save();
      return { deleted: true as const };
    },

    publication_caption_draft: (req) => {
      writable(req.projectId);
      if (!req.prompt.trim()) fail("VALIDATION_ERROR", "The caption prompt is empty.");
      const p = getProvider(req.providerId);
      if (!MOCK_CHAT_PROVIDERS.includes(p.id))
        fail("VALIDATION_ERROR", `${p.label} does not offer text generation.`);
      if (!describeProvider(p).configured)
        fail("PROVIDER_NOT_CONFIGURED", `${p.label} needs an API key.`, { providerId: p.id });
      // Browser preview: no network call. One visible-feature sentence per listed slot.
      const slotIds = [...req.prompt.matchAll(/^- (\S+) \(page /gm)].map((m) => m[1]!);
      return {
        raw: JSON.stringify({
          slots: slotIds.map((slotId) => ({
            slotId,
            sentences: [{ text: "Ánh sáng tự nhiên trải đều qua không gian.", factRef: null }],
          })),
        }),
      };
    },

    publication_export_save: (req) => {
      getProject(req.projectId);
      if (req.files.length === 0) fail("VALIDATION_ERROR", "There is nothing to export.");
      // Browser preview: nothing is written; the paths only show what the app would create.
      const base = req.baseName.trim() || "publication";
      const ext = req.format === "jpeg" ? "jpg" : req.format;
      const paths =
        req.format === "pdf"
          ? [`mock-export://${base}.pdf`]
          : req.files.map(
              (_, index) => `mock-export://${base}-p${String(index + 1).padStart(2, "0")}.${ext}`,
            );
      return { saved: true, paths };
    },

    dna_get: (req) => {
      getProject(req.projectId);
      return db.dna[req.projectId];
    },

    dna_update: (req) => {
      const v = validateProjectDNA(req.dna);
      const parsedDna = v.ok
        ? v.dna
        : fail("VALIDATION_ERROR", "The design DNA has invalid values and was not saved.", {
            fieldErrors: v.fieldErrors,
          });
      writable(req.projectId);
      // Persist the same normalized aggregate that the Rust validator accepts. This keeps the
      // browser transport's round-trip semantics aligned with the real backend (including the
      // additive siteTopology refinement).
      db.dna[req.projectId] = JSON.parse(JSON.stringify(parsedDna)) as ProjectDNA;
      // ADR-016: anchors of cameras that no longer exist are dropped.
      const cameraIds = new Set(req.dna.cameras.map((c) => c.id));
      db.anchors = db.anchors!.filter(
        (x) => x.projectId !== req.projectId || cameraIds.has(x.cameraId),
      );
      refreshStatus(req.projectId);
      save();
      return publicProject(getProject(req.projectId));
    },

    grade_apply: (req) => {
      writable(req.projectId);
      const source = db.assets[req.assetId];
      if (!source || source.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      const sourceAsset = source as AssetDTO;
      if (sourceAsset.status !== "ready" || !sourceAsset.mimeType?.startsWith("image/"))
        fail("INVALID_STATE", "Only a ready image asset can be graded.");
      const grade = req.grade ?? neutralGrade();
      const id = newId("AST");
      const t = now();
      const url = placeholderSvg(
        sourceAsset.widthPx ?? 1024,
        sourceAsset.heightPx ?? 768,
        `${req.label ?? "Color grade"} · ${id.slice(-6)}`,
        "grade",
        JSON.stringify(grade).length,
      );
      db.assets[id] = {
        ...sourceAsset,
        id,
        source: sourceAsset.source,
        role: "regular_image",
        originalName: `${sourceAsset.originalName ?? id} · ${req.label ?? "Color grade"}`,
        managedRelPath: `assets/graded/${id}.svg`,
        absolutePath: url,
        thumbnailPath: url,
        fileSizeBytes: url.length,
        parentAssetId: sourceAsset.id,
        operation: "color_grade",
        createdAt: t,
        updatedAt: t,
      };
      const parentVersion = db.versions.filter((v) => v.assetId === sourceAsset.id).at(-1);
      db.versions.push({
        id: newId("VER"),
        projectId: req.projectId,
        assetId: id,
        parentVersionId: parentVersion?.id ?? null,
        label: req.label ?? "Color grade",
        operation: "color_grade",
        generationId: null,
        createdAt: t,
      });
      save();
      return db.assets[id];
    },

    asset_preview: async (req) => {
      getProject(req.projectId);
      const source = db.assets[req.assetId];
      const sourceAsset = source ?? fail("NOT_FOUND", "Asset not found in this project.");
      if (sourceAsset.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      if (sourceAsset.status !== "ready" || !sourceAsset.mimeType?.startsWith("image/"))
        fail("INVALID_STATE", "Only a ready image asset can be previewed.");
      const response = await fetch(sourceAsset.absolutePath);
      if (!response.ok) fail("IO_ERROR", "The source image is not available.");
      return response.blob();
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

    asset_download: () => [],
    asset_list: (req) => {
      getProject(req.projectId);
      return projectAssets(req.projectId);
    },

    asset_update_role: (req) => {
      writable(req.projectId);
      const asset = db.assets[req.assetId];
      if (!asset || asset.projectId !== req.projectId)
        fail("NOT_FOUND", "Asset not found in this project.");
      if (req.role !== "regular_image" && isVideoAsset(asset!))
        fail("VALIDATION_ERROR", VIDEO_ROLE_ERROR);
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
      const asset = req.assetId ? db.assets[req.assetId] : undefined;
      if (asset && isVideoAsset(asset)) fail("VALIDATION_ERROR", VIDEO_ROLE_ERROR);
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
      db.regions = db.regions!.filter(
        (region) => !(region.projectId === req.projectId && region.assetId === req.assetId),
      );
      db.versions = db.versions.filter((v) => v.assetId !== req.assetId);
      db.anchors = db.anchors!.filter((x) => x.assetId !== req.assetId);
      refreshStatus(req.projectId);
      save();
      return { assetId: req.assetId, fileCleanupWarning: null };
    },

    version_list: (req) => db.versions.filter((v) => v.projectId === req.projectId),

    provider_list: () => MOCK_PROVIDER_REGISTRY.map(describeProvider),

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

    prompt_enhance: (req) => {
      getProject(req.projectId);
      const text = req.text.trim();
      if (!text) fail("VALIDATION_ERROR", "Write a prompt first; there is nothing to enhance.");
      const p = getProvider(req.providerId);
      if (!MOCK_CHAT_PROVIDERS.includes(p.id))
        fail("VALIDATION_ERROR", `${p.label} does not offer prompt enhancement.`);
      if (!describeProvider(p).configured)
        fail("PROVIDER_NOT_CONFIGURED", `${p.label} needs an API key.`, { providerId: p.id });
      return { text: mockEnhance(text, req.context) };
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
      // Like Rust: the gate's fresh verdict replaces the stored one before validation.
      const v = req.validation;
      const request = v
        ? {
            ...j.request,
            prompt: {
              ...j.request.prompt,
              validation: v,
              ...(v.approvedExceptions.length || j.request.prompt.resolvedWarnings !== undefined
                ? { resolvedWarnings: [...v.approvedExceptions] }
                : {}),
            },
          }
        : j.request;
      validateRequest(request);
      const copy = enqueue(request, { batchId: j.batchId, label: j.label, priority: j.priority });
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

    // ---- ADR-041: branch canvas node positions (mirrors services/canvas_layouts.rs)
    canvas_layout_get: (req) => {
      getProject(req.projectId);
      const row = db.canvasLayouts?.[req.projectId];
      return {
        projectId: req.projectId,
        layout: row?.layout ?? { version: 1 as const, positions: {} },
        ...(row ? { updatedAt: row.updatedAt } : {}),
      };
    },

    canvas_layout_save: (req) => {
      const parsed = CanvasLayoutSchema.safeParse(req.layout);
      if (!parsed.success) fail("VALIDATION_ERROR", "The canvas layout is invalid.");
      writable(req.projectId);
      const row = { layout: parsed.data!, updatedAt: now() };
      (db.canvasLayouts ??= {})[req.projectId] = row;
      save();
      return { projectId: req.projectId, layout: row.layout, updatedAt: row.updatedAt };
    },

    // ---- ADR-040: my presets (mirrors services/user_presets.rs)
    user_preset_list: () =>
      [...userPresets].sort(
        (a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      ),

    user_preset_save: (req) => {
      const name = req.name.trim();
      if (!name) fail("VALIDATION_ERROR", "Give the preset combination a name.");
      if ([...name].length > USER_PRESET_NAME_MAX)
        fail("VALIDATION_ERROR", `The name is longer than ${USER_PRESET_NAME_MAX} characters.`);
      const ids: string[] = [];
      for (const id of req.presetIds) {
        if (!/^[a-z0-9._]{1,64}$/.test(id))
          fail("VALIDATION_ERROR", `'${id}' is not a valid preset id.`);
        if (!ids.includes(id)) ids.push(id);
      }
      if (!ids.length)
        fail("VALIDATION_ERROR", "Select at least one preset before saving the combination.");
      if (ids.length > 24) fail("VALIDATION_ERROR", "A combination holds at most 24 presets.");
      const t = now();
      if (req.id) {
        const existing =
          userPresets.find((p) => p.id === req.id) ??
          fail("NOT_FOUND", `Saved preset '${req.id}' was not found.`);
        Object.assign(existing, { name, presetIds: ids, updatedAt: t });
        save();
        return existing;
      }
      const created: UserPresetDTO = {
        id: newId("UPR"),
        name,
        presetIds: ids,
        createdAt: t,
        updatedAt: t,
      };
      userPresets.push(created);
      save();
      return created;
    },

    user_preset_delete: (req) => {
      const index = userPresets.findIndex((p) => p.id === req.id);
      if (index < 0) fail("NOT_FOUND", `Saved preset '${req.id}' was not found.`);
      userPresets.splice(index, 1);
      save();
      return { deleted: true as const };
    },

    // ---- ADR-040: SketchUp inbox (mirrors services/sketchup_inbox.rs)
    sketchup_inbox_list: () => ({
      path: MOCK_INBOX_PATH,
      entries: [...(db.sketchupInbox ?? [])].reverse().map((view) => ({
        fileName: view.fileName,
        absolutePath: VIEWPORT_PLACEHOLDER,
        sizeBytes: 1024,
        ...(view.scene ? { scene: view.scene } : {}),
        ...(view.model ? { model: view.model } : {}),
        ...(view.width ? { width: view.width } : {}),
        ...(view.height ? { height: view.height } : {}),
        ...(view.capturedAt ? { capturedAt: view.capturedAt } : {}),
      })),
    }),

    sketchup_inbox_import: (req) => {
      if (!req.fileNames.length) fail("VALIDATION_ERROR", "Pick at least one view to import.");
      writable(req.projectId);
      const inbox = (db.sketchupInbox ??= []);
      const views = req.fileNames.map((name) => {
        if (!/^[^/\\]+\.png$/i.test(name) || name.includes(".."))
          fail("VALIDATION_ERROR", `'${name}' is not a view in the SketchUp inbox.`);
        return (
          inbox.find((v) => v.fileName === name) ??
          fail("NOT_FOUND", `SketchUp view '${name}' was not found.`)
        );
      });
      const result = { assets: [] as AssetDTO[], duplicates: 0 };
      for (const view of views) {
        const sha256 = `sketchup-${view.fingerprint}`;
        const existing = projectAssets(req.projectId).find((a) => a.sha256 === sha256);
        if (existing) {
          result.duplicates++;
          result.assets.push(existing);
        } else {
          const id = newId("AST");
          const t = now();
          db.assets[id] = {
            id,
            projectId: req.projectId,
            source: "sketchup",
            role: "structure_sketch",
            status: "ready",
            originalName: view.fileName,
            managedRelPath: `assets/original/${id}.png`,
            absolutePath: VIEWPORT_PLACEHOLDER,
            thumbnailPath: VIEWPORT_PLACEHOLDER,
            mimeType: "image/png",
            fileSizeBytes: 1024,
            widthPx: view.width ?? 1920,
            heightPx: view.height ?? 1080,
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
            label: view.fileName,
            operation: "import",
            generationId: null,
            createdAt: t,
          });
          result.assets.push(db.assets[id]!);
        }
        inbox.splice(inbox.indexOf(view), 1);
        (db.sketchupImported ??= []).push(view.fileName);
      }
      save();
      return result;
    },
  };

  const transport: Transport = async (command, args) => {
    const lutHandler = lutHandlers[command as string];
    if (lutHandler) return structuredClone(await lutHandler(args.request));
    const handler = handlers[command as keyof typeof handlers] as (req: unknown) => unknown;
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

/**
 * Deterministic stand-in for the chat model: the user's text plus fixed detail, and a note
 * that only compatible DNA context is used (the real backend sends it to the model).
 */
export function mockEnhance(text: string, context: string): string {
  const base = text.trim().replace(/[.\s]+$/, "");
  const keep = context.trim() ? " Uses only compatible Project DNA context." : "";
  return `${base}, with crisp material detail, soft directional daylight, eye-level camera with a 35 mm lens and a calm atmosphere.${keep}`;
}

function outputSize(aspectRatio: string | null, parent: AssetDTO | undefined): [number, number] {
  const LONG = 1024;
  let ratio = 4 / 3;
  const m = aspectRatio?.match(/^(\d+):(\d+)$/);
  if (m) ratio = Number(m[1]) / Number(m[2]);
  else if (parent?.widthPx && parent.heightPx) ratio = parent.widthPx / parent.heightPx;
  return ratio >= 1 ? [LONG, Math.round(LONG / ratio)] : [Math.round(LONG * ratio), LONG];
}

function enhanceOutputSize(
  enhance: Pick<EnhanceParams, "targetLongEdge" | "upscale">,
  parent: AssetDTO | undefined,
): [number, number] {
  const sourceW = parent?.widthPx ?? 1024;
  const sourceH = parent?.heightPx ?? 768;
  if (enhance.upscale) {
    const size = resolveUpscaleSize(
      { width: sourceW, height: sourceH },
      enhance.upscale.target,
      enhance.upscale.ifAlreadyLarger,
    );
    return [size.canvasWidth, size.canvasHeight];
  }
  const target = enhance.targetLongEdge ?? Math.max(sourceW, sourceH);
  const scale = target / Math.max(sourceW, sourceH);
  return [Math.max(1, Math.round(sourceW * scale)), Math.max(1, Math.round(sourceH * scale))];
}

/**
 * The mock's stand-in for the Rust local check (ADR-035): sizes are exact and nothing moves,
 * so only the review reasons that depend on the request are reported.
 */
function mockEnhanceCheck(
  enhance: EnhanceParams,
  parent: AssetDTO | undefined,
  [width, height]: [number, number],
): EnhanceCheck {
  const mode = enhance.preservationMode ?? "strict";
  const source = { width: parent?.widthPx ?? 1024, height: parent?.heightPx ?? 768 };
  const size = enhance.upscale
    ? resolveUpscaleSize(source, enhance.upscale.target, enhance.upscale.ifAlreadyLarger)
    : null;
  const reasons: EnhanceCheck["reasons"] = [];
  if (mode !== "strict" && !enhance.allowedRegionIds?.length) reasons.push("no_allowed_region");
  if (mode === "creative") reasons.push("creative_review");
  const masked = mode !== "strict" && !!enhance.allowedRegionIds?.length;
  return {
    id: newId("ECK"),
    version: "ec-1.0.0",
    preservationMode: mode,
    status: reasons.length ? "warn" : "pass",
    reasons,
    expectedSize: { width, height },
    actualSize: { width, height },
    content: {
      x: size?.offsetX ?? 0,
      y: size?.offsetY ?? 0,
      width: size?.width ?? width,
      height: size?.height ?? height,
    },
    aspectDelta: 0,
    registration: { dx: 0, dy: 0, shiftPx: 0 },
    lockedSsim: mode === "strict" || masked ? 0.995 : null,
    lockedPct: mode === "strict" ? 100 : masked ? 50 : 0,
    edgeDelta: mode === "strict" ? 0 : null,
    composited: masked,
    sizeAction: size && size.action !== "skip" ? size.action : "upscale",
  };
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
