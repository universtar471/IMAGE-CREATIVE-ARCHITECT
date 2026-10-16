/**
 * Diagram Studio shapes (ADR-037, SRS §10).
 *
 * A diagram is a short sequence of steps planned from the project's DNA facts. Every step
 * says how well it is backed (`evidence`); text, arrows and labels are vector data laid out
 * by `layoutDiagramSheet`, never pixels drawn by an image model.
 */
import { z } from "zod";

export const DIAGRAM_TYPES = [
  "concept_evolution",
  "massing_voids",
  "functional_zoning",
  "circulation",
  "sun_ventilation",
  "facade_material",
] as const;
export const DiagramTypeSchema = z.enum(DIAGRAM_TYPES);
export type DiagramType = z.infer<typeof DiagramTypeSchema>;

/**
 * - `verified`: backed by confirmed project facts.
 * - `inferred`: plausible from the sources, not confirmed.
 * - `illustrative`: an idea; always labelled "sơ đồ diễn giải ý tưởng".
 */
export const DIAGRAM_EVIDENCE = ["verified", "inferred", "illustrative"] as const;
export const DiagramEvidenceSchema = z.enum(DIAGRAM_EVIDENCE);
export type DiagramEvidence = z.infer<typeof DiagramEvidenceSchema>;

/** `RxC` grids (rows × columns, extra rows when there are more steps) or one row. */
export const DIAGRAM_LAYOUTS = ["2x2", "2x3", "2x4", "linear"] as const;
export const DiagramLayoutSchema = z.enum(DIAGRAM_LAYOUTS);
export type DiagramLayout = z.infer<typeof DiagramLayoutSchema>;

export const DIAGRAM_LANGUAGES = ["vi", "en"] as const;
export const DiagramLanguageSchema = z.enum(DIAGRAM_LANGUAGES);
export type DiagramLanguage = z.infer<typeof DiagramLanguageSchema>;

/** The building families whose step sequences differ (SRS §10.1). */
export const DIAGRAM_FAMILIES = ["townhouse", "villa", "generic"] as const;
export type DiagramFamily = (typeof DIAGRAM_FAMILIES)[number];

export const DIAGRAM_STEP_PRESETS = [4, 6, 8] as const;
export const DIAGRAM_MIN_STEPS = 2;
export const DIAGRAM_MAX_STEPS = 12;

export const LocalizedTextSchema = z.object({
  vi: z.string().trim().min(1),
  en: z.string().trim().min(1),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

/** 0..1 inside the step's image frame; (0,0) is the top-left corner. */
export const NormalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type NormalizedPoint = z.infer<typeof NormalizedPointSchema>;

export const DiagramAnnotationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("label"),
    label: LocalizedTextSchema,
    position: NormalizedPointSchema,
  }),
  z.object({
    kind: z.literal("arrow"),
    label: LocalizedTextSchema.optional(),
    from: NormalizedPointSchema,
    to: NormalizedPointSchema,
  }),
]);
export type DiagramAnnotation = z.infer<typeof DiagramAnnotationSchema>;

export const DiagramStepSchema = z.object({
  id: z.string().trim().min(1),
  index: z.number().int().nonnegative(),
  title: LocalizedTextSchema,
  caption: LocalizedTextSchema,
  evidence: DiagramEvidenceSchema,
  annotations: z.array(DiagramAnnotationSchema).default([]),
  /** Optional generated isometric frame (an asset of the project). */
  frameAssetId: z.string().trim().min(1).optional(),
  /** The step states interior functions (rooms, zones, stairs): needs plan evidence. */
  interior: z.boolean().default(false),
  /** DNA paths of the facts that back the evidence (empty for illustrative steps). */
  basis: z.array(z.string().trim().min(1)).default([]),
  /** The user approved this step for export. Any edit clears it. */
  approved: z.boolean().default(false),
});
export type DiagramStep = z.infer<typeof DiagramStepSchema>;

