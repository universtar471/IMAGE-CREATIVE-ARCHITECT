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

export type ShotIntent = {
  projectType: ProjectType;
  /** The DNA camera being rendered; unknown ids are ignored, as in the compiler. */
  cameraId?: string | null;
  /** P1: the target space of the Space Catalog. */
  targetSpaceId?: string | null;
  /** P2: the target architectural detail. */
  targetDetailId?: string | null;
  /** P2d: objects added to this shot. Absent or empty adds nothing. */
  sceneObjects?: SceneObjectRequest[];
  /** P2a: the visual camera choice, kept in the shot snapshot and never in DNA. */
  visualIntent?: VisualIntent;
};

/** Runtime contract of the snapshot (mirrored by the Rust `ShotIntent` DTO). */
export const ShotIntentSchema = z.object({
  projectType: ProjectTypeSchema,
  cameraId: z.string().nullable().optional(),
  targetSpaceId: z.string().nullable().optional(),
  targetDetailId: z.string().nullable().optional(),
  sceneObjects: z.array(SceneObjectRequestSchema).optional(),
  visualIntent: VisualIntentSchema.optional(),
});
