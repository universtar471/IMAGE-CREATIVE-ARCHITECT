export const ASSET_VIEW_MODES = ["small", "large", "list"] as const;
export type AssetViewMode = (typeof ASSET_VIEW_MODES)[number];
export const ASSET_LIST_COLUMNS = ["name", "role", "model", "size", "date", "status"] as const;
export const ASSET_VIEW_STORAGE_KEY = "arch.assetViewMode";

export function readAssetViewMode(storage?: Pick<Storage, "getItem">): AssetViewMode {
  try {
    const value = (storage ?? window.localStorage).getItem(ASSET_VIEW_STORAGE_KEY);
    return ASSET_VIEW_MODES.includes(value as AssetViewMode) ? (value as AssetViewMode) : "small";
  } catch {
    return "small";
  }
}

export function writeAssetViewMode(mode: AssetViewMode, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.localStorage).setItem(ASSET_VIEW_STORAGE_KEY, mode);
  } catch {
    // Storage can be disabled by the browser or host WebView.
  }
}
