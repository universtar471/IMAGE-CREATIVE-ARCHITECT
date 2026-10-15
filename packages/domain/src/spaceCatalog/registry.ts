import {
  SPACE_CATEGORIES,
  SpaceCatalogFileSchema,
  type BuildingArchetype,
  type SpaceCategory,
  type SpacePreset,
} from "./schemas";

export type SpaceCatalogIssue = { message: string };

/**
 * In-memory lookup over the generated catalog JSON. Like {@link KnowledgeRegistry}, invalid
 * data is reported in `issues`, never thrown, so a broken catalog cannot block a project from
 * opening (it then behaves as an empty catalog).
 */
export class SpaceCatalogRegistry {
  readonly archetypes: readonly BuildingArchetype[];
  readonly presets: readonly SpacePreset[];
  readonly issues: SpaceCatalogIssue[] = [];
  private readonly byId = new Map<string, SpacePreset>();

  constructor(raw: unknown) {
    const parsed = SpaceCatalogFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.issues.push({
        message: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid catalog"}`,
      });
      this.archetypes = [];
      this.presets = [];
      return;
    }
    this.archetypes = parsed.data.archetypes;
    this.presets = parsed.data.presets;
    for (const preset of this.presets) {
      if (this.byId.has(preset.id))
        this.issues.push({ message: `duplicate preset id ${preset.id}` });
      this.byId.set(preset.id, preset);
    }
  }

  preset(id: string | null | undefined): SpacePreset | null {
    return (id && this.byId.get(id)) || null;
  }

  archetype(id: string | null | undefined): BuildingArchetype | null {
    return this.archetypes.find((a) => a.id === id) ?? null;
  }

  /** Presets of an archetype in catalog order (the source's category grouping). */
  spacesFor(archetype: string): SpacePreset[] {
    return this.presets.filter((p) => p.buildingArchetypes.includes(archetype));
  }

  /** Categories that have at least one preset for the archetype, in {@link SPACE_CATEGORIES} order. */
  categoriesFor(archetype: string): SpaceCategory[] {
    const used = new Set(this.spacesFor(archetype).map((p) => p.category));
    return SPACE_CATEGORIES.filter((c) => used.has(c));
  }

  get size(): number {
    return this.presets.length;
  }
}
