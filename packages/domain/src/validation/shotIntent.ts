/**
 * The per-shot choices of one generation request (SRS §3.1 Shot Intent, ADR-036).
 *
 * They are never written into ProjectDNA. The desktop keeps the current one per project in
 * the workspace store, and the generation snapshot records it in `PromptBundle.shotIntent`.
 */
import { z } from "zod";
import { VisualIntentSchema, type VisualIntent } from "../camera/intent";
import { ProjectTypeSchema, type ProjectType } from "../schemas/enums";
import { SceneObjectRequestSchema, type SceneObjectRequest } from "../sceneObjects/schemas";
import { ShotEffectsSchema, type ShotEffects } from "../effects/schemas";
import { PresetIdListSchema, ShotLightingSchema, type ShotLighting } from "../presets/schemas";
import { GradeLookIdSchema, type GradeLookId } from "../schemas/future";
import {
  InteriorGenerationSchema,
  type InteriorGenerationState,
} from "../generationPresets/schema";

export type ShotIntent = {
  /** Additive v1 interior workflow; absent on legacy shots and architecture projects. */
  interiorGeneration?: InteriorGenerationState;
  projectType: ProjectType;
  /** The DNA camera being rendered; unknown ids are ignored, as in the compiler. */
  cameraId?: string | null;
  /** P1: the target space of the Space Catalog. */
  targetSpaceId?: string | null;
  /** P2: the target architectural detail. */
  targetDetailId?: string | null;
  /** P2: requested number of detail shots, from 1 through 10. */
  detailShotCount?: number;
  /** P2d: objects added to this shot. Absent or empty adds nothing. */
  sceneObjects?: SceneObjectRequest[];
  /** P2a: the visual camera choice, kept in the shot snapshot and never in DNA. */
  visualIntent?: VisualIntent;
  /** P2c: optical and motion effects. Absent, or without a primary effect, adds nothing. */
  effects?: ShotEffects;
  /** M1 (ADR-039): the selected shot presets, in catalog order. */
  presetIds?: string[];
  /** M1: time of day and weather for this shot only; never written into DNA. */
  lighting?: ShotLighting;
  /** M1: a free post-production look chosen by a preset; it never reaches the prompt. */
  gradeLookId?: GradeLookId;
};

/** Runtime contract of the snapshot (mirrored by the Rust `ShotIntent` DTO). */
export const ShotIntentSchema = z.object({
  interiorGeneration: InteriorGenerationSchema.optional(),
  projectType: ProjectTypeSchema,
  cameraId: z.string().nullable().optional(),
  targetSpaceId: z.string().nullable().optional(),
  targetDetailId: z.string().nullable().optional(),
  detailShotCount: z.number().int().min(1).max(10).optional(),
  sceneObjects: z.array(SceneObjectRequestSchema).optional(),
  visualIntent: VisualIntentSchema.optional(),
  effects: ShotEffectsSchema.optional(),
  presetIds: PresetIdListSchema.optional(),
  lighting: ShotLightingSchema.optional(),
  gradeLookId: GradeLookIdSchema.optional(),
});
