/**
 * Scene objects & car library data model (ADR-036 P2d, SRS §7.1–7.2).
 *
 * A `SceneObjectRequest` is a per-shot choice: it lives in `ShotIntent.sceneObjects` and the
 * generation snapshot (`PromptBundle.shotIntent`), never in ProjectDNA.
 */
import { z } from "zod";

/** The object families of the SRS §7.1 picker (later families are out of scope). */
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

/** Types that need a parking or riding zone and are checked by the placement rules. */
export const VEHICLE_TYPES: readonly SceneObjectType[] = ["car", "motorbike", "bicycle"];
export const isVehicleType = (type: SceneObjectType) => VEHICLE_TYPES.includes(type);

export const SCENE_OBJECT_STATES = ["static", "moving"] as const;
export const SceneObjectStateSchema = z.enum(SCENE_OBJECT_STATES);
export type SceneObjectState = z.infer<typeof SceneObjectStateSchema>;

/**
 * Where an object stands. A zone is never created by the prompt: the validator checks that
 * it exists in the project data (space facts, the site front boundary or the space itself).
 */
export const PLACEMENT_ZONE_IDS = [
  "floor",
  "ground",
  "garden",
  "pool_deck",
  "garage_bay",
  "driveway",
  "hardscape",
  "existing_road",
  "sidewalk",
] as const;
export const PlacementZoneIdSchema = z.enum(PLACEMENT_ZONE_IDS);
export type PlacementZoneId = z.infer<typeof PlacementZoneIdSchema>;

/** Paint / colour choices offered for vehicles; a fixed list, so no free text reaches the prompt. */
export const OBJECT_COLOR_IDS = [
  "white",
  "silver",
  "grey",
  "black",
  "red",
  "blue",
  "cream",
  "racing_green",
] as const;
export const ObjectColorIdSchema = z.enum(OBJECT_COLOR_IDS);
export type ObjectColorId = z.infer<typeof ObjectColorIdSchema>;

export const SceneObjectAppearanceSchema = z.object({
  color: ObjectColorIdSchema.optional(),
});
export type SceneObjectAppearance = z.infer<typeof SceneObjectAppearanceSchema>;

/** How prominent the object is in the frame. */
export const SCENE_OBJECT_VISIBILITIES = ["foreground", "midground", "background"] as const;
export const SceneObjectVisibilitySchema = z.enum(SCENE_OBJECT_VISIBILITIES);
export type SceneObjectVisibility = z.infer<typeof SceneObjectVisibilitySchema>;

/** Quantity bounds of one request (the UI offers the same range). */
export const MAX_OBJECT_QUANTITY = 20;

/** One per-shot object request (ADR-036). Unknown preset/space ids are reported by the validator. */
export const SceneObjectRequestSchema = z.object({
  presetId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(MAX_OBJECT_QUANTITY),
  /** A `dna.spaceCatalog` space id, or `SITE_FRONTAGE_TARGET` for the street frontage. */
  targetSpaceId: z.string().trim().min(1),
  /** Absent: the target's default zone for the object type. */
  placementZoneId: PlacementZoneIdSchema.optional(),
  state: SceneObjectStateSchema,
  appearanceOverrides: SceneObjectAppearanceSchema.optional(),
  visibility: SceneObjectVisibilitySchema.optional(),
  /** Reference assets the user has the right to use, for an exact model. */
  sourceReferenceIds: z.array(z.string().trim().min(1)).default([]),
});
export type SceneObjectRequest = z.infer<typeof SceneObjectRequestSchema>;
/** The request as built by code (defaults may be omitted). */
export type SceneObjectRequestInput = z.input<typeof SceneObjectRequestSchema>;

export const SceneObjectPresetSchema = z.object({
  id: z.string().trim().min(1),
  type: SceneObjectTypeSchema,
  /** UI label; a branded car's label is shown with "mô phỏng theo mẫu xe". */
  labelVi: z.string().trim().min(1),
  labelEn: z.string().trim().min(1),
  /** English prompt description, singular and plural ("ONE …", "TWO …"). */
  promptEn: z.string().trim().min(1),
  promptPluralEn: z.string().trim().min(1),
  /** True for a named model: the AI only simulates it (SRS §7.2). */
  simulatedModel: z.boolean().default(false),
  /** Shown for branded models before commercial publishing. */
  trademarkWarning: z.boolean().default(false),
  /** True when the user may pick a paint / colour (`appearanceOverrides.color`). */
  colorable: z.boolean().default(false),
});
export type SceneObjectPreset = z.infer<typeof SceneObjectPresetSchema>;
