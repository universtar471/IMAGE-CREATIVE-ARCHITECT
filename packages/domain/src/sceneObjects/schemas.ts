import { z } from "zod";

/** The object families supported by the SRS P2d scene-object picker. */
export const SCENE_OBJECT_TYPES = [
  "person",
  "car",
  "motorbike",
  "bicycle",
  "plant",
  "pet",
] as const;
export const SceneObjectTypeSchema = z.enum(SCENE_OBJECT_TYPES);
export type SceneObjectType = z.infer<typeof SceneObjectTypeSchema>;

export const SceneObjectStateSchema = z.enum(["static", "moving"]);
export type SceneObjectState = z.infer<typeof SceneObjectStateSchema>;

/** A per-shot request. It is intentionally not part of ProjectDNA. */
export const SceneObjectRequestSchema = z.object({
  presetId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(50),
  targetSpaceId: z.string().trim().min(1),
  placementZoneId: z.string().trim().min(1).optional(),
  state: SceneObjectStateSchema,
  appearanceOverrides: z.record(z.string(), z.unknown()).optional(),
  visibility: z.record(z.string(), z.unknown()).optional(),
  sourceReferenceIds: z.array(z.string().trim().min(1)).default([]),
});
export type SceneObjectRequest = z.infer<typeof SceneObjectRequestSchema>;

export const SceneObjectPresetSchema = z.object({
  id: z.string().trim().min(1),
  type: SceneObjectTypeSchema,
  labelVi: z.string().trim().min(1),
  labelEn: z.string().trim().min(1),
  promptEn: z.string().trim().min(1),
  /** Every branded or identifiable car carries this UI warning. */
  trademarkWarning: z.string().trim().min(1).optional(),
});
export type SceneObjectPreset = z.infer<typeof SceneObjectPresetSchema>;
