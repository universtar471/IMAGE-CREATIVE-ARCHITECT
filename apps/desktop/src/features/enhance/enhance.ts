import {
  COMPILER_VERSION,
  DEFAULT_ENHANCE_LOCKS,
  EnhanceParamsSchema,
  ENHANCE_TARGETS,
  MAX_ENHANCE_EDGE,
  buildEnhanceItems as buildDomainEnhanceItems,
  buildEnhancePrompt,
  createInitialDNA,
  failedBatchJobIds,
  planEnhanceSources,
  resolveUpscaleSize,
  upscaleTargetLongEdge,
  type AssetDTO,
  type IfAlreadyLarger,
  type PreservationMode,
  type ProviderDescriptorDTO,
  type UpscaleSize,
  type UpscaleTarget,
  type BatchItem,
  type GenerationDTO,
  type EnhanceParams,
  type GenerationParams,
  type ModelCapabilities,
  type ProjectDNA,
} from "@arch/domain";

export {
  EnhanceParamsSchema,
  ENHANCE_TARGETS,
  MAX_ENHANCE_EDGE,
  buildEnhancePrompt,
  failedBatchJobIds,
  planEnhanceSources,
  resolveUpscaleSize,
};
export type { EnhanceParams, IfAlreadyLarger, PreservationMode, UpscaleSize, UpscaleTarget };

/** The P3 UI starts in strict mode: local, free, 2K long edge (ADR-035). */
export const DEFAULT_ENHANCE_PARAMS: EnhanceParams = {
  mode: "conservative",
  targetLongEdge: 2048,
  detailStrength: 40,
  architecturePreserve: true,
  preservationMode: "strict",
  locks: { ...DEFAULT_ENHANCE_LOCKS },
  upscale: { target: "long_edge_2048", ifAlreadyLarger: "keep" },
};

export const PRESERVATION_MODES: readonly PreservationMode[] = ["strict", "balanced", "creative"];
export const LOCK_KEYS = ["geometry", "material", "context", "camera"] as const;
/** Size choices of the selector; `custom` opens width/height fields. */
export const SIZE_TARGET_KINDS = [
  "long_edge_2048",
  "long_edge_4096",
  "uhd_3840x2160_contain",
  "custom",
] as const;
export type SizeTargetKind = (typeof SIZE_TARGET_KINDS)[number];
export const IF_ALREADY_LARGER: readonly IfAlreadyLarger[] = ["keep", "quality_only", "skip"];

export function sizeTargetKind(target: UpscaleTarget): SizeTargetKind {
  return typeof target === "object" ? "custom" : target;
}

/**
 * Switch the preservation mode. Strict is always local and non-generative and never keeps an
 * allowed region; balanced and creative are generative (ADR-035).
 */
export function withPreservationMode(params: EnhanceParams, mode: PreservationMode): EnhanceParams {
  const upscale =
    params.upscale ??
    (mode === "strict"
      ? { target: "long_edge_2048" as const, ifAlreadyLarger: "keep" as const }
      : undefined);
  const next: EnhanceParams = {
    ...params,
    preservationMode: mode,
    mode: mode === "strict" ? "conservative" : "generative",
    locks: params.locks ?? { ...DEFAULT_ENHANCE_LOCKS },
    upscale,
    targetLongEdge: upscale ? upscaleTargetLongEdge(upscale.target) : params.targetLongEdge,
  };
  if (mode === "strict") delete next.allowedRegionIds;
  return next;
}

/** Set the size target; `null` keeps the source size (generative modes only). */
export function withSizeTarget(
  params: EnhanceParams,
  target: UpscaleTarget | null,
  ifAlreadyLarger: IfAlreadyLarger = params.upscale?.ifAlreadyLarger ?? "keep",
): EnhanceParams {
  if (target === null) {
    const next = { ...params, targetLongEdge: null };
    delete next.upscale;
    return next;
  }
  return {
    ...params,
    upscale: { target, ifAlreadyLarger },
    targetLongEdge: upscaleTargetLongEdge(target),
  };
}

/** Only `local_upscale` may run strict: a paid provider is never offered or chosen. */
export function enhanceProviderChoice(
  mode: PreservationMode,
  providers: readonly ProviderDescriptorDTO[],
): { providerId: string; modelId: string } {
  if (mode === "strict") return { providerId: "local_upscale", modelId: "lanczos3" };
  const provider = providers.find(
    (item) =>
      item.id !== "local_upscale" &&
      item.models.some((model) => model.imageToImage && model.maxReferenceImages >= 1),
  );
  return { providerId: provider?.id ?? "", modelId: "" };
}

