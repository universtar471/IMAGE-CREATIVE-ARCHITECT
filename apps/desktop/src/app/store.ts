/**
 * App state (zustand). Holds view state plus the open project's loaded data.
 * Persistence happens only through bridge commands; this store never owns truth for long:
 * after every command it adopts what the backend returned.
 *
 * Phase 3: every generation runs as a backend job (ADR-017). Submitting returns a `queued`
 * generation; progress arrives through `job://updated` / `generation://updated` events
 * (`startBackendSync`) and `job_list` refreshes, which keep `jobs` and the open project's
 * history, assets and status current.
 *
 * Never put an API key here: provider state is the descriptor only (configured / key source).
 */
import { create } from "zustand";
import {
  GENERATION_UPDATED_EVENT,
  hasEffects,
  JOB_UPDATED_EVENT,
  orderReferenceIds,
  TERMINAL_JOB_STATUSES,
  validateProjectDNA,
  type AppErrorCode,
  type AssetDTO,
  type BatchCreateRequest,
  type BatchDTO,
  type CameraAnchorDTO,
  type CameraDNA,
  type ConflictCode,
  type DnaStepId,
  type GenerationDTO,
  type GenerationParams,
  type GenerationPurpose,
  type GenerationSubmitRequest,
  type JobDTO,
  type ProjectDNA,
  type ProjectDTO,
  type PromptBundle,
  type ProviderDescriptorDTO,
  type ColorGradeDNA,
  type ShotValidation,
  type ShotIntent,
} from "@arch/domain";
import {
  BridgeError,
  call,
  fieldErrorsOf,
  providerNeedingKey,
  subscribe,
  toBridgeError,
  type WorkflowDTO,
} from "../lib/bridge";
import { deriveWorkflow, type DerivedWorkflow } from "../lib/workflow";
import { setIn } from "../lib/path";
import { t } from "../i18n";
import { errorHeadline } from "../i18n/domain";
import type { ModuleId, TrayTabId } from "../features/workspace/modules";
import { isActiveGeneration } from "../features/generate/labels";
import { withExtraPrompt } from "../features/generate/extraPrompt";
import { compileFromBundle } from "./services";
import {
  checkShot,
  conflictOf,
  gateBatch,
  validationSnapshot,
  withValidation,
} from "../features/validation/gate";
import { clearShotIntent, loadShotIntent, saveShotIntent } from "../lib/shotIntentStorage";
import { nodeSelectionModule, type WorkspaceMode } from "../features/selection/selection";
import { EMPTY_VIDEO_DRAFT, type VideoDraft } from "../features/video/video";

export type Route = { name: "hub" } | { name: "workspace"; projectId: string };
/** `director` = Camera Director (Camera module); `contact` = Contact Sheet. */
export type NodeViewport = { x: number; y: number; zoom: number };

/**
 * Large viewer: an ordered set of assets the user can step through (only that set, one
 * project), the shown index, and an optional image to compare the shown one with.
 */
export type ViewerState = { assetIds: string[]; index: number; compareWithId?: string | null };

export const WORKSPACE_MODE_KEY = "arch.workspaceMode";

function readWorkspaceMode(): WorkspaceMode {
  try {
    return globalThis.localStorage?.getItem(WORKSPACE_MODE_KEY) === "node" ? "node" : "studio";
  } catch {
    return "studio";
  }
}

function writeWorkspaceMode(mode: WorkspaceMode) {
  try {
    globalThis.localStorage?.setItem(WORKSPACE_MODE_KEY, mode);
  } catch {
    /* session-only preference */
  }
}

type CenterView = "canvas" | "prompt" | "director" | "contact" | "branches";
export type SaveStatus = "saved" | "dirty" | "saving" | "invalid" | "error";

export type SaveState = {
  status: SaveStatus;
  message?: string;
  fieldErrors: Record<string, string>;
};

export type Toast = {
  id: number;
  kind: "info" | "success" | "warning" | "error";
  message: string;
  /** Translated headline shown above `message` (errors: the original backend text). */
  title?: string;
};

export type WorkspaceData = {
  project: ProjectDTO;
  persistedDna: ProjectDNA;
  draftDna: ProjectDNA;
  assets: AssetDTO[];
  /** Generation history, newest first (generation_list + events). */
  generations: GenerationDTO[];
  /** Approved anchor images per anchor-view camera (ADR-016). */
  anchors: CameraAnchorDTO[];
  /** Batches of this project, newest first. */
  batches: BatchDTO[];
  workflow?: WorkflowDTO;
  /**
   * The project's current per-shot choices (ADR-036: scene objects, …). Never part of the
   * DNA; kept per project (also across restarts, in `localStorage`) and snapshotted into
   * each submitted prompt.
   */
  shotIntent?: ShotIntent;
};

/**
 * What the user changed in the Generate panel. `null` = use the default derived from the
 * provider/model capabilities and the project's assets (see features/generate/form.ts).
 */
export type GenerateDraft = {
  source: "dna" | "sketch";
  providerId: string | null;
  modelId: string | null;
  purpose: GenerationPurpose | null;
  params: GenerationParams | null;
  referenceAssetIds: string[] | null;
  /** Free text appended to the DNA-compiled positive prompt at submit (Generate panel). */
  extraPrompt?: string;
  /** WARN conflict codes the user accepted for this shot; cleared when the extra prompt changes. */
  approvedExceptions?: ConflictCode[];
};

export const EMPTY_GENERATE_DRAFT: GenerateDraft = {
  source: "dna",
  providerId: null,
  modelId: null,
  purpose: null,
  params: null,
  referenceAssetIds: null,
};

/**
 * The Generate panel's own submission, tagged with its project. `submitting` covers the
 * DNA flush, prompt compile and enqueue; afterwards the generation is `tracking` and its
 * snapshot is kept current by events until it finishes.
 */
