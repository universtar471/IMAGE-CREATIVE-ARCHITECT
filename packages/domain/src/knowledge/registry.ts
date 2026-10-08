import type { ProjectType } from "../schemas/enums";
import { DEFAULT_SUBTYPE, KnowledgePackSchema, type KnowledgePack } from "./pack";

export type PackResolution = {
  pack: KnowledgePack | null;
  /** How the pack was found — useful for showing "using generic defaults" in UI. */
  match: "exact" | "type_default" | "custom_fallback" | "none";
};

export type PackLoadIssue = { source: string; message: string };

/**
 * In-memory registry built from raw pack JSON. Invalid packs are reported, never thrown,
 * so one broken pack cannot block project creation.
 */
export class KnowledgeRegistry {
  private readonly packs = new Map<string, KnowledgePack>();
  readonly issues: PackLoadIssue[] = [];

  constructor(raw: ReadonlyArray<{ source: string; data: unknown }>) {
    for (const { source, data } of raw) {
      const parsed = KnowledgePackSchema.safeParse(data);
      if (!parsed.success) {
        this.issues.push({ source, message: parsed.error.issues[0]?.message ?? "invalid pack" });
        continue;
      }
      this.packs.set(key(parsed.data.projectType, parsed.data.subtype), parsed.data);
    }
  }

  /** Subtypes for a project type, default first, then alphabetical by label. */
  listSubtypes(projectType: ProjectType): KnowledgePack[] {
    return [...this.packs.values()]
      .filter((p) => p.projectType === projectType)
      .sort((a, b) => {
        if (a.subtype === DEFAULT_SUBTYPE) return -1;
        if (b.subtype === DEFAULT_SUBTYPE) return 1;
        return a.label.localeCompare(b.label);
      });
  }

  resolve(projectType: ProjectType, subtype?: string | null): PackResolution {
    if (subtype) {
      const exact = this.packs.get(key(projectType, subtype));
      if (exact) return { pack: exact, match: "exact" };
    }
    const typeDefault = this.packs.get(key(projectType, DEFAULT_SUBTYPE));
    if (typeDefault) return { pack: typeDefault, match: "type_default" };
    const custom = this.packs.get(key("custom", DEFAULT_SUBTYPE));
    if (custom) return { pack: custom, match: "custom_fallback" };
    return { pack: null, match: "none" };
  }

  get size(): number {
    return this.packs.size;
  }
}

const key = (type: string, subtype: string) => `${type}/${subtype}`;