/** The output size a source will get, or null when the target or its size is unknown. */
export function enhanceSizeFor(
  params: EnhanceParams,
  source: Pick<AssetDTO, "widthPx" | "heightPx"> | null | undefined,
): UpscaleSize | null {
  if (!params.upscale || !source?.widthPx || !source.heightPx) return null;
  return resolveUpscaleSize(
    { width: source.widthPx, height: source.heightPx },
    params.upscale.target,
    params.upscale.ifAlreadyLarger,
  );
}

/** The long edge the provider is asked for, for the price tier (mirrors the backend). */
export function enhanceTargetEdge(
  params: EnhanceParams,
  source?: Pick<AssetDTO, "widthPx" | "heightPx"> | null,
): number | null {
  const size = enhanceSizeFor(params, source);
  if (size) return Math.max(size.width, size.height);
  if (params.upscale) {
    const target = params.upscale.target;
    if (target === "uhd_3840x2160_contain") return 3840;
    if (typeof target === "object") return Math.max(target.width, target.height);
    return upscaleTargetLongEdge(target);
  }
  return params.targetLongEdge;
}

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
  if (
    parsed.data.mode === "conservative" &&
    parsed.data.targetLongEdge === null &&
    !parsed.data.upscale
  )
    return "Conservative enhancement requires targetLongEdge.";
  if (parsed.data.preservationMode === "strict" && parsed.data.mode !== "conservative")
    return "Strict enhancement is local and non-generative.";
  // With a size target, a larger source follows `ifAlreadyLarger` instead (never downscaled).
  if (
    !parsed.data.upscale &&
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
    metadata: {
      purpose: "enhance",
      mode: parsed.mode,
      detailStrength: parsed.detailStrength,
      ...(parsed.preservationMode ? { preservationMode: parsed.preservationMode } : {}),
    },
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
        widthPx: asset?.widthPx,
        heightPx: asset?.heightPx,
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

/**
 * "Retry failed" of a batch (AC-13): resend exactly the failed items, one `job_retry` each.
 * Completed items are never resent, so nothing is charged twice. Returns the retried ids.
 */
export async function retryFailedItems(
  jobs: readonly { id: string; batchId: string | null; status: string }[],
  batchId: string,
  retry: (jobId: string) => Promise<unknown>,
): Promise<string[]> {
  const ids = failedBatchJobIds(jobs, batchId);
  for (const id of ids) await retry(id);
  return ids;
}

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
  if (params.preservationMode === "strict" && input.providerId !== "local_upscale")
    throw new Error('Strict enhancement requires providerId "local_upscale".');
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

export type EnhancePair = {
  source: AssetDTO;
  result: AssetDTO;
  generation: GenerationDTO;
};

/** Resolve an enhance output to the exact single reference used by its generation. */
export function resolveEnhancePair(
  assetId: string,
  generations: readonly GenerationDTO[],
  assets: readonly AssetDTO[],
): EnhancePair | null {
  const generation = generations.find(
    (candidate) => candidate.purpose === "enhance" && candidate.outputAssetIds.includes(assetId),
  );
  if (!generation) return null;
  const sourceId = generation.referenceAssetIds[0];
  const source = sourceId ? assets.find((asset) => asset.id === sourceId) : undefined;
  const result = assets.find((asset) => asset.id === assetId);
  return source &&
    result &&
    generation.projectId === source.projectId &&
    generation.projectId === result.projectId
    ? { source, result, generation }
    : null;
}

export type EnhanceCost =
  | { kind: "free"; count: number }
  | { kind: "unknown"; count: number; tier: "2K" | "4K" }
  | { kind: "priced"; amount: number; unitAmount: number; count: number; tier: "2K" | "4K" };

/** Price display contract: only the local provider is known to be free. */
export function enhanceCost(
  providerId: string,
  model: Pick<ModelCapabilities, "priceHint"> | null | undefined,
  targetLongEdge: number | null,
  count = 1,
): EnhanceCost {
  if (providerId === "local_upscale") return { kind: "free", count };
  // Same rule as the backend's HHTECH tier: anything above 2048 px is 4K.
  const tier = targetLongEdge !== null && targetLongEdge > 2048 ? "4K" : "2K";
  const unitAmount = model?.priceHint?.[tier];
  if (unitAmount === undefined || unitAmount === null) return { kind: "unknown", count, tier };
  return { kind: "priced", amount: unitAmount * count, unitAmount, count, tier };
}
