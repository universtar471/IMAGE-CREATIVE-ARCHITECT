/**
 * Phase 2 generation + provider contracts (see docs/API_CONTRACTS.md §9).
 * Provider-neutral: no vendor request shapes here. The Rust backend serializes these
 * shapes in camelCase; the UI parses every response with these schemas.
 */
import { z } from "zod";
import { PromptBundleSchema } from "./prompt";

export const ProviderKindSchema = z.enum(["local", "remote"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

/** Image quality a model may let the user choose; null in params = provider default. */
export const GenerationQualitySchema = z.enum(["low", "medium", "high"]);
export type GenerationQuality = z.infer<typeof GenerationQualitySchema>;

/** What one model of a provider can do. The UI derives every control from this. */
export const ModelCapabilitiesSchema = z.object({
  id: z.string(),
  label: z.string(),
  textToImage: z.boolean(),
  imageToImage: z.boolean(),
  maxReferenceImages: z.number().int().nonnegative(),
  maxOutputs: z.number().int().positive(),
  /** e.g. "1:1", "16:9". Empty = provider decides. */
  aspectRatios: z.array(z.string()),
  /** e.g. "1K", "2K". Empty = provider decides. */
  imageSizes: z.array(z.string()),
  supportsNegativePrompt: z.boolean(),
  supportsSeed: z.boolean(),
  /** `quality` values the model accepts. Empty = no choice; `params.quality` must be null. */
  qualityOptions: z.array(GenerationQualitySchema),
  /**
   * Estimated price per image in VND by `imageSizes` tier (HHTECH). Null = no price known; a
   * tier missing from the map has no published price.
   */
  priceHint: z.record(z.string(), z.number().int().nonnegative()).nullable(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ProviderDescriptorDTOSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: ProviderKindSchema,
  requiresApiKey: z.boolean(),
  /** True when the provider can run now (key present, or no key needed). Never the key itself. */
  configured: z.boolean(),
  /** Where the key comes from when configured: OS keychain or environment variable. */
  keySource: z.enum(["keychain", "env"]).nullable(),
  models: z.array(ModelCapabilitiesSchema).min(1),
});
export type ProviderDescriptorDTO = z.infer<typeof ProviderDescriptorDTOSchema>;

export const ProviderTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type ProviderTestResult = z.infer<typeof ProviderTestResultSchema>;

export const GenerationPurposeSchema = z.enum([
  "hero",
  "variation",
  "anchor",
  "production",
  "enhance",
  "repair",
]);
export type GenerationPurpose = z.infer<typeof GenerationPurposeSchema>;

export const EnhanceParamsSchema = z.object({
  mode: z.enum(["conservative", "generative"]),
  targetLongEdge: z.union([z.literal(2048), z.literal(3072), z.literal(4096), z.null()]),
  detailStrength: z.number().int().min(0).max(100).default(40),
  architecturePreserve: z.boolean().default(true),
});
export type EnhanceParams = z.infer<typeof EnhanceParamsSchema>;

export const RepairParamsSchema = z.object({
  qcReportId: z.string().regex(/^QC_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
});
export type RepairParams = z.infer<typeof RepairParamsSchema>;

/**
 * `queued` = waiting in the job queue (Phase 3); `interrupted` = the app closed while the
 * provider call was running; `cancelled` = the user cancelled the job.
 */
export const GenerationStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "interrupted",
  "cancelled",
]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const GenerationParamsSchema = z.object({
  aspectRatio: z.string().nullable(),
  imageSize: z.string().nullable(),
  outputCount: z.number().int().min(1).max(4),
  seed: z.number().int().nonnegative().nullable(),
  /** One of the model's `qualityOptions`; null = provider default. Absent in older rows. */
  quality: GenerationQualitySchema.nullable().default(null),
  enhance: EnhanceParamsSchema.optional(),
  repair: RepairParamsSchema.optional(),
});
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;

function addPurposeContractIssues(
  value: {
    purpose: GenerationPurpose;
    providerId: string;
    params: GenerationParams;
    referenceAssetIds: string[];
  },
  ctx: z.RefinementCtx,
): void {
  if (value.purpose === "enhance") {
    const enhance = value.params.enhance;
    if (!enhance) {
      ctx.addIssue({
        code: "custom",
        path: ["params", "enhance"],
        message: "params.enhance is required when purpose is enhance.",
      });
      return;
    }
    if (enhance.mode === "conservative" && enhance.targetLongEdge === null) {
      ctx.addIssue({
        code: "custom",
        path: ["params", "enhance", "targetLongEdge"],
        message: "Conservative enhancement requires targetLongEdge.",
      });
    }
    if (enhance.mode === "conservative" && value.providerId !== "local_upscale") {
      ctx.addIssue({
        code: "custom",
        path: ["providerId"],
        message: 'Conservative enhancement requires providerId "local_upscale".',
      });
    }
  }
  if (value.purpose === "repair") {
    if (!value.params.repair) {
      ctx.addIssue({
        code: "custom",
        path: ["params", "repair"],
        message: "params.repair is required when purpose is repair.",
      });
    }
    if (value.referenceAssetIds.length !== 2) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceAssetIds"],
        message: "Repair generation requires exactly two reference assets.",
      });
    }
  }
}

