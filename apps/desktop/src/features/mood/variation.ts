import {
  adoptMoodPreset as adoptDomainMoodPreset,
  buildMoodVariationItems as buildDomainMoodVariationItems,
  type BatchItem,
  type GenerationParams,
  type KnowledgePack,
  type ModelCapabilities,
  type ProjectDNA,
  type ProjectDTO,
} from "@arch/domain";

/** UI preset shape; the adapter passes validated pack presets to the domain. */
export type MoodVariationPreset = {
  id: string;
  label: string;
  tags?: string[];
  values?: Record<string, unknown>;
};

type Input = {
  dna: ProjectDNA;
  project: Pick<ProjectDTO, "id" | "name" | "projectType" | "subtype">;
  pack: KnowledgePack | null;
  assets: readonly { id: string; role: string; originalName?: string | null }[];
  sourceAssetId: string;
  presets: readonly MoodVariationPreset[];
  model: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages">;
  params: GenerationParams;
};

/** Keep the UI-facing asset shape while delegating prompt construction to the domain. */
export function buildMoodVariationItems(input: Input): BatchItem[] {
  return buildDomainMoodVariationItems({
    ...input,
    assets: input.assets as never,
    model: input.model as ModelCapabilities,
    presets: input.presets as never,
  });
}

/** Delegate lock-aware preset adoption to the domain implementation. */
export function adoptMoodPreset(dna: ProjectDNA, preset: MoodVariationPreset): ProjectDNA {
  return adoptDomainMoodPreset(dna, preset as never);
}
