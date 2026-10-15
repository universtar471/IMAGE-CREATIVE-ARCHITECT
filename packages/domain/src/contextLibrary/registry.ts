import libraryData from "../../../../knowledge/context-library/library.json";
import {
  CONTEXT_LIBRARY_VERSION,
  ContextLibraryFileSchema,
  type ContextBuildingType,
  type ContextLibraryPreset,
  type ContextRegion,
} from "./schemas";

export type ContextLibraryIssue = { message: string };

export class ContextLibraryRegistry {
  readonly version = CONTEXT_LIBRARY_VERSION;
  readonly buildingTypes: readonly ContextBuildingType[];
  readonly regions: readonly ContextRegion[];
  readonly presets: readonly ContextLibraryPreset[];
  readonly issues: ContextLibraryIssue[] = [];
  private readonly byPresetId = new Map<string, ContextLibraryPreset>();
  private readonly byRegionId = new Map<string, ContextRegion>();

  constructor(raw: unknown) {
    const parsed = ContextLibraryFileSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      this.buildingTypes = [];
      this.regions = [];
      this.presets = [];
      this.issues.push({
        message: `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "invalid library"}`,
      });
      return;
    }
    this.buildingTypes = parsed.data.buildingTypes;
    this.regions = parsed.data.regions;
    this.presets = parsed.data.presets;
    for (const preset of this.presets) {
      if (this.byPresetId.has(preset.id))
        this.issues.push({ message: `duplicate preset id ${preset.id}` });
      this.byPresetId.set(preset.id, preset);
    }
    for (const region of this.regions) {
      if (this.byRegionId.has(region.id))
        this.issues.push({ message: `duplicate region id ${region.id}` });
      this.byRegionId.set(region.id, region);
    }
  }

  preset(id: string | null | undefined): ContextLibraryPreset | null {
    return (id && this.byPresetId.get(id)) || null;
  }

  region(id: string | null | undefined): ContextRegion | null {
    return (id && this.byRegionId.get(id)) || null;
  }

  suggestionsFor(archetype: string, _regionId?: string | null): ContextLibraryPreset[] {
    return this.presets.filter((preset) => preset.buildingType === archetype);
  }
}

export const CONTEXT_LIBRARY = new ContextLibraryRegistry(libraryData);

export function contextSuggestionsFor(
  archetype: string,
  regionId?: string | null,
): ContextLibraryPreset[] {
  return CONTEXT_LIBRARY.suggestionsFor(archetype, regionId);
}
