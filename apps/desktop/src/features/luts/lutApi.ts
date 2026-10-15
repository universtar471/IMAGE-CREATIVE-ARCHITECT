/** LUT library helpers over the typed bridge (API §21.2). */
import { isTauri } from "@tauri-apps/api/core";
import type { LutItem } from "../../lib/bridge";
import { t } from "../../i18n";

/** One page of the grid (API §21.3). */
export const LUT_PAGE_SIZE = 60;
/** Thumbnail edge requested from `lut_preview` / `grade_preview`. */
export const THUMB_SIZE = 256;

/**
 * Ask for a folder of `.cube` files through the native dialog. In the browser preview
 * (mock backend) there is no folder picker, so a path is typed instead.
 */
export async function pickLutFolder(): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false, title: t("luts.pickTitle") });
    if (!picked) return null;
    return Array.isArray(picked) ? (picked[0] ?? null) : picked;
  }
  const typed = window.prompt(t("luts.pickTitle"));
  return typed?.trim() ? typed.trim() : null;
}

export type LutGroup = { key: string; pack: string; category: string; items: LutItem[] };

/** Group one page by pack, then category, keeping the backend order inside a group. */
export function groupLuts(items: readonly LutItem[]): LutGroup[] {
  const groups = new Map<string, LutGroup>();
  for (const item of items) {
    const key = `${item.pack}\u0000${item.category}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, pack: item.pack, category: item.category, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.pack.localeCompare(b.pack, undefined, { sensitivity: "base" }) ||
      a.category.localeCompare(b.category, undefined, { sensitivity: "base" }),
  );
}
