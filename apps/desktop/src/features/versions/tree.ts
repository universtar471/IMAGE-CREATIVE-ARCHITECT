import type { VersionDTO } from "../../lib/bridge";

export type VersionNode = { version: VersionDTO; depth: number; childCount: number };

/**
 * Flatten versions into a depth-first lineage tree built from `parentVersionId`.
 * Roots are versions without a parent or whose parent is gone (e.g. removed asset).
 * Siblings are ordered by creation time, oldest first; cycles cannot hang the walk.
 */
export function buildVersionTree(versions: readonly VersionDTO[]): VersionNode[] {
  const ids = new Set(versions.map((v) => v.id));
  const children = new Map<string | null, VersionDTO[]>();
  for (const v of versions) {
    const parent = v.parentVersionId && ids.has(v.parentVersionId) ? v.parentVersionId : null;
    const list = children.get(parent) ?? [];
    list.push(v);
    children.set(parent, list);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }
  const out: VersionNode[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const v of children.get(parent) ?? []) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      out.push({ version: v, depth, childCount: children.get(v.id)?.length ?? 0 });
      walk(v.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
