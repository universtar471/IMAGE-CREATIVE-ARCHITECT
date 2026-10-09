import {
  defaultQcSettings,
  buildRepairPrompt,
  parseVisionReply,
  scoreReport,
  QcReportDTOSchema,
  QcSettingsSchema,
  type GenerationParams,
  type GenerationSubmitRequest,
  type PromptBundle,
  type QcArtifact,
  type QcReportDTO,
  type QcSettings,
} from "@arch/domain";

export {
  buildRepairPrompt,
  parseVisionReply,
  scoreReport,
  QcReportDTOSchema,
  QcSettingsSchema,
  defaultQcSettings,
};
export type * from "@arch/domain";

export const DEFAULT_QC_SETTINGS: QcSettings = defaultQcSettings();

/** Guard an async QC response against a project or asset selection change. */
export function isQcResponseCurrent(
  expectedProjectId: string,
  expectedAssetId: string,
  currentProjectId: string | null | undefined,
  currentAssetId: string | null | undefined,
) {
  return expectedProjectId === currentProjectId && expectedAssetId === currentAssetId;
}

export type RepairRequestInput = {
  projectId: string;
  report: QcReportDTO;
  providerId: string;
  modelId: string;
  prompt: PromptBundle | string;
  params: GenerationParams;
};

/** Adapt the domain repair instruction to the persisted generation prompt bundle. */
function repairPromptBundle(prompt: PromptBundle | string): PromptBundle {
  if (typeof prompt !== "string") return prompt;
  return {
    compilerVersion: "qc-domain",
    positivePrompt: prompt,
    negativePrompt: "",
    referenceInstructions: "Use the first reference as the primary comparison.",
    preservationInstructions:
      "Keep everything not explicitly listed in the QC repair prompt unchanged.",
    metadata: {},
  };
}

export function buildRepairGenerationRequest(input: RepairRequestInput): GenerationSubmitRequest {
  const primaryReference = input.report.referenceAssetIds[0];
  if (!primaryReference) throw new Error("A QC report needs a primary reference for repair.");
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    purpose: "repair",
    prompt: repairPromptBundle(input.prompt),
    referenceAssetIds: [input.report.assetId, primaryReference],
    params: { ...input.params, repair: { qcReportId: input.report.id } },
    cameraId: null,
  };
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
