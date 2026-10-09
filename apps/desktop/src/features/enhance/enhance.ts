import {
  COMPILER_VERSION,
  EnhanceParamsSchema,
  ENHANCE_TARGETS,
  MAX_ENHANCE_EDGE,
  buildEnhanceItems as buildDomainEnhanceItems,
  buildEnhancePrompt,
  createInitialDNA,
  type AssetDTO,
  type BatchItem,
  type EnhanceParams,
  type GenerationParams,
  type ModelCapabilities,
  type ProjectDNA,
} from "@arch/domain";

export { EnhanceParamsSchema, ENHANCE_TARGETS, MAX_ENHANCE_EDGE, buildEnhancePrompt };
export type { EnhanceParams };

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
  const parsed = EnhanceParamsSchema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".");
    return path
      ? `${path}: ${issue?.message ?? "Invalid enhancement parameters."}`
      : (issue?.message ?? "Invalid enhancement parameters.");
  }
  if (parsed.data.mode === "conservative" && parsed.data.targetLongEdge === null)
    return "Conservative enhancement requires targetLongEdge.";
  if (
    parsed.data.targetLongEdge !== null &&
    sourceLongEdge !== undefined &&
    parsed.data.targetLongEdge < sourceLongEdge
  )
    return "Enhancement never downsizes; pick a larger target.";
  if (parsed.data.targetLongEdge !== null && parsed.data.targetLongEdge > MAX_ENHANCE_EDGE)
    return "Enhancement target cannot exceed 8192px.";
  return null;
}

/** UI prompt bundle wrapper around the canonical domain prompt text. */
export function enhancePrompt(
  params: EnhanceParams,
  dna?: ProjectDNA | string,
): {
  compilerVersion: string;
  positivePrompt: string;
  negativePrompt: string;
  referenceInstructions: string;
  preservationInstructions: string;
  metadata: Record<string, unknown>;
} {
  const parsed = EnhanceParamsSchema.parse(params);
  const projectDna =
    dna && typeof dna !== "string" ? dna : createInitialDNA({ projectType: "custom", pack: null });
  const text =
    parsed.mode === "generative" ? buildEnhancePrompt({ dna: projectDna, params: parsed }) : "";
  return {
    compilerVersion: COMPILER_VERSION,
    positivePrompt: text,
    negativePrompt: "",
    referenceInstructions:
      parsed.mode === "generative"
        ? "Image 1 is the MASTER source image: preserve its architecture, camera and composition."
        : "",
    preservationInstructions: "",
    metadata: { purpose: "enhance", mode: parsed.mode, detailStrength: parsed.detailStrength },
  };
}

type LegacyEnhanceItemInput = {
  projectId?: string;
  assetIds: readonly string[];
  params: EnhanceParams;
  baseParams?: GenerationParams;
  assets?: readonly AssetDTO[];
  providerId?: string;
  model?: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages" | "label">;
  dna?: ProjectDNA;
};

type DomainEnhanceItemInput = Parameters<typeof buildDomainEnhanceItems>[0];

/** Delegate batch construction to the canonical domain builder. */
export function buildEnhanceItems(
  input: DomainEnhanceItemInput | LegacyEnhanceItemInput,
): BatchItem[] {
  if ("sources" in input) return buildDomainEnhanceItems(input);
  const model = input.model ?? {
    imageToImage: true,
    maxReferenceImages: 1,
    label: "Conservative upscale (local)",
  };
  const items = buildDomainEnhanceItems({
    sources: input.assetIds.map((id) => {
      const asset = input.assets?.find((candidate) => candidate.id === id);
      return {
        id,
        role: asset?.role ?? "regular_image",
        status: asset?.status ?? "ready",
        originalName: asset?.originalName,
      };
    }),
    params: { ...(input.baseParams ?? defaultParams()), enhance: input.params },
    providerId: input.providerId ?? "local_upscale",
    model,
    dna: input.dna,
  });
  return input.baseParams === undefined
    ? items.map((item) => ({ ...item, params: { ...item.params, enhance: input.params } }))
    : items;
}

export type EnhanceSubmitPayload = {
  projectId: string;
  providerId: string;
  modelId: string;
  purpose: "enhance";
  referenceAssetIds: [string];
  params: GenerationParams & { enhance: EnhanceParams };
  cameraId: null;
  prompt: ReturnType<typeof enhancePrompt>;
};

export function buildEnhanceRequest(input: {
  projectId: string;
  providerId: string;
  modelId: string;
  sourceAssetId: string;
  params: EnhanceParams;
  baseParams?: GenerationParams;
  dna?: ProjectDNA;
}): EnhanceSubmitPayload {
  const params = EnhanceParamsSchema.parse(input.params);
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    purpose: "enhance",
    referenceAssetIds: [input.sourceAssetId],
    params: { ...(input.baseParams ?? defaultParams()), enhance: params },
    cameraId: null,
    prompt: enhancePrompt(params, input.dna),
  };
}

function defaultParams(): GenerationParams {
  return {
    aspectRatio: null,
    imageSize: null,
    outputCount: 1,
    seed: null,
    quality: null,
  };
}

export function sourceLongEdge(asset: Pick<AssetDTO, "widthPx" | "heightPx">): number {
  return Math.max(asset.widthPx ?? 0, asset.heightPx ?? 0);
}
