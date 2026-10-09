import type { GenerationParams, PromptBundle } from "@arch/domain";
import { z } from "zod";

/** Phase 6 UI stand-ins. Replace these with @arch/domain qc exports when p6-domain lands. TODO(p6-domain) */
export type QcResult = "pass" | "warn" | "fail" | "unscored";
export type QcScores = {
  geometry: number;
  material: number;
  openings: number;
  context: number;
  lighting: number;
};
export type QcArtifact = {
  label: string;
  severity: "low" | "medium" | "high";
  box: [number, number, number, number] | null;
};
export type QcIssue = {
  category: "geometry" | "material" | "openings" | "context" | "lighting" | "artifact";
  text: string;
};
export type QcVision = {
  providerId: string;
  model: string;
  scores: QcScores;
  artifacts: QcArtifact[];
  issues: QcIssue[];
  repairInstruction: string;
};
export type QcLocal = { edgeAlignment: number | null; sharpness: number; clippedPct: number };
export type QcSettings = {
  schemaVersion: 1;
  passMin: number;
  categoryMin: number;
  highArtifactFails: boolean;
  autoQc: "off" | "after_generation";
  autoRepairMax: 0 | 1 | 2;
  visionProviderId: string | null;
  visionModel: string | null;
};
export type QcReportDTO = {
  id: `QC_${string}` | string;
  projectId: string;
  assetId: string;
  referenceAssetIds: string[];
  local: QcLocal;
  vision: QcVision | null;
  overall: number | null;
  result: QcResult;
  thresholds: Pick<QcSettings, "passMin" | "categoryMin" | "highArtifactFails">;
  createdAt: string;
};
export type QcRunRequest = {
  projectId: string;
  assetId: string;
  vision: { providerId: string; model?: string } | null;
};

export const DEFAULT_QC_SETTINGS: QcSettings = {
  schemaVersion: 1,
  passMin: 70,
  categoryMin: 55,
  highArtifactFails: true,
  autoQc: "off",
  autoRepairMax: 0,
  visionProviderId: null,
  visionModel: null,
};

export const QcScoresSchema = z.object({
  geometry: z.number().int().min(0).max(100),
  material: z.number().int().min(0).max(100),
  openings: z.number().int().min(0).max(100),
  context: z.number().int().min(0).max(100),
  lighting: z.number().int().min(0).max(100),
});
export const QcArtifactSchema = z.object({
  label: z.string(),
  severity: z.enum(["low", "medium", "high"]),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});
export const QcIssueSchema = z.object({
  category: z.enum(["geometry", "material", "openings", "context", "lighting", "artifact"]),
  text: z.string(),
});
export const QcVisionSchema = z.object({
  providerId: z.string(),
  model: z.string(),
  scores: QcScoresSchema,
  artifacts: z.array(QcArtifactSchema),
  issues: z.array(QcIssueSchema),
  repairInstruction: z.string(),
});
export const QcLocalSchema = z.object({
  edgeAlignment: z.number().nullable(),
  sharpness: z.number(),
  clippedPct: z.number(),
});
export const QcSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  passMin: z.number().min(0).max(100),
  categoryMin: z.number().min(0).max(100),
  highArtifactFails: z.boolean(),
  autoQc: z.enum(["off", "after_generation"]),
  autoRepairMax: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  visionProviderId: z.string().nullable(),
  visionModel: z.string().nullable(),
});
export const QcReportDTOSchema = z.object({
  id: z.string().regex(/^QC_[A-Z0-9]+$/),
  projectId: z.string(),
  assetId: z.string(),
  referenceAssetIds: z.array(z.string()),
  local: QcLocalSchema,
  vision: QcVisionSchema.nullable(),
  overall: z.number().nullable(),
  result: z.enum(["pass", "warn", "fail", "unscored"]),
  thresholds: z.object({
    passMin: z.number(),
    categoryMin: z.number(),
    highArtifactFails: z.boolean(),
  }),
  createdAt: z.string(),
});

