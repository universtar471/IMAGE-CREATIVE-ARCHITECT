/**
 * "Ảnh của tôi" (ADR-040 UI-2): pure filters over the project's assets, the shared
 * multi-selection of the grid, and the actions on the selected images. The actions only
 * call existing store functions and bridges; nothing here is a new backend command.
 */
import { create } from "zustand";
import type { AssetDTO, AssetStatus } from "@arch/domain";
import { useStudio } from "../../app/store";
import { assetPreview, call } from "../../lib/bridge";
import { bytesToBase64 } from "../publishing/pdf";

export type LibraryKind = "all" | "generated" | "imported";
export type LibraryFilters = { name: string; kind: LibraryKind; status: AssetStatus | "all" };

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = { name: "", kind: "all", status: "all" };

/** Largest preview edge the backend renders; downloads are PNG at most this size. */
export const DOWNLOAD_MAX_EDGE = 4096;

export const kindOfAsset = (asset: AssetDTO): Exclude<LibraryKind, "all"> =>
  asset.source === "ai_generated" ? "generated" : "imported";

export const assetName = (asset: AssetDTO) => asset.originalName ?? asset.id;

/** Name (case- and accent-insensitive substring), kind and status filters. */
export function filterLibraryAssets(
  assets: readonly AssetDTO[],
  filters: LibraryFilters,
): AssetDTO[] {
  const needle = fold(filters.name.trim());
  return assets.filter(
    (asset) =>
      (filters.kind === "all" || kindOfAsset(asset) === filters.kind) &&
      (filters.status === "all" || asset.status === filters.status) &&
      (!needle || fold(assetName(asset)).includes(needle)),
  );
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

type LibraryState = {
  /** Project the selection belongs to; another project starts empty. */
  projectId: string | null;
  checkedIds: string[];
  filters: LibraryFilters;
  setFilters: (projectId: string, patch: Partial<LibraryFilters>) => void;
  toggle: (projectId: string, assetId: string) => void;
  setChecked: (projectId: string, ids: string[]) => void;
};

const forProject = (s: LibraryState, projectId: string) =>
  s.projectId === projectId
    ? s
    : { projectId, checkedIds: [] as string[], filters: EMPTY_LIBRARY_FILTERS };

export const useLibrary = create<LibraryState>((set) => ({
  projectId: null,
  checkedIds: [],
  filters: EMPTY_LIBRARY_FILTERS,
  setFilters: (projectId, patch) =>
    set((s) => {
      const base = forProject(s, projectId);
      return { projectId, checkedIds: base.checkedIds, filters: { ...base.filters, ...patch } };
    }),
  toggle: (projectId, assetId) =>
    set((s) => {
      const base = forProject(s, projectId);
      const checkedIds = base.checkedIds.includes(assetId)
        ? base.checkedIds.filter((id) => id !== assetId)
        : [...base.checkedIds, assetId];
      return { projectId, checkedIds, filters: base.filters };
    }),
  setChecked: (projectId, ids) =>
    set((s) => ({ projectId, checkedIds: [...ids], filters: forProject(s, projectId).filters })),
}));

/** The selection of the open project (empty when it belongs to another project). */
export function libraryStateFor(state: LibraryState, projectId: string) {
  return forProject(state, projectId);
}

/**
 * Images an action applies to: the checked ones (in grid order) when any are checked,
 * otherwise the selected asset.
 */
export function actionTargets(
  assets: readonly AssetDTO[],
  checkedIds: readonly string[],
  selectedId: string | null,
): AssetDTO[] {
  if (checkedIds.length) return assets.filter((asset) => checkedIds.includes(asset.id));
  const selected = assets.find((asset) => asset.id === selectedId);
  return selected ? [selected] : [];
}

/** Opens the image in Chỉnh sửa ảnh (the section's last tool). */
export function openInEdit(assetId: string) {
  const studio = useStudio.getState();
  studio.selectAsset(assetId);
  studio.setSection("edit");
}

/**
 * Uses the images as the sources of Tạo ảnh tự động: they become the Generate references
 * (one structure sketch switches the panel to sketch mode).
 */
export function applyAsSource(targets: readonly AssetDTO[]) {
  const ready = targets.filter((asset) => asset.status === "ready");
  if (!ready.length) return;
  const studio = useStudio.getState();
  const sketch = ready.length === 1 && ready[0]!.role === "structure_sketch";
  studio.setGenerateDraft({
    source: sketch ? "sketch" : "dna",
    referenceAssetIds: ready.map((asset) => asset.id),
  });
  studio.selectAsset(ready[0]!.id);
  studio.setSection("create");
}

/**
 * Downloads the images through the existing export bridge (`publication_export_save`, PNG):
 * each one is the backend's PNG preview at most `DOWNLOAD_MAX_EDGE` on the long edge.
 * The backend asks where to save; resolves to the written paths (empty when cancelled).
 */
export async function downloadAssets(projectId: string, targets: readonly AssetDTO[]) {
  const ready = targets.filter((asset) => asset.status === "ready");
  if (!ready.length) return { saved: false, paths: [] as string[] };
  const files: string[] = [];
  for (const asset of ready) {
    const blob = await assetPreview({ projectId, assetId: asset.id, maxEdge: DOWNLOAD_MAX_EDGE });
    files.push(bytesToBase64(new Uint8Array(await blob.arrayBuffer())));
  }
  const baseName =
    ready.length === 1 ? assetName(ready[0]!).replace(/\.[a-z0-9]+$/i, "") : "images";
  return call("publication_export_save", { projectId, format: "png", baseName, files });
}
