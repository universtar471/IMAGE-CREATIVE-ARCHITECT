import {
  compilePrompt,
  type BatchItem,
  type GenerationParams,
  type ModelCapabilities,
  type ProjectDNA,
  type ProjectDTO,
  type PromptBundle,
} from "@arch/domain";

export type MoodVariationPreset = {
  id: string;
  label: string;
  values?: {
    lighting?: Record<string, unknown>;
    weather?: Record<string, unknown>;
    mood?: Record<string, unknown>;
  };
  lighting?: Record<string, unknown>;
  weather?: Record<string, unknown>;
  mood?: Record<string, unknown>;
};

function sectionValues(preset: MoodVariationPreset, section: "lighting" | "weather" | "mood") {
  const values = (preset.values ?? {}) as Record<string, unknown>;
  const nested = values[section];
  if (nested && typeof nested === "object") return nested as Record<string, unknown>;
  const raw = preset[section];
  if (raw) return raw;
  const keys =
    section === "lighting"
      ? ["timeOfDay", "sunDirection", "intensity", "artificialLighting"]
      : section === "weather"
        ? ["sky", "humidity", "groundWetness", "haze"]
        : ["preset", "contrast", "saturation", "warmth", "atmosphere"];
  return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
}

type Input = {
  dna: ProjectDNA;
  project: Pick<ProjectDTO, "id" | "name" | "projectType" | "subtype">;
  pack: unknown;
  assets: readonly { id: string; role: string; originalName?: string | null }[];
  sourceAssetId: string;
  presets: readonly MoodVariationPreset[];
  model: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages">;
  params: GenerationParams;
};

/** Build one ordinary batch item per selected mood preset, preserving the source first. */
export function buildMoodVariationItems(input: Input): BatchItem[] {
  const source = input.assets.find((a) => a.id === input.sourceAssetId);
  if (!source) throw new Error("The mood variation source image was not found.");
  if (!input.model.imageToImage || input.model.maxReferenceImages < 1)
    throw new Error("The selected model cannot accept the source image as a reference.");
  const refs = [
    { assetId: source.id, role: source.role as never, label: source.originalName ?? source.id },
  ];
  return input.presets.map((preset) => {
    const locks = input.dna.locks as unknown as Record<string, boolean>;
    const dna = {
      ...input.dna,
      lighting: locks.lighting
        ? input.dna.lighting
        : input.dna.lighting
          ? { ...input.dna.lighting, ...sectionValues(preset, "lighting") }
          : sectionValues(preset, "lighting"),
      weather: locks.weather
        ? input.dna.weather
        : input.dna.weather
          ? { ...input.dna.weather, ...sectionValues(preset, "weather") }
          : sectionValues(preset, "weather"),
      mood: locks.mood
        ? input.dna.mood
        : input.dna.mood
          ? { ...input.dna.mood, ...sectionValues(preset, "mood") }
          : sectionValues(preset, "mood"),
    } as ProjectDNA;
    const base = compilePrompt({
      project: input.project,
      dna,
      pack: input.pack as never,
      references: refs,
    });
    const prompt: PromptBundle = {
      ...base,
      preservationInstructions: `${base.preservationInstructions}${base.preservationInstructions ? "\n" : ""}Keep the architecture, camera and composition; change only light, weather and atmosphere.`,
    };
    return {
      cameraId: null,
      label: preset.label,
      prompt,
      referenceAssetIds: [source.id],
      params: input.params,
    };
  });
}

export function adoptMoodPreset(dna: ProjectDNA, preset: MoodVariationPreset): ProjectDNA {
  const locks = dna.locks as unknown as Record<string, boolean>;
  return {
    ...dna,
    lighting: locks.lighting
      ? dna.lighting
      : dna.lighting
        ? { ...dna.lighting, ...sectionValues(preset, "lighting") }
        : (sectionValues(preset, "lighting") as never),
    weather: locks.weather
      ? dna.weather
      : dna.weather
        ? { ...dna.weather, ...sectionValues(preset, "weather") }
        : (sectionValues(preset, "weather") as never),
    mood: locks.mood
      ? dna.mood
      : dna.mood
        ? { ...dna.mood, ...sectionValues(preset, "mood") }
        : (sectionValues(preset, "mood") as never),
  };
}