export function scoreReport(
  local: QcLocal,
  vision: QcVision | null,
  thresholds: Pick<QcSettings, "passMin" | "categoryMin" | "highArtifactFails">,
): { overall: number | null; result: QcResult } {
  const overall = vision
    ? (vision.scores.geometry +
        vision.scores.material +
        vision.scores.openings +
        vision.scores.context +
        vision.scores.lighting) /
      5
    : local.edgeAlignment;
  if (overall === null) return { overall: null, result: "unscored" };
  const categories = vision ? Object.values(vision.scores) : [];
  const highArtifact = vision?.artifacts.some((artifact) => artifact.severity === "high") ?? false;
  if (
    categories.some((score) => score < thresholds.categoryMin) ||
    overall < thresholds.passMin ||
    (thresholds.highArtifactFails && highArtifact)
  )
    return { overall, result: "fail" };
  return { overall, result: overall < thresholds.passMin + 10 ? "warn" : "pass" };
}

export function parseVisionReply(text: string): QcVision {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Vision response did not contain JSON.");
  const raw = JSON.parse(text.slice(start, end + 1)) as Partial<QcVision>;
  try {
    return QcVisionSchema.parse({
      providerId: raw.providerId ?? "",
      model: raw.model ?? "",
      scores: raw.scores,
      artifacts: raw.artifacts,
      issues: raw.issues,
      repairInstruction: raw.repairInstruction,
    });
  } catch {
    throw new Error("Vision response has invalid scores or details.");
  }
}

export function buildVisionPrompt({ dna, purpose }: { dna: unknown; purpose: string }) {
  return {
    system: "Return strict JSON with scores, artifacts, issues and repairInstruction.",
    user: `Judge this ${purpose} image against the references. Project DNA: ${JSON.stringify(dna)}`,
  };
}

export function buildRepairPrompt({ dna, report }: { dna: unknown; report: QcReportDTO }) {
  const issues =
    report.vision?.issues.map((issue) => `${issue.category}: ${issue.text}`).join("\n") ?? "";
  return {
    compilerVersion: "qc-ui-standin",
    positivePrompt: `Repair QC report ${report.id}. ${report.vision?.repairInstruction ?? "Improve local alignment and clarity."}\n${issues}`,
    negativePrompt: "",
    referenceInstructions: "Use the first reference as the primary comparison.",
    preservationInstructions: `Keep everything not listed in the QC report. Project DNA: ${JSON.stringify(dna)}`,
    metadata: { qcReportId: report.id },
  } satisfies PromptBundle;
}

export type RepairRequestInput = {
  projectId: string;
  report: QcReportDTO;
  providerId: string;
  modelId: string;
  prompt:
    | PromptBundle
    | { positivePrompt: string; negativePrompt: string; preservationInstructions: string };
  params: GenerationParams;
};

/** `repair` is added by p6-domain; the cast keeps this branch typecheckable before integration. TODO(p6-domain) */
export function buildRepairGenerationRequest(input: RepairRequestInput) {
  const primaryReference = input.report.referenceAssetIds[0];
  if (!primaryReference) throw new Error("A QC report needs a primary reference for repair.");
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    purpose: "repair" as const,
    prompt: input.prompt,
    referenceAssetIds: [input.report.assetId, primaryReference],
    params: { ...input.params, repair: { qcReportId: input.report.id } },
    cameraId: null,
  } as unknown as Record<string, unknown>;
}

export type DisplayRect = { left: number; top: number; width: number; height: number };
export function mapArtifactBox(box: QcArtifact["box"], rect: DisplayRect) {
  if (!box) return null;
  const [x, y, width, height] = box;
  return {
    left: rect.left + x * rect.width,
    top: rect.top + y * rect.height,
    width: width * rect.width,
    height: height * rect.height,
  };
}

export function latestQcByAsset(reports: readonly QcReportDTO[]) {
  const latest = new Map<string, QcReportDTO>();
  for (const report of reports) {
    const current = latest.get(report.assetId);
    if (!current || report.createdAt > current.createdAt) latest.set(report.assetId, report);
  }
  return latest;
}

export function createQcId(now = Date.now()) {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let suffix = now.toString(32).toUpperCase().padStart(10, "0");
  while (suffix.length < 26) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `QC_${suffix.slice(0, 26)}`;
}