/** Optional sources next to the render (SRS §10.2). */
export const DiagramSourcesSchema = z.object({
  floorPlan: z.boolean().default(false),
  elevation: z.boolean().default(false),
  model3d: z.boolean().default(false),
});
export type DiagramSources = z.infer<typeof DiagramSourcesSchema>;

export const DiagramPlanSchema = z.object({
  version: z.literal(1),
  type: DiagramTypeSchema,
  family: z.enum(DIAGRAM_FAMILIES),
  /** True when confirmed space facts exist, so an interior step may be marked verified. */
  interiorVerifiable: z.boolean(),
  steps: z.array(DiagramStepSchema).min(DIAGRAM_MIN_STEPS).max(DIAGRAM_MAX_STEPS),
});
export type DiagramPlan = z.infer<typeof DiagramPlanSchema>;

/** 4, 6, 8 or a custom count between `DIAGRAM_MIN_STEPS` and `DIAGRAM_MAX_STEPS`. */
export type DiagramStepCount = (typeof DIAGRAM_STEP_PRESETS)[number] | number;

export function parseDiagramStepCount(value: DiagramStepCount): number {
  if (!Number.isInteger(value) || value < DIAGRAM_MIN_STEPS || value > DIAGRAM_MAX_STEPS) {
    throw new RangeError(
      `Diagram step count must be an integer between ${DIAGRAM_MIN_STEPS} and ${DIAGRAM_MAX_STEPS}.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------- export DTOs

/** How one frame moves in the MP4 (FFmpeg, ADR-037). */
export const DIAGRAM_VIDEO_MOTIONS = ["appear", "zoom", "pan"] as const;
export const DiagramVideoMotionSchema = z.enum(DIAGRAM_VIDEO_MOTIONS);
export type DiagramVideoMotion = z.infer<typeof DiagramVideoMotionSchema>;

export const DiagramVideoFrameSchema = z.object({
  /** A managed file of the project (a rasterized step frame). */
  path: z.string().trim().min(1),
  durationMs: z.number().int().min(500).max(20_000),
  motion: DiagramVideoMotionSchema,
});
export type DiagramVideoFrame = z.infer<typeof DiagramVideoFrameSchema>;

export const DiagramVideoExportRequestSchema = z.object({
  projectId: z.string().trim().min(1),
  frames: z.array(DiagramVideoFrameSchema).min(1).max(DIAGRAM_MAX_STEPS),
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(240).max(2160),
  fps: z.number().int().min(12).max(60),
});
export type DiagramVideoExportRequest = z.infer<typeof DiagramVideoExportRequestSchema>;

export const DiagramVideoExportResultSchema = z.object({
  path: z.string(),
  durationMs: z.number().int().nonnegative(),
  frameCount: z.number().int().positive(),
});
export type DiagramVideoExportResult = z.infer<typeof DiagramVideoExportResultSchema>;

export const FfmpegStatusSchema = z.object({
  available: z.boolean(),
  /** First line of `ffmpeg -version`; null when FFmpeg is missing. */
  version: z.string().nullable(),
});
export type FfmpegStatus = z.infer<typeof FfmpegStatusSchema>;

/** A rasterized sheet or frame saved as a new asset derived from `parentAssetId`. */
export const DiagramImageSaveRequestSchema = z.object({
  projectId: z.string().trim().min(1),
  parentAssetId: z.string().trim().min(1),
  /** Base64 of the PNG bytes (no `data:` prefix). */
  pngBase64: z.string().min(1),
  label: z.string().trim().min(1).max(200),
  kind: z.enum(["sheet", "frame"]),
  /** Recorded as the asset's operation JSON (type, layout, language, step ids). */
  meta: z.record(z.string(), z.unknown()).default({}),
});
export type DiagramImageSaveRequest = z.infer<typeof DiagramImageSaveRequestSchema>;
/** What the UI sends (`meta` may be omitted). */
export type DiagramImageSaveRequestInput = z.input<typeof DiagramImageSaveRequestSchema>;
