import type { ProjectType } from "../schemas/enums";
import {
  DEFAULT_SUBTYPE,
  KnowledgePackSchema,
  type CameraPreset,
  type LightingPreset,
  type WeatherPreset,
  type MoodPreset,
  type KnowledgePack,
} from "./pack";

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

  /**
   * Camera presets for a project type/subtype. Resolution follows {@link resolve}
   * (exact → type default → custom); a resolved pack without presets falls through to the
   * next candidate, so a subtype pack may omit them and inherit its type's set.
   */
  cameraPresets(projectType: ProjectType, subtype?: string | null): CameraPreset[] {
    const candidates = [
      subtype ? this.packs.get(key(projectType, subtype)) : undefined,
      this.packs.get(key(projectType, DEFAULT_SUBTYPE)),
      this.packs.get(key("custom", DEFAULT_SUBTYPE)),
    ];
    for (const pack of candidates) {
      if (pack?.cameraPresets.length) return pack.cameraPresets;
    }
    return [];
  }

  lightingPresets(projectType: ProjectType, subtype?: string | null): LightingPreset[] {
    return this.resolvePresetList(projectType, subtype, (pack) => pack.lightingPresets);
  }

  weatherPresets(projectType: ProjectType, subtype?: string | null): WeatherPreset[] {
    return this.resolvePresetList(projectType, subtype, (pack) => pack.weatherPresets);
  }

  moodPresets(projectType: ProjectType, subtype?: string | null): MoodPreset[] {
    return this.resolvePresetList(projectType, subtype, (pack) => pack.moodPresets);
  }

  private resolvePresetList<T>(
    projectType: ProjectType,
    subtype: string | null | undefined,
    read: (pack: KnowledgePack) => T[],
  ): T[] {
    const candidates = [
      subtype ? this.packs.get(key(projectType, subtype)) : undefined,
      this.packs.get(key(projectType, DEFAULT_SUBTYPE)),
      this.packs.get(key("custom", DEFAULT_SUBTYPE)),
    ];
    for (const pack of candidates) {
      const values = pack ? read(pack) : [];
      if (values.length) return values;
    }
    return [];
  }

  get size(): number {
    return this.packs.size;
  }
}

const key = (type: string, subtype: string) => `${type}/${subtype}`;
