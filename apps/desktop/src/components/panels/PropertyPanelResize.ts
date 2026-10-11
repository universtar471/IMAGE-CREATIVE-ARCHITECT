export const PANEL_WIDTH_KEY = "arch.propertyPanelWidth";
export const DEFAULT_PANEL_WIDTH = 380;
export const clampPanelWidth = (width: number) => Math.min(720, Math.max(320, Math.round(width)));

export function readPanelWidth(storage?: Pick<Storage, "getItem"> | null) {
  try {
    const source = storage === undefined ? globalThis.localStorage : storage;
    const value = Number(source?.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value >= 320 && value <= 720
      ? clampPanelWidth(value)
      : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}
