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

export const DIAGRAM_EVIDENCE = ["verified", "inferred", "illustrative"] as const;
export const DiagramEvidenceSchema = z.enum(DIAGRAM_EVIDENCE);
export type DiagramEvidence = z.infer<typeof DiagramEvidenceSchema>;

export const DIAGRAM_LAYOUTS = ["2x2", "2x3", "2x4", "linear"] as const;
export const DiagramLayoutSchema = z.enum(DIAGRAM_LAYOUTS);
export type DiagramLayout = z.infer<typeof DiagramLayoutSchema>;

export const DiagramLanguageSchema = z.enum(["vi", "en"]);
export type DiagramLanguage = z.infer<typeof DiagramLanguageSchema>;

export const LocalizedTextSchema = z.object({
  vi: z.string().trim().min(1),
  en: z.string().trim().min(1),
});
export type LocalizedText = z.infer<typeof LocalizedTextSchema>;

const NormalizedPointSchema = z.object({
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
  frameAssetId: z.string().trim().min(1).optional(),
});
export type DiagramStep = z.infer<typeof DiagramStepSchema>;

export const DiagramPlanSchema = z.object({
  type: DiagramTypeSchema,
  steps: z.array(DiagramStepSchema).min(1),
});
export type DiagramPlan = z.infer<typeof DiagramPlanSchema>;

export type DiagramStepCount = 4 | 6 | 8 | number;

export function parseDiagramStepCount(value: DiagramStepCount): number {
  if (!Number.isInteger(value) || value < 1 || value > 24) {
    throw new RangeError("Diagram step count must be an integer between 1 and 24.");
  }
  return value;
}