export const GenerationSubmitRequestSchema = z
  .object({
    projectId: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    purpose: GenerationPurposeSchema,
    /** Compiled in the UI from persisted data (ADR-008); stored verbatim as the request snapshot. */
    prompt: PromptBundleSchema,
    /** Ordered; every ID must be a ready asset of this project. */
    referenceAssetIds: z.array(z.string()),
    params: GenerationParamsSchema,
    /** Camera this render is for (Phase 3); must exist in the project's DNA. */
    cameraId: z.string().nullable().default(null),
  })
  .superRefine((value, ctx) => addPurposeContractIssues(value, ctx));
export type GenerationSubmitRequest = z.infer<typeof GenerationSubmitRequestSchema>;

export const GenerationErrorSchema = z.object({
  /** Provider error kind: auth | rate_limited | blocked | invalid_request | network | timeout | bad_response | interrupted */
  kind: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type GenerationError = z.infer<typeof GenerationErrorSchema>;

export const GenerationDTOSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    purpose: GenerationPurposeSchema,
    status: GenerationStatusSchema,
    prompt: PromptBundleSchema,
    referenceAssetIds: z.array(z.string()),
    params: GenerationParamsSchema,
    /** Lineage anchor: the master if referenced, else the first reference, else null. */
    parentAssetId: z.string().nullable(),
    /** Output assets still present in the project, in output order. */
    outputAssetIds: z.array(z.string()),
    error: GenerationErrorSchema.nullable(),
    cameraId: z.string().nullable(),
    batchId: z.string().nullable(),
    /** The queue job that runs this generation (Phase 3). */
    jobId: z.string().nullable(),
    /** Time the generation was queued; `startedAt` is when the provider call began. */
    createdAt: z.string(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
  })
  .superRefine((value, ctx) => addPurposeContractIssues(value, ctx));
export type GenerationDTO = z.infer<typeof GenerationDTOSchema>;

/** `prompt_enhance` (see docs/API_CONTRACTS.md §11). Nothing is stored. */
export const PromptEnhanceRequestSchema = z.object({
  projectId: z.string(),
  /** A provider whose descriptor offers chat (currently `hhtech`). */
  providerId: z.string(),
  /** The user's editable extra prompt, 1–4000 characters after trimming. */
  text: z.string().trim().min(1).max(4000),
  /** Project DNA facts the rewrite must keep (the compiled prompt); may be empty. */
  context: z.string().max(20000),
});
export type PromptEnhanceRequest = z.infer<typeof PromptEnhanceRequestSchema>;

export const PromptEnhanceResultSchema = z.object({
  text: z.string().min(1),
});
export type PromptEnhanceResult = z.infer<typeof PromptEnhanceResultSchema>;