export type GenerationRun =
  | { status: "submitting"; projectId: string; providerId: string; startedAt: number }
  | { status: "tracking"; projectId: string; generation: GenerationDTO }
  | {
      status: "error";
      projectId: string;
      code: AppErrorCode;
      message: string;
      /** Set when the provider has no API key: the UI offers "Set API key". */
      needsKeyFor: string | null;
      /** Set when the conflict gate refused the submit (nothing was sent). */
      validation?: ShotValidation;
    };

export type GenerationInput = Omit<GenerationSubmitRequest, "prompt" | "cameraId"> & {
  cameraId?: string | null;
  /**
   * Appended to the compiled positive prompt after the conflict gate checked it. With a
   * `prompt` passed it is only checked, never appended.
   */
  extraPrompt?: string;
  /** WARN conflict codes the user accepted for this shot (ADR-034). */
  approvedExceptions?: readonly ConflictCode[];
  shotIntent?: ShotIntent;
};

/**
 * A retry the conflict gate refused (ADR-034): the stored snapshot, checked against the
 * CURRENT DNA, is now BLOCK, or raises a WARN that was not accepted before. Nothing was sent;
 * the retry dialog shows the issues and resends with the newly accepted codes.
 */
export type RetryConflict = { jobId: string; label: string; validation: ShotValidation };

type State = {
  route: Route;
  workspace: WorkspaceData | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  activeModule: ModuleId;
  centerView: CenterView;
  selectedAssetId: string | null;
  /** Studio (asset-centred) or Node (branch graph) workspace (ADR-044); remembered per device. */
  workspaceMode: WorkspaceMode;
  /** Selected graph node ids in Node mode (`asset:<id>`, `gen:<id>`, `draft`). */
  canvasSelection: string[];
  /** Node Canvas pan/zoom per project, this session only (never in ProjectDNA). */
  nodeViewport: Record<string, NodeViewport>;
  /** Large media viewer (lightbox); null = closed. Its own zoom never leaves the viewer. */
  viewer: ViewerState | null;
  selectedCameraId: string | null;
  /** Batch shown on the Contact Sheet; null = the newest. */
  contactBatchId: string | null;
  trayTab: TrayTabId;
  trayCollapsed: boolean;
  /** Inspector drawer open (only used when the layout makes the inspector a drawer). */
  inspectorOpen: boolean;
  save: SaveState;
  toasts: Toast[];
  /** Bumped whenever persisted project data changes (prompt preview, hub refresh). */
  dataRevision: number;
  /** Provider descriptors (never keys). null until loaded. */
  providers: ProviderDescriptorDTO[] | null;
  providersError: string | null;
  /** Provider settings dialog; `focus` = provider to highlight. */
  providerDialog: { focus: string | null } | null;
  generateDraft: GenerateDraft;
  videoDraft: VideoDraft;
  run: GenerationRun | null;
  /** The exact enhance submission whose completed output may be auto-selected. */
  enhanceSubmission: { projectId: string; generationId: string } | null;
  /** Jobs of every project (job_list(null) + events), newest first. */
  jobs: JobDTO[];
  workflowView: DerivedWorkflow | null;
  /** Retries refused by the conflict gate, waiting for "Duyệt ngoại lệ" or a fix. */
  retryConflicts: RetryConflict[];

  openProject: (projectId: string) => Promise<void>;
  goToHub: () => Promise<void>;
  setModule: (id: ModuleId) => void;
  setCenterView: (v: CenterView) => void;
  /** `keepView`: select without leaving the current centre view (graph clicks). */
  selectAsset: (id: string | null, options?: { keepView?: boolean }) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setCanvasSelection: (ids: string[]) => void;
  setNodeViewport: (projectId: string, viewport: NodeViewport) => void;
  openViewer: (viewer: ViewerState) => void;
  closeViewer: () => void;
  selectCamera: (id: string | null) => void;
  setTrayTab: (t: TrayTabId) => void;
  toggleTray: () => void;
  setInspectorOpen: (open: boolean) => void;
  editDna: (path: string, value: unknown) => void;
  /** Replace the camera list (add / delete / duplicate / reorder). */
  setCameras: (cameras: CameraDNA[]) => void;
  /** Replace the open project's shot intent (`undefined` clears it). Never touches the DNA. */
  setShotIntent: (shotIntent: ShotIntent | undefined) => void;
  flushDna: () => Promise<boolean>;
  adoptProject: (p: ProjectDTO) => void;
  /**
   * Adopt an asset list returned for `projectId`; ignored when another project is open.
   * Also refreshes the project (master/status may change).
   */
  adoptAssets: (projectId: string, assets: AssetDTO[]) => Promise<void>;
  notify: (kind: Toast["kind"], message: string, title?: string) => void;
  /** Error toast: translated headline for the error code + the original message. */
  notifyError: (err: unknown) => void;
  dismissToast: (id: number) => void;
  loadProviders: () => Promise<void>;
  adoptProvider: (p: ProviderDescriptorDTO) => void;
  openProviderDialog: (focus?: string | null) => void;
  closeProviderDialog: () => void;
  setGenerateDraft: (patch: Partial<GenerateDraft>) => void;
  setVideoDraft: (patch: Partial<VideoDraft>) => void;
  /** Load a past generation's provider/model/params/references into the Generate panel. */
  reuseGeneration: (g: GenerationDTO) => void;
  refreshGenerations: () => Promise<void>;
  /**
   * Enqueue one generation. Without `prompt`, DNA is flushed and the prompt is compiled
   * from one persisted snapshot of the project with exactly the chosen references
   * (ADR-008). With `prompt`, that request snapshot is resent unchanged.
   * Resolves to the `queued` generation.
   */
  submitGeneration: (
    input: GenerationInput,
    prompt?: PromptBundle,
  ) => Promise<GenerationDTO | undefined>;
  /** Retry a failed/cancelled/interrupted generation (job_retry; resubmit for Phase 2 rows). */
  retryGeneration: (g: GenerationDTO) => Promise<GenerationDTO | undefined>;
  refreshJobs: () => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  /**
   * Retry a finished job. The stored snapshot is re-validated against the current DNA first:
   * BLOCK is refused, a WARN not accepted before (nor in `approvedExceptions`) asks again
   * through `retryConflicts`. The fresh verdict goes to `job_retry` with the request.
   */
  retryJob: (
    jobId: string,
    options?: { approvedExceptions?: readonly ConflictCode[] },
  ) => Promise<JobDTO | undefined>;
  dismissRetryConflicts: () => void;
  /**
   * Queue a batch. Every item passes the conflict gate first (ADR-034): items that are not
   * ALLOW are skipped and reported; nothing is sent when no item is left.
   */
  createBatch: (
    request: BatchCreateRequest,
    options?: { approvedExceptions?: readonly ConflictCode[] },
  ) => Promise<BatchDTO | undefined>;
  applyGrade: (grade: ColorGradeDNA, label?: string) => Promise<AssetDTO | undefined>;
  refreshBatches: () => Promise<void>;
  showContactSheet: (batchId: string | null) => void;
  setAnchor: (cameraId: string, assetId: string) => Promise<boolean>;
  clearAnchor: (cameraId: string) => Promise<boolean>;
  refreshWorkflow: () => Promise<void>;
  confirmWorkflowStep: (stepId: DnaStepId) => Promise<boolean>;
  reopenWorkflowStep: (stepId: DnaStepId) => Promise<boolean>;
  /** Apply one backend event (also used by tests). */
  applyJobEvent: (job: JobDTO) => void;
  applyGenerationEvent: (g: GenerationDTO) => void;
};

