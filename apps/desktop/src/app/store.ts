/**
 * App state (zustand). Holds view state plus the open project's loaded data.
 * Persistence happens only through bridge commands; this store never owns truth for long:
 * after every command it adopts what the backend returned.
 *
 * Never put an API key here: provider state is the descriptor only (configured / key source).
 */
import { create } from "zustand";
import {
  orderReferenceIds,
  validateProjectDNA,
  type AppErrorCode,
  type AssetDTO,
  type GenerationDTO,
  type GenerationParams,
  type GenerationPurpose,
  type GenerationSubmitRequest,
  type ProjectDNA,
  type ProjectDTO,
  type PromptBundle,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import { BridgeError, call, fieldErrorsOf, providerNeedingKey, toBridgeError } from "../lib/bridge";
import { setIn } from "../lib/path";
import type { ModuleId, TrayTabId } from "../features/workspace/modules";
import { compilePromptPreview } from "./services";

export type Route = { name: "hub" } | { name: "workspace"; projectId: string };
export type CenterView = "canvas" | "prompt";
export type SaveStatus = "saved" | "dirty" | "saving" | "invalid" | "error";

export type SaveState = {
  status: SaveStatus;
  message?: string;
  fieldErrors: Record<string, string>;
};

export type Toast = { id: number; kind: "info" | "success" | "warning" | "error"; message: string };

type WorkspaceData = {
  project: ProjectDTO;
  persistedDna: ProjectDNA;
  draftDna: ProjectDNA;
  assets: AssetDTO[];
  /** Generation history, newest first (generation_list). */
  generations: GenerationDTO[];
};

/**
 * What the user changed in the Generate panel. `null` = use the default derived from the
 * provider/model capabilities and the project's assets (see features/generate/form.ts).
 */
export type GenerateDraft = {
  providerId: string | null;
  modelId: string | null;
  purpose: GenerationPurpose | null;
  params: GenerationParams | null;
  referenceAssetIds: string[] | null;
};

export const EMPTY_GENERATE_DRAFT: GenerateDraft = {
  providerId: null,
  modelId: null,
  purpose: null,
  params: null,
  referenceAssetIds: null,
};

/** The single in-flight (or last finished) generation call, tagged with its project. */
export type GenerationRun =
  | { status: "running"; projectId: string; providerId: string; startedAt: number }
  | { status: "done"; projectId: string; generation: GenerationDTO }
  | {
      status: "error";
      projectId: string;
      code: AppErrorCode;
      message: string;
      /** Set when the provider has no API key: the UI offers "Set API key". */
      needsKeyFor: string | null;
    };

export type GenerationInput = Omit<GenerationSubmitRequest, "prompt">;

type State = {
  route: Route;
  workspace: WorkspaceData | null;
  workspaceLoading: boolean;
  workspaceError: string | null;
  activeModule: ModuleId;
  centerView: CenterView;
  selectedAssetId: string | null;
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

  openProject: (projectId: string) => Promise<void>;
  goToHub: () => Promise<void>;
  setModule: (id: ModuleId) => void;
  setCenterView: (v: CenterView) => void;
  selectAsset: (id: string | null) => void;
  setTrayTab: (t: TrayTabId) => void;
  toggleTray: () => void;
  editDna: (path: string, value: unknown) => void;
  flushDna: () => Promise<boolean>;
  adoptProject: (p: ProjectDTO) => void;
  adoptAssets: (assets: AssetDTO[]) => Promise<void>;
  notify: (kind: Toast["kind"], message: string) => void;
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
   * Run one generation. Without `prompt`, DNA is flushed and the prompt is compiled from
   * persisted data with exactly the chosen references (ADR-008). With `prompt` (Retry),
   * the stored request snapshot is resent unchanged.
   */
  submitGeneration: (
    input: GenerationInput,
    prompt?: PromptBundle,
  ) => Promise<GenerationDTO | undefined>;
};

export const AUTOSAVE_DELAY_MS = 700;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<boolean> | null = null;
let toastSeq = 0;

const SAVED: SaveState = { status: "saved", fieldErrors: {} };

export const useStudio = create<State>((set, get) => ({
  route: { name: "hub" },
  workspace: null,
  workspaceLoading: false,
  workspaceError: null,
  activeModule: "overview",
  centerView: "canvas",
  selectedAssetId: null,
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

  openProject: async (projectId) => {
    set({
      route: { name: "workspace", projectId },
      workspace: null,
      workspaceLoading: true,
      workspaceError: null,
      activeModule: "overview",
      centerView: "canvas",
      selectedAssetId: null,
      save: SAVED,
      generateDraft: EMPTY_GENERATE_DRAFT,
    });
    if (!get().providers) void get().loadProviders();
    try {
      const [bundle, generations] = await Promise.all([
        call("project_get", { projectId }),
        // History is secondary: a failure here must not block opening the project.
        call("generation_list", { projectId }).catch((err: unknown) => {
          get().notify("error", `History unavailable: ${toBridgeError(err).message}`);
          return [] as GenerationDTO[];
        }),
      ]);
      const route = get().route;
      if (route.name !== "workspace" || route.projectId !== projectId) return;
      set({
        workspace: {
          project: bundle.project,
          persistedDna: bundle.dna,
          draftDna: bundle.dna,
          assets: bundle.assets,
          generations,
        },
        selectedAssetId: bundle.project.activeMasterAssetId ?? bundle.assets[0]?.id ?? null,
        workspaceLoading: false,
      });
    } catch (err) {
      set({ workspaceLoading: false, workspaceError: toBridgeError(err).message });
    }
  },

  goToHub: async () => {
    const ok = await get().flushDna();
    if (!ok && get().save.status !== "saved") {
      const proceed = window.confirm(
        "Some Design DNA changes could not be saved. Leave the project and discard them?",
      );
      if (!proceed) return;
    }
    set({ route: { name: "hub" }, workspace: null, save: SAVED });
  },

  setModule: (id) => {
    void get().flushDna();
    set({ activeModule: id });
  },
  setCenterView: (v) => {
    if (v === "prompt") void get().flushDna();
    set({ centerView: v });
  },
  selectAsset: (id) => set({ selectedAssetId: id, centerView: "canvas" }),
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
            message: "Fix the highlighted fields — invalid values are not saved.",
            fieldErrors: v.fieldErrors,
          },
    });
    if (autosaveTimer) clearTimeout(autosaveTimer);
    if (v.ok) autosaveTimer = setTimeout(() => void get().flushDna(), AUTOSAVE_DELAY_MS);
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
        if (stillDirty) autosaveTimer = setTimeout(() => void get().flushDna(), AUTOSAVE_DELAY_MS);
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

  /** Adopt an updated asset list; also refresh the project (master/status may change). */
  adoptAssets: async (assets) => {
    const ws = get().workspace;
    if (!ws) return;
    set((s) => ({ workspace: { ...ws, assets }, dataRevision: s.dataRevision + 1 }));
    try {
      const { project } = await call("project_get", { projectId: ws.project.id });
      get().adoptProject(project);
    } catch (err) {
      get().notify("error", toBridgeError(err).message);
    }
  },

  notify: (kind, message) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  loadProviders: async () => {
    try {
      set({ providers: await call("provider_list", {}), providersError: null });
    } catch (err) {
      set({ providersError: toBridgeError(err).message });
    }
  },
  adoptProvider: (p) =>
    set((s) => ({
      providers: s.providers ? s.providers.map((x) => (x.id === p.id ? p : x)) : [p],
    })),
  openProviderDialog: (focus = null) => {
    set({ providerDialog: { focus } });
    void get().loadProviders();
  },
  closeProviderDialog: () => set({ providerDialog: null }),

  setGenerateDraft: (patch) => set((s) => ({ generateDraft: { ...s.generateDraft, ...patch } })),
  reuseGeneration: (g) => {
    set({
      generateDraft: {
        providerId: g.providerId,
        modelId: g.modelId,
        purpose: g.purpose,
        params: g.params,
        referenceAssetIds: [...g.referenceAssetIds],
      },
    });
    get().setModule("generate");
  },

  refreshGenerations: async () => {
    const projectId = get().workspace?.project.id;
    if (!projectId) return;
    try {
      const generations = await call("generation_list", { projectId });
      const ws = get().workspace;
      if (ws && ws.project.id === projectId) set({ workspace: { ...ws, generations } });
    } catch (err) {
      get().notify("error", toBridgeError(err).message);
    }
  },

  submitGeneration: async (input, prompt) => {
    if (get().run?.status === "running") return undefined;
    const { projectId } = input;
    set({
      run: { status: "running", projectId, providerId: input.providerId, startedAt: Date.now() },
    });
    // Only the project that is open *now* adopts the result; another project ignores it.
    const isOpen = () => get().workspace?.project.id === projectId;
    try {
      let request: GenerationSubmitRequest;
      if (prompt) {
        request = { ...input, prompt };
      } else {
        if (!(await get().flushDna())) {
          throw new BridgeError({
            code: "VALIDATION_ERROR",
            message: "Design DNA has unsaved or invalid changes. Fix them before generating.",
          });
        }
        const assets = get().workspace?.assets ?? [];
        const referenceAssetIds = orderReferenceIds(input.referenceAssetIds, assets);
        const compiled = await compilePromptPreview(projectId, referenceAssetIds);
        request = { ...input, referenceAssetIds, prompt: compiled };
      }
      const generation = await call("generation_submit", request);
      set({ run: { status: "done", projectId, generation } });
      if (isOpen()) {
        const assets = await call("asset_list", { projectId }).catch(() => null);
        if (assets && isOpen()) await get().adoptAssets(assets);
        await get().refreshGenerations();
        const first = generation.outputAssetIds[0];
        if (first && isOpen()) set({ selectedAssetId: first, centerView: "canvas" });
      }
      if (generation.status === "completed") {
        const n = generation.outputAssetIds.length;
        get().notify("success", `Generation finished: ${n} image${n === 1 ? "" : "s"}.`);
      } else {
        get().notify("error", `Generation failed: ${generation.error?.message ?? "unknown error"}`);
      }
      return generation;
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
      if (isOpen()) void get().refreshGenerations();
      return undefined;
    }
  },
}));

/** Run a bridge call and surface failures as a toast. Returns undefined on failure. */
export async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const e = err instanceof BridgeError ? err : toBridgeError(err);
    useStudio.getState().notify("error", e.message);
    return undefined;
  }
}

export const selectReadOnly = (s: State) => !!s.workspace?.project.archivedAt;
