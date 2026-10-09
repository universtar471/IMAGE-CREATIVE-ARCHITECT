import { z } from "zod";

export const QC_CATEGORIES = ["geometry", "material", "openings", "context", "lighting"] as const;

export const QcCategorySchema = z.enum(QC_CATEGORIES);
export type QcCategory = z.infer<typeof QcCategorySchema>;

const score = z.number().int().min(0).max(100);
const metric = z.number().finite().min(0).max(100);
const threshold = z.number().finite().min(0).max(100);

export const QcScoresSchema = z.object({
  geometry: score,
  material: score,
  openings: score,
  context: score,
  lighting: score,
});
export type QcScores = z.infer<typeof QcScoresSchema>;

export const QcArtifactSeveritySchema = z.enum(["low", "medium", "high"]);
export type QcArtifactSeverity = z.infer<typeof QcArtifactSeveritySchema>;

export const QcArtifactBoxSchema = z
  .tuple([
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
    z.number().min(0).max(1),
  ])
  .nullable();
export type QcArtifactBox = z.infer<typeof QcArtifactBoxSchema>;

export const QcArtifactSchema = z.object({
  label: z.string(),
  severity: QcArtifactSeveritySchema,
  box: QcArtifactBoxSchema,
});
export type QcArtifact = z.infer<typeof QcArtifactSchema>;

export const QcIssueCategorySchema = z.enum([...QC_CATEGORIES, "artifact"]);
export type QcIssueCategory = z.infer<typeof QcIssueCategorySchema>;

export const QcIssueSchema = z.object({
  category: QcIssueCategorySchema,
  text: z.string(),
});
export type QcIssue = z.infer<typeof QcIssueSchema>;

export const QcVisionReplySchema = z.object({
  scores: QcScoresSchema,
  artifacts: z.array(QcArtifactSchema),
  issues: z.array(QcIssueSchema),
  repairInstruction: z.string(),
});
export type QcVisionReply = z.infer<typeof QcVisionReplySchema>;

export const QcVisionSchema = QcVisionReplySchema.extend({
  providerId: z.string(),
  model: z.string(),
});
export type QcVision = z.infer<typeof QcVisionSchema>;

export const QcLocalSchema = z.object({
  edgeAlignment: metric.nullable(),
  sharpness: metric,
  clippedPct: metric,
});
export type QcLocal = z.infer<typeof QcLocalSchema>;

export const QcThresholdsSchema = z.object({
  passMin: threshold,
  categoryMin: threshold,
  highArtifactFails: z.boolean(),
});
export type QcThresholds = z.infer<typeof QcThresholdsSchema>;

export const QcSettingsSchema = QcThresholdsSchema.extend({
  schemaVersion: z.literal(1).default(1),
  passMin: threshold.default(70),
  categoryMin: threshold.default(55),
  highArtifactFails: z.boolean().default(true),
  autoQc: z.enum(["off", "after_generation"]).default("off"),
  autoRepairMax: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  visionProviderId: z.string().nullable().default(null),
  visionModel: z.string().nullable().default(null),
});
export type QcSettings = z.infer<typeof QcSettingsSchema>;

export function defaultQcSettings(): QcSettings {
  return QcSettingsSchema.parse({});
}

export const QC_REPORT_ID_PATTERN = /^QC_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const QcReportIdSchema = z.string().regex(QC_REPORT_ID_PATTERN);

export const QcResultSchema = z.enum(["pass", "warn", "fail", "unscored"]);
export type QcResult = z.infer<typeof QcResultSchema>;

export const QcReportDTOSchema = z.object({
  id: QcReportIdSchema,
  projectId: z.string(),
  assetId: z.string(),
  referenceAssetIds: z.array(z.string()),
  local: QcLocalSchema,
  vision: QcVisionSchema.nullable(),
  overall: z.number().min(0).max(100).nullable(),
  result: QcResultSchema,
  thresholds: QcThresholdsSchema,
  createdAt: z.string(),
});
export type QcReportDTO = z.infer<typeof QcReportDTOSchema>;

export const QcRunRequestSchema = z.object({
  projectId: z.string(),
  assetId: z.string(),
  vision: z
    .object({
      providerId: z.string(),
      model: z.string().optional(),
    })
    .nullable(),
});
export type QcRunRequest = z.infer<typeof QcRunRequestSchema>;

export const QcListRequestSchema = z.object({
  projectId: z.string(),
  assetId: z.string().optional(),
});
export type QcListRequest = z.infer<typeof QcListRequestSchema>;

export const QcSettingsGetRequestSchema = z.object({ projectId: z.string() });
export type QcSettingsGetRequest = z.infer<typeof QcSettingsGetRequestSchema>;

export const QcSettingsSetRequestSchema = z.object({
  projectId: z.string(),
  settings: QcSettingsSchema,
});
export type QcSettingsSetRequest = z.infer<typeof QcSettingsSetRequestSchema>;
