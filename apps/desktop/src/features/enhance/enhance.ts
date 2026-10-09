import type { AssetDTO, BatchItem, GenerationParams, PromptBundle } from "@arch/domain";

/** §14.1. Keep this local until the domain package exports the Phase 5 schema. */
export type EnhanceParams = {
  mode: "conservative" | "generative";
  targetLongEdge: 2048 | 3072 | 4096 | null;
  detailStrength: number;
  architecturePreserve: boolean;
};

export const ENHANCE_TARGETS = [2048, 3072, 4096] as const;
export const DEFAULT_ENHANCE_PARAMS: EnhanceParams = {
  mode: "conservative",
  targetLongEdge: 2048,
  detailStrength: 40,
  architecturePreserve: true,
};

export function disabledEnhanceTargets(
  sourceLongEdge: number,
): Record<(typeof ENHANCE_TARGETS)[number], boolean> {
  return Object.fromEntries(
    ENHANCE_TARGETS.map((target) => [target, target < sourceLongEdge]),
  ) as Record<(typeof ENHANCE_TARGETS)[number], boolean>;
}

export function validateEnhanceParams(
  params: EnhanceParams,
  sourceLongEdge?: number,
): string | null {
  if (
    !Number.isInteger(params.detailStrength) ||
    params.detailStrength < 0 ||
    params.detailStrength > 100
  )
    return "detailStrength must be an integer from 0 to 100.";
  if (params.mode === "conservative" && params.targetLongEdge === null)
    return "targetLongEdge is required for conservative enhancement.";
  if (params.targetLongEdge !== null && sourceLongEdge && params.targetLongEdge < sourceLongEdge)
    return "Enhancement never downsizes; pick a larger target.";
  if (params.targetLongEdge !== null && params.targetLongEdge > 8192)
    return "Enhancement target cannot exceed 8192px.";
  return null;
}

export function enhancePrompt(params: EnhanceParams, dnaSummary = ""): PromptBundle {
  const strength =
    params.detailStrength < 34 ? "low" : params.detailStrength < 67 ? "medium" : "high";
  const preservation = params.architecturePreserve
    ? "Keep geometry, openings, proportions, materials, camera and composition exactly; add only fine detail and texture, and fix soft or noisy areas. Architecture Preserve is on."
    : "Do not change the building, geometry, openings, proportions, camera or composition; add richer fine material detail and texture. Architecture Preserve is off.";
  return {
    compilerVersion: "",
    positivePrompt:
      `Enhance the selected architecture image with ${strength} detail strength. ${dnaSummary}`.trim(),
    negativePrompt: "",
    referenceInstructions:
      "Image 1 is the source image and must remain the architectural reference.",
    preservationInstructions: preservation,
    metadata: { purpose: "enhance", mode: params.mode, detailStrength: params.detailStrength },
  };
}

type EnhanceItemInput = {
  projectId: string;
  assetIds: readonly string[];
  params: EnhanceParams;
  baseParams?: GenerationParams;
  assets?: readonly AssetDTO[];
};

export type EnhanceSubmitPayload = {
  projectId: string;
  providerId: string;
  modelId: string;
  purpose: "enhance";
  referenceAssetIds: [string];
  params: GenerationParams & { enhance: EnhanceParams };
  cameraId: null;
  prompt: PromptBundle;
};

export function buildEnhanceRequest(input: {
  projectId: string;
  providerId: string;
  modelId: string;
  sourceAssetId: string;
  params: EnhanceParams;
  baseParams?: GenerationParams;
}): EnhanceSubmitPayload {
  const base = input.baseParams ?? {
    aspectRatio: null,
    imageSize: null,
    outputCount: 1,
    seed: null,
    quality: null,
  };
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    purpose: "enhance",
    referenceAssetIds: [input.sourceAssetId],
    params: { ...base, enhance: input.params },
    cameraId: null,
    prompt: input.params.mode === "generative" ? enhancePrompt(input.params) : emptyPrompt(),
  };
}

/** Build ordinary batch items, preserving one-and-only-one source reference per item. */
export function buildEnhanceItems(
  input: EnhanceItemInput,
): Array<BatchItem & { params: GenerationParams & { enhance: EnhanceParams } }> {
  const base: GenerationParams = input.baseParams ?? {
    aspectRatio: null,
    imageSize: null,
    outputCount: 1,
    seed: null,
    quality: null,
  };
  return input.assetIds.map((assetId) => ({
    cameraId: null,
    label: input.assets?.find((asset) => asset.id === assetId)?.originalName ?? assetId,
    prompt: input.params.mode === "generative" ? enhancePrompt(input.params) : emptyPrompt(),
    referenceAssetIds: [assetId],
    params: { ...base, enhance: input.params },
  })) as Array<BatchItem & { params: GenerationParams & { enhance: EnhanceParams } }>;
}

function emptyPrompt(): PromptBundle {
  return {
    compilerVersion: "enhance-v1",
    positivePrompt: "",
    negativePrompt: "",
    referenceInstructions: "",
    preservationInstructions: "",
    metadata: {},
  };
}

export function sourceLongEdge(asset: Pick<AssetDTO, "widthPx" | "heightPx">): number {
  return Math.max(asset.widthPx ?? 0, asset.heightPx ?? 0);
}