export const AUTOSAVE_DELAY_MS = 700;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<boolean> | null = null;
let toastSeq = 0;
/** Generation events seen per project; openProject reloads when one arrives mid-load. */
const eventRevision = new Map<string, number>();
/** Increments per provider_list request and per Save/Clear, so stale lists are dropped. */
let providerRevision = 0;
/**
 * Stale-poll protection for `job_list` / `generation_list`. `syncSeq` counts every job or
 * generation adopted from an event or command result; `seenAt` records that count per id.
 * A poll remembers `syncSeq` when it starts and never overrides an item adopted later.
 * `*ListRequest` tokens drop a poll answered after a newer poll of the same list.
 */
let syncSeq = 0;
const jobSeenAt = new Map<string, number>();
const generationSeenAt = new Map<string, number>();
let jobListRequest = 0;
let generationListRequest = 0;

const SAVED: SaveState = { status: "saved", fieldErrors: {} };

const byNewest = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

function upsert<T extends { id: string; createdAt: string }>(list: readonly T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) {
    const next = [...list];
    next[i] = item;
    return next;
  }
  return [item, ...list].sort(byNewest);
}

export const isTerminalJob = (j: Pick<JobDTO, "status">) =>
  TERMINAL_JOB_STATUSES.includes(j.status);

/**
 * Merge a polled list into the current one. An item adopted from an event after the poll
 * started (`seenAt > since`) keeps its current value, and a finished item never goes back
 * to an active status (jobs and generations never leave a terminal status). Items the poll
 * does not list are dropped unless they arrived after it started.
 */
function mergePolled<T extends { id: string; createdAt: string }>(
  current: readonly T[],
  polled: readonly T[],
  seenAt: ReadonlyMap<string, number>,
  since: number,
  isFinished: (item: T) => boolean,
): T[] {
  const byId = new Map(current.map((x) => [x.id, x]));
  const newer = (id: string) => (seenAt.get(id) ?? -1) > since;
  const merged = polled.map((p) => {
    const cur = byId.get(p.id);
    if (!cur) return p;
    if (newer(p.id) || (isFinished(cur) && !isFinished(p))) return cur;
    return p;
  });
  const listed = new Set(polled.map((p) => p.id));
  for (const cur of current) if (!listed.has(cur.id) && newer(cur.id)) merged.push(cur);
  return merged.sort(byNewest);
}

/** Reference IDs in submit order, from one snapshot; a missing reference is an error. */
function resolveReferenceIds(ids: readonly string[], assets: readonly AssetDTO[]): string[] {
  if (new Set(ids).size !== ids.length)
    throw new BridgeError({ code: "VALIDATION_ERROR", message: t("store.referenceTwice") });
  for (const id of ids) {
    const a = assets.find((x) => x.id === id);
    if (!a)
      throw new BridgeError({
        code: "VALIDATION_ERROR",
        message: t("store.referenceGone"),
      });
    if (a.status !== "ready")
      throw new BridgeError({
        code: "INVALID_STATE",
        message: t("store.referenceFileMissing", { name: a.originalName ?? id }),
      });
  }
  return ids.slice();
}

