/**
 * App state (zustand). Holds view state plus the open project's loaded data.
 * Persistence happens only through bridge commands; this store never owns truth for long:
 * after every command it adopts what the backend returned.
 */
import { create } from "zustand";
import { validateProjectDNA, type AssetDTO, type ProjectDNA, type ProjectDTO } from "@arch/domain";
import { BridgeError, call, fieldErrorsOf, toBridgeError } from "../lib/bridge";
import { setIn } from "../lib/path";
import type { ModuleId, TrayTabId } from "../features/workspace/modules";

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
};

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
    });
    try {
      const bundle = await call("project_get", { projectId });
      set({
        workspace: {
          project: bundle.project,
          persistedDna: bundle.dna,
          draftDna: bundle.dna,
          assets: bundle.assets,
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
