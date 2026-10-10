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

export type Route = { name: "hub" } | { name: "workspace"; projectId: string };
/** `director` = Camera Director (Camera module); `contact` = Contact Sheet. */
export type CenterView = "canvas" | "prompt" | "director" | "contact";
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
    };

export type GenerationInput = Omit<GenerationSubmitRequest, "prompt" | "cameraId"> & {
  cameraId?: string | null;
  /** Appended to the compiled positive prompt (ignored when a `prompt` is passed). */
  extraPrompt?: string;
};

type State = {
  route: Route;
  workspace: WorkspaceData | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  activeModule: ModuleId;
  centerView: CenterView;
  selectedAssetId: string | null;
  selectedCameraId: string | null;
  /** Batch shown on the Contact Sheet; null = the newest. */
  contactBatchId: string | null;
  trayTab: TrayTabId;
  trayCollapsed: boolean;
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
  run: GenerationRun | null;
  /** The exact enhance submission whose completed output may be auto-selected. */
  enhanceSubmission: { projectId: string; generationId: string } | null;
  /** Jobs of every project (job_list(null) + events), newest first. */
  jobs: JobDTO[];
  workflowView: DerivedWorkflow | null;

  openProject: (projectId: string) => Promise<void>;
  goToHub: () => Promise<void>;
  setModule: (id: ModuleId) => void;
  setCenterView: (v: CenterView) => void;
  selectAsset: (id: string | null) => void;
  selectCamera: (id: string | null) => void;
  setTrayTab: (t: TrayTabId) => void;
  toggleTray: () => void;
  editDna: (path: string, value: unknown) => void;
  /** Replace the camera list (add / delete / duplicate / reorder). */
  setCameras: (cameras: CameraDNA[]) => void;
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
  retryJob: (jobId: string) => Promise<JobDTO | undefined>;
  createBatch: (request: BatchCreateRequest) => Promise<BatchDTO | undefined>;
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

  /** Refresh assets + project after outputs land (ignored if another project is open). */
  const reloadAssets = async (projectId: string) => {
    const assets = await call("asset_list", { projectId }).catch(() => null);
    if (assets) await get().adoptAssets(projectId, assets);
  };

  /** Notify and select outputs when the tracked generation finishes. */
  const onTrackedFinished = (g: GenerationDTO) => {
    if (g.status === "completed") {
      const n = g.outputAssetIds.length;
      get().notify("success", t("store.generationFinished", { count: n }));
      const first = g.outputAssetIds[0];
      if (first && isOpen(g.projectId) && get().activeModule === "generate") {
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
    selectedCameraId: null,
    contactBatchId: null,
    trayTab: "assets",
    trayCollapsed: false,
    save: SAVED,
    toasts: [],
    dataRevision: 0,
    providers: null,
    providersError: null,
    providerDialog: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    run: null,
    enhanceSubmission: null,
    jobs: [],
    workflowView: null,

    openProject: async (projectId) => {
      set({
        route: { name: "workspace", projectId },
        workspace: null,
        workspaceLoading: true,
        workspaceError: null,
        activeModule: "overview",
        centerView: "canvas",
        selectedAssetId: null,
        selectedCameraId: null,
        contactBatchId: null,
        save: SAVED,
        generateDraft: EMPTY_GENERATE_DRAFT,
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
    selectAsset: (id) => set({ selectedAssetId: id, centerView: "canvas" }),
    selectCamera: (id) => set({ selectedCameraId: id }),
    setTrayTab: (t) => set({ trayTab: t, trayCollapsed: false }),
    toggleTray: () => set((s) => ({ trayCollapsed: !s.trayCollapsed })),

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
          const project = await call("dna_update", { projectId: ws.project.id, dna: v.dna });
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

    setGenerateDraft: (patch) => set((s) => ({ generateDraft: { ...s.generateDraft, ...patch } })),
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
      const { extraPrompt, ...submitInput } = input;
      const { projectId } = submitInput;
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
          request = { ...submitInput, cameraId, prompt };
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
          const compiled = withExtraPrompt(
            compileFromBundle(bundle, { referenceAssetIds: ids, cameraId }),
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
        set({
          run: {
            status: "error",
            projectId,
            code: e.code,
            message: e.message,
            needsKeyFor: providerNeedingKey(e, input.providerId),
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

    retryJob: async (jobId) => {
      try {
        const job = await call("job_retry", { jobId });
        get().applyJobEvent(job);
        void get().refreshBatches();
        return job;
      } catch (err) {
        get().notifyError(err);
        return undefined;
      }
    },

    createBatch: async (request) => {
      try {
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