export const useStudio = create<State>((set, get) => {
  const isOpen = (projectId: string) => get().workspace?.project.id === projectId;
  /**
   * Per-project shot intents of this session (a cache over `localStorage`, which keeps them
   * across restarts); reopening a project restores its choices.
   */
  const shotIntents = new Map<string, ShotIntent>();
  const shotIntentOf = (projectId: string) => {
    const cached = shotIntents.get(projectId);
    if (cached) return cached;
    const stored = loadShotIntent(projectId);
    if (stored) shotIntents.set(projectId, stored);
    return stored;
  };

  /** The saved DNA + type the conflict gate checks (the open project's, else loaded). */
  const persistedProject = async (projectId: string) => {
    const ws = get().workspace;
    if (ws && ws.project.id === projectId)
      return { dna: ws.persistedDna, projectType: ws.project.projectType };
    const bundle = await call("project_get", { projectId });
    return { dna: bundle.dna, projectType: bundle.project.projectType };
  };

  /**
   * ADR-034: a retry resends a stored snapshot, so it passes the gate again against the
   * CURRENT DNA with the shot intent it was compiled with. WARN codes accepted for the
   * original submit stay recorded. New findings are advisory and included in the retry snapshot.
   * Null when the job is unknown here (the backend then reports it).
   */
  const revalidateRetry = async (jobId: string, accepted: readonly ConflictCode[]) => {
    const job =
      get().jobs.find((j) => j.id === jobId) ??
      (await call("job_list", { projectId: null })).find((j) => j.id === jobId);
    if (!job) return null;
    const generation = await call("generation_get", {
      projectId: job.projectId,
      generationId: job.generationId,
    });
    const project = await persistedProject(job.projectId);
    const before = (generation.prompt.validation?.approvedExceptions ?? []) as ConflictCode[];
    const validation = checkShot({
      ...project,
      cameraId: generation.cameraId,
      shotIntent: generation.prompt.shotIntent,
      approvedExceptions: [...before, ...accepted],
    });
    return validation;
  };

  /** Refresh assets + project after outputs land (ignored if another project is open). */
  const reloadAssets = async (projectId: string) => {
    const assets = await call("asset_list", { projectId }).catch(() => null);
    if (assets) await get().adoptAssets(projectId, assets);
  };

  /** Notify and select outputs when the tracked generation finishes. */
  const onTrackedFinished = (g: GenerationDTO) => {
    if (g.status === "completed") {
      const n = g.outputAssetIds.length;
      const video = g.purpose === "video";
      get().notify(
        "success",
        video ? t("store.videoFinished") : t("store.generationFinished", { count: n }),
      );
      const first = g.outputAssetIds[0];
      const module = get().activeModule;
      if (first && isOpen(g.projectId) && module === (video ? "video" : "generate")) {
        set({ selectedAssetId: first, centerView: "canvas" });
      }
    } else if (g.status === "failed" || g.status === "interrupted") {
      get().notify(
        "error",
        g.error?.message ?? t("common.unknownError"),
        t("store.generationFailed"),
      );
    }
  };

  return {
    route: { name: "hub" },
    workspace: null,
    workspaceLoading: false,
    workspaceError: null,
    activeModule: "overview",
    centerView: "canvas",
    selectedAssetId: null,
    workspaceMode: readWorkspaceMode(),
    canvasSelection: [],
    nodeViewport: {},
    viewer: null,
    selectedCameraId: null,
    contactBatchId: null,
    trayTab: "assets",
    trayCollapsed: false,
    inspectorOpen: false,
    save: SAVED,
    toasts: [],
    dataRevision: 0,
    providers: null,
    providersError: null,
    providerDialog: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    videoDraft: EMPTY_VIDEO_DRAFT,
    run: null,
    enhanceSubmission: null,
    jobs: [],
    workflowView: null,
    retryConflicts: [],

    openProject: async (projectId) => {
      set({
        route: { name: "workspace", projectId },
        workspace: null,
        workspaceLoading: true,
        workspaceError: null,
        activeModule: "overview",
        centerView: "canvas",
        selectedAssetId: null,
        canvasSelection: [],
        viewer: null,
        selectedCameraId: null,
        contactBatchId: null,
        save: SAVED,
        generateDraft: EMPTY_GENERATE_DRAFT,
        videoDraft: EMPTY_VIDEO_DRAFT,
        enhanceSubmission: null,
        workflowView: null,
      });
      if (!get().providers) void get().loadProviders();
      const stillWanted = () => {
        const route = get().route;
        return route.name === "workspace" && route.projectId === projectId;
      };
      const secondary = <T>(what: string, p: Promise<T>, fallback: T) =>
        p.catch((err: unknown) => {
          get().notify("error", toBridgeError(err).message, what);
          return fallback;
        });
      try {
        // A generation event during the load means the snapshot may predate it: reload.
        for (let attemptNo = 0; ; attemptNo++) {
          const revision = eventRevision.get(projectId) ?? 0;
          const [bundle, generations, anchors, batches, workflow] = await Promise.all([
            call("project_get", { projectId }),
            // Secondary data must not block opening the project.
            secondary(
              t("store.historyUnavailable"),
              call("generation_list", { projectId }),
              [] as GenerationDTO[],
            ),
            secondary(t("store.anchorsUnavailable"), call("camera_anchor_list", { projectId }), []),
            secondary(t("store.batchesUnavailable"), call("batch_list", { projectId }), []),
            secondary(t("store.workflowUnavailable"), call("workflow_get", { projectId }), {
              steps: [],
            }),
          ]);
          if (!stillWanted()) return;
          if ((eventRevision.get(projectId) ?? 0) !== revision && attemptNo < 3) continue;
          set({
            workspace: {
              project: bundle.project,
              persistedDna: bundle.dna,
              draftDna: bundle.dna,
              assets: bundle.assets,
              generations: [...generations].sort(byNewest),
              anchors,
              batches,
              workflow,
              shotIntent: shotIntentOf(projectId),
            },
            selectedAssetId: bundle.project.activeMasterAssetId ?? bundle.assets[0]?.id ?? null,
            selectedCameraId: bundle.dna.cameras[0]?.id ?? null,
            workspaceLoading: false,
            workflowView: deriveWorkflow(workflow.steps, {
              masterApproved: ["master_approved", "anchor_generation", "production"].includes(
                bundle.project.status,
              ),
              anchorCameraIds: bundle.dna.cameras
                .filter((camera) => camera.isAnchorView)
                .map((camera) => camera.id),
              cameraIds: bundle.dna.cameras.map((camera) => camera.id),
              approvedAnchorCameraIds: anchors.map((anchor) => anchor.cameraId),
            }),
          });
          return;
        }
      } catch (err) {
        if (stillWanted())
          set({ workspaceLoading: false, workspaceError: toBridgeError(err).message });
      }
    },

    goToHub: async () => {
      const ok = await get().flushDna();
      if (!ok && get().save.status !== "saved") {
        const proceed = window.confirm(t("store.leaveUnsaved"));
        if (!proceed) return;
      }
      set({ route: { name: "hub" }, workspace: null, save: SAVED, workflowView: null });
    },

    setModule: (id) => {
      void get().flushDna();
      const view = get().centerView;
      // The Camera module's canvas is the Camera Director; other modules show images.
      const centerView =
        id === "camera" && view === "canvas"
          ? "director"
          : id !== "camera" && view === "director"
            ? "canvas"
            : view;
      set({ activeModule: id, centerView });
    },
    setCenterView: (v) => {
      if (v === "prompt") void get().flushDna();
      set({ centerView: v });
    },
    selectAsset: (id, options) => {
      set(
        options?.keepView ? { selectedAssetId: id } : { selectedAssetId: id, centerView: "canvas" },
      );
      // Selecting an imported image or a tray tile must also select its graph node.
      // Graph/toolbar callers use keepView and manage their own (possibly multi-)selection.
      if (get().workspaceMode === "node" && !options?.keepView)
        get().setCanvasSelection(id ? [`asset:${id}`] : []);
    },
    setWorkspaceMode: (mode) => {
      writeWorkspaceMode(mode);
      set({ workspaceMode: mode });
    },
    setCanvasSelection: (ids) =>
      set((s) => {
        // Re-selecting the same node must not override a tool chosen from its toolbar.
        const changed = ids.join("\n") !== s.canvasSelection.join("\n");
        const ws = s.workspace;
        const activeModule =
          changed && ws && s.workspaceMode === "node"
            ? nodeSelectionModule(ids, ws.assets, ws.generations, s.activeModule)
            : s.activeModule;
        const assetId = ids.length === 1 && ids[0]!.startsWith("asset:") ? ids[0]!.slice(6) : null;
        return {
          canvasSelection: ids,
          activeModule,
          ...(assetId && ws?.assets.some((a) => a.id === assetId)
            ? { selectedAssetId: assetId }
            : {}),
        };
      }),
    setVideoDraft: (patch) => set((s) => ({ videoDraft: { ...s.videoDraft, ...patch } })),
    setNodeViewport: (projectId, viewport) =>
      set((s) => ({ nodeViewport: { ...s.nodeViewport, [projectId]: viewport } })),
    openViewer: (viewer) => set({ viewer }),
    closeViewer: () => set({ viewer: null }),
    selectCamera: (id) => set({ selectedCameraId: id }),
    setTrayTab: (t) => set({ trayTab: t, trayCollapsed: false }),
    toggleTray: () => set((s) => ({ trayCollapsed: !s.trayCollapsed })),
    setInspectorOpen: (open) => set({ inspectorOpen: open }),

    editDna: (path, value) => {
      const ws = get().workspace;
      if (!ws || ws.project.archivedAt) return;
      const draftDna = setIn(ws.draftDna, path, value);
      const v = validateProjectDNA(draftDna);
      set({
        workspace: { ...ws, draftDna },
        save: v.ok
          ? { status: "dirty", fieldErrors: {} }
          : {
              status: "invalid",
              message: t("store.fixHighlighted"),
              fieldErrors: v.fieldErrors,
            },
      });
      if (autosaveTimer) clearTimeout(autosaveTimer);
      if (v.ok) autosaveTimer = setTimeout(() => void get().flushDna(), AUTOSAVE_DELAY_MS);
    },

    setCameras: (cameras) => get().editDna("cameras", cameras),
    setShotIntent: (shotIntent) => {
      const ws = get().workspace;
      if (!ws) return;
      const id = ws.project.id;
      const empty =
        !shotIntent ||
        (!shotIntent.sceneObjects?.length &&
          !shotIntent.targetSpaceId &&
          !shotIntent.targetDetailId &&
          !shotIntent.detailShotCount &&
          !shotIntent.visualIntent &&
          !shotIntent.presetIds?.length &&
          !shotIntent.lighting &&
          !shotIntent.gradeLookId &&
          !hasEffects(shotIntent.effects));
      if (empty) {
        shotIntents.delete(id);
        clearShotIntent(id);
      } else {
        shotIntents.set(id, shotIntent);
        saveShotIntent(id, shotIntent);
      }
      set({ workspace: { ...ws, shotIntent: empty ? undefined : shotIntent } });
    },

    /** Save pending DNA now. Resolves true when nothing is left unsaved. */
    flushDna: async () => {
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      if (savePromise) await savePromise;
      const ws = get().workspace;
      if (!ws) return true;
      if (ws.draftDna === ws.persistedDna) return true;
      const v = validateProjectDNA(ws.draftDna);
      if (!v.ok) return false;

      const submitted = ws.draftDna;
      const camerasChanged = ws.persistedDna.cameras !== submitted.cameras;
      set({ save: { status: "saving", fieldErrors: {} } });
      savePromise = (async () => {
        try {
          const dnaToSave = v.dna;
          const project = await call("dna_update", { projectId: ws.project.id, dna: dnaToSave });
          const current = get().workspace;
          if (!current || current.project.id !== project.id) return true;
          const stillDirty = current.draftDna !== submitted;
          set((s) => ({
            workspace: { ...current, project, persistedDna: submitted },
            save: stillDirty ? { status: "dirty", fieldErrors: {} } : SAVED,
            dataRevision: s.dataRevision + 1,
          }));
          if (stillDirty)
            autosaveTimer = setTimeout(() => void get().flushDna(), AUTOSAVE_DELAY_MS);
          // The backend drops anchors of removed cameras (ADR-016).
          if (camerasChanged) {
            const anchors = await call("camera_anchor_list", { projectId: project.id }).catch(
              () => null,
            );
            const after = get().workspace;
            if (anchors && after?.project.id === project.id)
              set({ workspace: { ...after, anchors } });
            void get().refreshWorkflow();
          }
          return !stillDirty;
        } catch (err) {
          const e = toBridgeError(err);
          set({ save: { status: "error", message: e.message, fieldErrors: fieldErrorsOf(e) } });
          return false;
        } finally {
          savePromise = null;
        }
      })();
      return savePromise;
    },

    adoptProject: (project) => {
      const ws = get().workspace;
      if (ws && ws.project.id === project.id) {
        set((s) => ({ workspace: { ...ws, project }, dataRevision: s.dataRevision + 1 }));
      }
    },

    adoptAssets: async (projectId, assets) => {
      const ws = get().workspace;
      if (!ws || ws.project.id !== projectId) return;
      if (assets.some((a) => a.projectId !== projectId)) return;
      set((s) => ({ workspace: { ...ws, assets }, dataRevision: s.dataRevision + 1 }));
      try {
        const { project } = await call("project_get", { projectId });
        get().adoptProject(project);
      } catch (err) {
        if (isOpen(projectId)) get().notifyError(err);
      }
    },

    notify: (kind, message, title) => {
      const id = ++toastSeq;
      const toast: Toast = title ? { id, kind, message, title } : { id, kind, message };
      set((s) => ({ toasts: [...s.toasts, toast] }));
      setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4000);
    },
    notifyError: (err) => {
      const e = toBridgeError(err);
      get().notify("error", e.message, errorHeadline(e));
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    loadProviders: async () => {
      const revision = ++providerRevision;
      try {
        const providers = await call("provider_list", {});
        // A Save/Clear (or newer list) finished meanwhile: this list may be stale.
        if (revision !== providerRevision) return;
        set({ providers, providersError: null });
      } catch (err) {
        if (revision === providerRevision) set({ providersError: toBridgeError(err).message });
      }
    },
    adoptProvider: (p) => {
      providerRevision++;
      set((s) => ({
        providers: s.providers ? s.providers.map((x) => (x.id === p.id ? p : x)) : [p],
      }));
    },
    openProviderDialog: (focus = null) => {
      set({ providerDialog: { focus } });
      void get().loadProviders();
    },
    closeProviderDialog: () => set({ providerDialog: null }),

    setGenerateDraft: (patch) =>
      set((s) => {
        // An approval belongs to the text it was given for: new text is checked afresh.
        const textChanged =
          patch.extraPrompt !== undefined && patch.extraPrompt !== s.generateDraft.extraPrompt;
        const reset = textChanged && !("approvedExceptions" in patch);
        return {
          generateDraft: {
            ...s.generateDraft,
            ...patch,
            ...(reset ? { approvedExceptions: undefined } : {}),
          },
        };
      }),
    reuseGeneration: (g) => {
      set({
        generateDraft: {
          source: "dna",
          providerId: g.providerId,
          modelId: g.modelId,
          // Anchor/production renders belong to a camera; Generate offers hero/variation.
          purpose: g.purpose === "hero" || g.purpose === "variation" ? g.purpose : null,
          params: g.params,
          referenceAssetIds: [...g.referenceAssetIds],
        },
      });
      get().setModule("generate");
    },

    refreshGenerations: async () => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return;
      const token = ++generationListRequest;
      const since = syncSeq;
      try {
        const generations = await call("generation_list", { projectId });
        if (token !== generationListRequest) return; // a newer poll was sent meanwhile
        const ws = get().workspace;
        if (ws && ws.project.id === projectId)
          set({
            workspace: {
              ...ws,
              generations: mergePolled(
                ws.generations,
                generations,
                generationSeenAt,
                since,
                (g) => !isActiveGeneration(g.status),
              ),
            },
          });
      } catch (err) {
        get().notifyError(err);
      }
    },

    submitGeneration: async (input, prompt) => {
      if (get().run?.status === "submitting") return undefined;
      const { extraPrompt, approvedExceptions, shotIntent, ...submitInput } = input;
      const { projectId } = submitInput;
      const sourceAssetId =
        !prompt &&
        (input.purpose === "hero" || input.purpose === "variation") &&
        get().generateDraft.source === "sketch"
          ? input.referenceAssetIds[0]
          : undefined;
      // Everything below is bound to this project; never read another project's data.
      if (!prompt && !isOpen(projectId)) return undefined;
      set({
        run: {
          status: "submitting",
          projectId,
          providerId: input.providerId,
          startedAt: Date.now(),
        },
      });
      try {
        let request: GenerationSubmitRequest;
        const cameraId = input.cameraId ?? null;
        if (prompt) {
          // A resent or hand-built snapshot (enhance, retry): gated on the persisted DNA.
          const project = await persistedProject(projectId);
          // The snapshot's own shot intent is what its prompt was compiled with.
          const validation = checkShot({
            ...project,
            cameraId,
            extraPrompt,
            approvedExceptions,
            shotIntent: shotIntent ?? prompt.shotIntent,
          });
          request = { ...submitInput, cameraId, prompt: withValidation(prompt, validation) };
        } else {
          // flushDna saves the open project, which is `projectId` at this point (checked above).
          if (!(await get().flushDna())) {
            throw new BridgeError({
              code: "VALIDATION_ERROR",
              message: t("store.dnaNotSaved"),
            });
          }
          // One persisted snapshot of this project orders the references and compiles.
          const bundle = await call("project_get", { projectId });
          // Prompt numbering order ("Image N") = submit order; nothing is silently dropped.
          const ids = orderReferenceIds(
            resolveReferenceIds(input.referenceAssetIds, bundle.assets),
            bundle.assets,
          );
          // AC-22: the extra prompt is checked BEFORE it is appended; a refused shot is
          // never sent to the bridge or a provider.
          const selectedShotIntent = shotIntent ?? get().workspace?.shotIntent;
          const validation = checkShot({
            dna: bundle.dna,
            projectType: bundle.project.projectType,
            cameraId,
            extraPrompt,
            approvedExceptions,
            shotIntent: selectedShotIntent,
          });
          const compiled = withExtraPrompt(
            withValidation(
              compileFromBundle(bundle, {
                referenceAssetIds: ids,
                sourceAssetId,
                variation: input.purpose === "variation",
                cameraId,
                shotIntent: selectedShotIntent,
              }),
              validation,
            ),
            extraPrompt,
          );
          request = { ...submitInput, cameraId, referenceAssetIds: ids, prompt: compiled };
        }
        const queued = await call("generation_submit", request);
        // Events may already have moved it on; keep the most advanced snapshot.
        const known = get().workspace?.generations.find((g) => g.id === queued.id);
        const generation = known ?? queued;
        set({
          run: { status: "tracking", projectId, generation },
          enhanceSubmission:
            input.purpose === "enhance"
              ? { projectId, generationId: generation.id }
              : get().enhanceSubmission,
        });
        const ws = get().workspace;
        if (ws && ws.project.id === projectId && !known) {
          // A command result counts like an event: an older poll must not drop it.
          generationSeenAt.set(queued.id, ++syncSeq);
          set({ workspace: { ...ws, generations: upsert(ws.generations, queued) } });
        }
        if (!isActiveGeneration(generation.status)) onTrackedFinished(generation);
        void get().refreshJobs();
        return queued;
      } catch (err) {
        const e = toBridgeError(err);
        const validation = conflictOf(e);
        set({
          run: {
            status: "error",
            projectId,
            code: e.code,
            message: e.message,
            needsKeyFor: providerNeedingKey(e, input.providerId),
            ...(validation ? { validation } : {}),
          },
        });
        if (isOpen(projectId)) void get().refreshGenerations();
        return undefined;
      }
    },

    retryGeneration: async (g) => {
      if (!g.jobId) {
        return get().submitGeneration(
          {
            projectId: g.projectId,
            providerId: g.providerId,
            modelId: g.modelId,
            purpose: g.purpose,
            referenceAssetIds: g.referenceAssetIds,
            params: g.params,
            cameraId: g.cameraId,
            // WARN codes accepted for the original submit stay accepted on the resend.
            approvedExceptions: (g.prompt.validation?.approvedExceptions ?? []) as ConflictCode[],
          },
          g.prompt,
        );
      }
      const job = await get().retryJob(g.jobId);
      if (!job) return undefined;
      try {
        const generation = await call("generation_get", {
          projectId: job.projectId,
          generationId: job.generationId,
        });
        const known = get().workspace?.generations.find((x) => x.id === generation.id);
        set({
          run: { status: "tracking", projectId: job.projectId, generation: known ?? generation },
        });
        const ws = get().workspace;
        if (ws && ws.project.id === job.projectId && !known) {
          generationSeenAt.set(generation.id, ++syncSeq);
          set({ workspace: { ...ws, generations: upsert(ws.generations, generation) } });
        }
        return generation;
      } catch (err) {
        get().notifyError(err);
        return undefined;
      }
    },

    refreshJobs: async () => {
      const token = ++jobListRequest;
      const since = syncSeq;
      let polled: JobDTO[];
      try {
        polled = await call("job_list", { projectId: null });
      } catch {
        return; // the tray shows the last known list; events keep coming
      }
      if (token !== jobListRequest) return; // a newer poll was sent meanwhile
      const before = new Map(get().jobs.map((j) => [j.id, j]));
      const jobs = mergePolled(get().jobs, polled, jobSeenAt, since, isTerminalJob);
      set({ jobs });
      // A job that finished without us seeing its events: resync the open project.
      const projectId = get().workspace?.project.id;
      const missed = jobs.some(
        (j) =>
          j.projectId === projectId &&
          isTerminalJob(j) &&
          before.has(j.id) &&
          !isTerminalJob(before.get(j.id)!),
      );
      if (projectId && missed) {
        await get().refreshGenerations();
        await reloadAssets(projectId);
        void get().refreshBatches();
      }
    },

    cancelJob: async (jobId) => {
      try {
        get().applyJobEvent(await call("job_cancel", { jobId }));
      } catch (err) {
        // The job ended before the cancel arrived (or the UI missed its events): show the
        // real state instead of an error about a job the user still sees as running.
        if (toBridgeError(err).code === "INVALID_STATE") {
          await Promise.all([
            get().refreshJobs(),
            get().refreshGenerations(),
            get().refreshBatches(),
          ]);
          get().notify("info", t("store.jobAlreadyEnded"));
          return;
        }
        get().notifyError(err);
      }
    },

    retryJob: async (jobId, options) => {
      try {
        const validation = await revalidateRetry(jobId, options?.approvedExceptions ?? []);
        const job = await call(
          "job_retry",
          validation ? { jobId, validation: validationSnapshot(validation) } : { jobId },
        );
        set({ retryConflicts: get().retryConflicts.filter((c) => c.jobId !== jobId) });
        get().applyJobEvent(job);
        void get().refreshBatches();
        return job;
      } catch (err) {
        get().notifyError(err);
        return undefined;
      }
    },

    dismissRetryConflicts: () => set({ retryConflicts: [] }),

    createBatch: async (input, options) => {
      try {
        const project = await persistedProject(input.projectId);
        const gate = gateBatch(
          input,
          project.dna,
          project.projectType,
          options?.approvedExceptions,
        );
        if (gate.skipped.length)
          get().notify(
            gate.request ? "warning" : "error",
            gate.request
              ? t("conflictUi.batchSkipped", { list: gate.skipped.map((x) => x.label).join(", ") })
              : t("conflictUi.batchAllBlocked"),
          );
        if (!gate.request) return undefined;
        const request = gate.request;
        const batch = await call("batch_create", request);
        const ws = get().workspace;
        if (ws && ws.project.id === request.projectId) {
          set({
            workspace: { ...ws, batches: upsert(ws.batches, batch) },
            contactBatchId: batch.id,
            centerView: "contact",
          });
          await get().refreshGenerations();
        }
        void get().refreshJobs();
        get().notify(
          "info",
          t("store.batchQueued", { name: batch.name, count: batch.jobIds.length }),
        );
        return batch;
      } catch (err) {
        get().notifyError(err);
        return undefined;
      }
    },

    applyGrade: async (grade, label) => {
      const ws = get().workspace;
      const assetId = get().selectedAssetId ?? ws?.project.activeMasterAssetId;
      if (!ws || !assetId) return undefined;
      try {
        const asset = await call("grade_apply", {
          projectId: ws.project.id,
          assetId,
          grade,
          label,
        });
        const assets = await call("asset_list", { projectId: ws.project.id });
        await get().adoptAssets(ws.project.id, assets);
        if (get().workspace?.project.id === ws.project.id) get().selectAsset(asset.id);
        return asset;
      } catch (err) {
        get().notifyError(err);
        return undefined;
      }
    },

    refreshBatches: async () => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return;
      const batches = await call("batch_list", { projectId }).catch(() => null);
      const ws = get().workspace;
      if (batches && ws && ws.project.id === projectId) set({ workspace: { ...ws, batches } });
    },

    showContactSheet: (batchId) => set({ contactBatchId: batchId, centerView: "contact" }),

    setAnchor: async (cameraId, assetId) => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return false;
      try {
        const anchors = await call("camera_anchor_set", { projectId, cameraId, assetId });
        const ws = get().workspace;
        if (ws && ws.project.id === projectId) set({ workspace: { ...ws, anchors } });
        const { project } = await call("project_get", { projectId });
        get().adoptProject(project);
        void get().refreshWorkflow();
        return true;
      } catch (err) {
        get().notifyError(err);
        return false;
      }
    },

    clearAnchor: async (cameraId) => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return false;
      try {
        const anchors = await call("camera_anchor_clear", { projectId, cameraId });
        const ws = get().workspace;
        if (ws && ws.project.id === projectId) set({ workspace: { ...ws, anchors } });
        const { project } = await call("project_get", { projectId });
        get().adoptProject(project);
        void get().refreshWorkflow();
        return true;
      } catch (err) {
        get().notifyError(err);
        return false;
      }
    },

    refreshWorkflow: async () => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return;
      try {
        const workflow = await call("workflow_get", { projectId });
        const ws = get().workspace;
        if (!ws || ws.project.id !== projectId) return;
        const masterApproved = ["master_approved", "anchor_generation", "production"].includes(
          ws.project.status,
        );
        set({
          workspace: { ...ws, workflow },
          workflowView: deriveWorkflow(workflow.steps, {
            masterApproved,
            anchorCameraIds: ws.draftDna.cameras
              .filter((camera) => camera.isAnchorView)
              .map((camera) => camera.id),
            cameraIds: ws.draftDna.cameras.map((camera) => camera.id),
            approvedAnchorCameraIds: ws.anchors.map((anchor) => anchor.cameraId),
          }),
        });
      } catch (err) {
        get().notifyError(err);
      }
    },

    confirmWorkflowStep: async (stepId) => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return false;
      try {
        const workflow = await call("workflow_confirm_step", { projectId, stepId });
        const ws = get().workspace;
        if (!ws || ws.project.id !== projectId) return false;
        set({ workspace: { ...ws, workflow } });
        await get().refreshWorkflow();
        return true;
      } catch (err) {
        get().notifyError(err);
        return false;
      }
    },

    reopenWorkflowStep: async (stepId) => {
      const projectId = get().workspace?.project.id;
      if (!projectId) return false;
      try {
        const workflow = await call("workflow_reopen_step", { projectId, stepId });
        const ws = get().workspace;
        if (!ws || ws.project.id !== projectId) return false;
        set({ workspace: { ...ws, workflow } });
        await get().refreshWorkflow();
        return true;
      } catch (err) {
        get().notifyError(err);
        return false;
      }
    },

    applyJobEvent: (job) => {
      jobSeenAt.set(job.id, ++syncSeq);
      set((s) => ({ jobs: upsert(s.jobs, job) }));
    },

    applyGenerationEvent: (g) => {
      eventRevision.set(g.projectId, (eventRevision.get(g.projectId) ?? 0) + 1);
      generationSeenAt.set(g.id, ++syncSeq);
      const ws = get().workspace;
      const previous =
        ws?.project.id === g.projectId ? ws.generations.find((x) => x.id === g.id) : undefined;
      if (ws && ws.project.id === g.projectId) {
        set({ workspace: { ...ws, generations: upsert(ws.generations, g) } });
      }
      const run = get().run;
      const tracked = run?.status === "tracking" && run.generation.id === g.id ? run : null;
      if (tracked) set({ run: { ...tracked, generation: g } });

      const wasActive = previous
        ? isActiveGeneration(previous.status)
        : tracked
          ? isActiveGeneration(tracked.generation.status)
          : true;
      const finished = wasActive && !isActiveGeneration(g.status);
      if (!finished) return;
      if (tracked) onTrackedFinished(g);
      if (isOpen(g.projectId)) {
        if (g.status === "completed") void reloadAssets(g.projectId);
        if (g.batchId) void get().refreshBatches();
      }
    },
  };
});

/**
 * Connect backend events to the store. Returns a stop function. Called once by the app
 * (and by tests); the subscription survives project switches.
 */
export function startBackendSync(): () => void {
  const offJob = subscribe(JOB_UPDATED_EVENT, (j) => useStudio.getState().applyJobEvent(j));
  const offGen = subscribe(GENERATION_UPDATED_EVENT, (g) =>
    useStudio.getState().applyGenerationEvent(g),
  );
  return () => {
    offJob();
    offGen();
  };
}

/** Run a bridge call and surface failures as a toast. Returns undefined on failure. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    useStudio.getState().notifyError(err);
    return undefined;
  }
}

export const selectReadOnly = (s: State) => !!s.workspace?.project.archivedAt;

/** Running and waiting jobs of every project (top-bar queue indicator). */
export const selectQueueCounts = (s: State) => {
  let running = 0;
  let queued = 0;
  for (const j of s.jobs) {
    if (j.status === "running") running++;
    else if (j.status === "queued" || j.status === "retrying") queued++;
  }
  return { running, queued };
};
