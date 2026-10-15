/** Context Library V4 reference data and suggestion output (ADR-034 amendment 1). */
import { z } from "zod";

export const CONTEXT_LIBRARY_VERSION = "cl-4.0.0" as const;
export const CONTEXT_ARCHETYPE_IDS = [
  "townhouse",
  "villa",
  "apartment",
  "hotel",
  "resort",
] as const;
export type ContextArchetype = (typeof CONTEXT_ARCHETYPE_IDS)[number];

const text = z.string().trim().min(1);
const english = text.regex(/^[\x20-\x7e]+$/, "English text must be ASCII.");

export const ContextBuildingTypeSchema = z.object({ id: text, nameVi: text, nameEn: english });
export type ContextBuildingType = z.infer<typeof ContextBuildingTypeSchema>;

export const ContextRegionSchema = z.object({
  id: text,
  name: text,
  nameEn: english,
  climate: english,
  details: z.array(english),
  avoid: z.array(english),
});
export type ContextRegion = z.infer<typeof ContextRegionSchema>;

export const ContextLibraryPresetSchema = z.object({
  id: text,
  buildingType: z.enum(CONTEXT_ARCHETYPE_IDS),
  buildingTypeVi: text,
  nameVi: text,
  nameEn: english,
  requiredIfSupported: z.array(english),
  optional: z.array(english),
  forbiddenByDefault: z.array(english),
  regionCompatibility: text,
  englishPrompt: english,
});
export type ContextLibraryPreset = z.infer<typeof ContextLibraryPresetSchema>;

export const ContextLibraryFileSchema = z.object({
  libraryVersion: z.literal(CONTEXT_LIBRARY_VERSION),
  sourceVersion: text,
  buildingTypes: z.array(ContextBuildingTypeSchema),
  regions: z.array(ContextRegionSchema),
  presets: z.array(ContextLibraryPresetSchema),
});
export type ContextLibraryFile = z.infer<typeof ContextLibraryFileSchema>;

export type ContextSuggestionResult = {
  requiredLines: string[];
  optionalLines: string[];
  forbiddenLines: string[];
  regionDetails: string[];
  regionAvoid: string[];
  droppedForEvidence: string[];
};
