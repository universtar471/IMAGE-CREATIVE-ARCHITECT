/**
 * Phase 2 generation + provider contracts (see docs/API_CONTRACTS.md §9).
 * Provider-neutral: no vendor request shapes here. The Rust backend serializes these
 * shapes in camelCase; the UI parses every response with these schemas.
 */
import { z } from "zod";
import { PromptBundleSchema } from "./prompt";
import { RegionEditParamsSchema } from "../regions/schemas";

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
  /** Native provider mask support; false for models that receive a second mask image. */
  supportsMask: z.boolean().default(false),
});
type ParsedModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;
export type ModelCapabilities = Omit<ParsedModelCapabilities, "supportsMask"> & {
  supportsMask?: boolean;
};

export const ProviderDescriptorDTOSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: ProviderKindSchema,
  requiresApiKey: z.boolean(),
  /** True when the provider can run now (key present, or no key needed). Never the key itself. */
  configured: z.boolean(),
  /** Where the key comes from when configured: OS keychain or environment variable. */
  keySource: z.enum(["keychain", "env"]).nullable(),
  /** Empty only for a provider that is not set up yet (the custom gateway, ADR-040). */
  models: z.array(ModelCapabilitiesSchema).transform((models) => models as ModelCapabilities[]),
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
  "region_edit",
  "assist",
]);
export type GenerationPurpose = z.infer<typeof GenerationPurposeSchema>;

/** SRS P3 (ADR-035) preservation modes; absent = the legacy conservative/generative contract. */
export const PreservationModeSchema = z.enum(["strict", "balanced", "creative"]);
export type PreservationMode = z.infer<typeof PreservationModeSchema>;

/** Facts the generative prompt must keep. All on by default; the camera lock forbids crops. */
export const EnhanceLocksSchema = z.object({
  geometry: z.boolean().default(true),
  material: z.boolean().default(true),
  context: z.boolean().default(true),
  camera: z.boolean().default(true),
});
export type EnhanceLocks = z.infer<typeof EnhanceLocksSchema>;

export const UpscaleTargetSchema = z.union([
  z.literal("long_edge_2048"),
  z.literal("long_edge_4096"),
  /** Contain inside 3840 x 2160 with letterbox padding; never a crop. */
  z.literal("uhd_3840x2160_contain"),
  z.object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    fit: z.literal("contain"),
  }),
]);
export type UpscaleTarget = z.infer<typeof UpscaleTargetSchema>;

export const IfAlreadyLargerSchema = z.enum(["keep", "quality_only", "skip"]);
export type IfAlreadyLarger = z.infer<typeof IfAlreadyLargerSchema>;

export const UpscaleParamsSchema = z.object({
  target: UpscaleTargetSchema,
  /** What to do when the source already exceeds the target. Nothing is ever downscaled. */
  ifAlreadyLarger: IfAlreadyLargerSchema.default("keep"),
});
export type UpscaleParams = z.infer<typeof UpscaleParamsSchema>;

export const EnhanceParamsSchema = z.object({
  mode: z.enum(["conservative", "generative"]),
  targetLongEdge: z.union([z.literal(2048), z.literal(3072), z.literal(4096), z.null()]),
  detailStrength: z.number().int().min(0).max(100).default(40),
  architecturePreserve: z.boolean().default(true),
  /** SRS P3 mode; optional so legacy rows parse and behave unchanged. */
  preservationMode: PreservationModeSchema.optional(),
  /** Written by the P3 UI only; omitted means the legacy contract. */
  locks: EnhanceLocksSchema.optional(),
  /** Regions of the source asset the AI may change (balanced/creative); the rest is locked. */
  allowedRegionIds: z.array(z.string()).min(1).optional(),
  /** Size target (ADR-035); when set it decides the output size instead of `targetLongEdge`. */
  upscale: UpscaleParamsSchema.optional(),
});
export type EnhanceParams = z.infer<typeof EnhanceParamsSchema>;

/**
 * Why a local enhance check asks for review. These are checks, not a score: they never
 * block saving (ADR-035).
 */
export const EnhanceCheckReasonSchema = z.enum([
  "size_mismatch",
  "aspect_changed",
  "registration_shift",
  "locked_ssim_low",
  "edge_structure_changed",
  "no_allowed_region",
  "creative_review",
]);
export type EnhanceCheckReason = z.infer<typeof EnhanceCheckReasonSchema>;

const PixelSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** Deterministic local check run in Rust after an enhance job (ADR-035; no Vision QC). */
export const EnhanceCheckSchema = z.object({
  /** `ECK_...`; also recorded on the enhanced asset for provenance. */
  id: z.string(),
  /** Version of the check rules, e.g. "ec-1.0.0". */
  version: z.string(),
  preservationMode: PreservationModeSchema,
  status: z.enum(["pass", "warn"]),
  reasons: z.array(EnhanceCheckReasonSchema),
  expectedSize: PixelSizeSchema,
  actualSize: PixelSizeSchema,
  /** Where the image sits inside the canvas (letterbox padding around it). */
  content: z.object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  /** Relative aspect change of the provider output against the source; 0 = identical. */
  aspectDelta: z.number().nonnegative(),
  /** Global offset estimate on downscaled luma, in source pixels. */
  registration: z.object({ dx: z.number(), dy: z.number(), shiftPx: z.number().nonnegative() }),
  /** Mean SSIM of locked pixels; null when nothing is locked. */
  lockedSsim: z.number().min(-1).max(1).nullable(),
  /** Share of the frame that is locked, 0-100. */
  lockedPct: z.number().min(0).max(100),
  /** Strict only: share of output edges that do not exist in the source; null otherwise. */
  edgeDelta: z.number().min(0).max(1).nullable(),
  /** True when locked pixels were restored from the source. */
  composited: z.boolean(),
  /** What the size step did. */
  sizeAction: z.enum(["upscale", "keep", "quality_only"]),
});
export type EnhanceCheck = z.infer<typeof EnhanceCheckSchema>;

type EnhanceIssue = { path: (string | number)[]; message: string };

/**
 * Purpose contract of `params.enhance`, shared by single submits and batches. A path that
 * starts with `providerId` is relative to the request, any other to `params.enhance`.
 */
export function enhanceContractIssues(enhance: EnhanceParams, providerId: string): EnhanceIssue[] {
  const issues: EnhanceIssue[] = [];
  if (enhance.mode === "conservative" && enhance.targetLongEdge === null && !enhance.upscale) {
    issues.push({
      path: ["targetLongEdge"],
      message: "Conservative enhancement requires targetLongEdge.",
    });
  }
  if (enhance.mode === "conservative" && providerId !== "local_upscale") {
    issues.push({
      path: ["providerId"],
      message: 'Conservative enhancement requires providerId "local_upscale".',
    });
  }
  if (enhance.preservationMode === "strict") {
    if (providerId !== "local_upscale")
      issues.push({
        path: ["providerId"],
        message: 'Strict enhancement requires providerId "local_upscale".',
      });
    if (enhance.mode !== "conservative")
      issues.push({ path: ["mode"], message: "Strict enhancement is local and non-generative." });
    if (enhance.allowedRegionIds)
      issues.push({
        path: ["allowedRegionIds"],
        message: "Strict enhancement does not use an allowed region.",
      });
  }
  if (
    (enhance.preservationMode === "balanced" || enhance.preservationMode === "creative") &&
    enhance.mode !== "generative"
  ) {
    issues.push({
      path: ["mode"],
      message: "Balanced and creative enhancement need a generative provider.",
    });
  }
  if (enhance.allowedRegionIds && !enhance.preservationMode) {
    issues.push({
      path: ["allowedRegionIds"],
      message: "allowedRegionIds requires a preservationMode.",
    });
  }
  return issues;
}

/**
 * Params of a legacy `repair` generation. Repairs were created only from QC reports; QC was
 * removed (ADR-033), so this shape exists only so old history rows still parse.
 */
export const RepairParamsSchema = z.object({
  qcReportId: z.string(),
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
  region: RegionEditParamsSchema.optional(),
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
    for (const issue of enhanceContractIssues(enhance, value.providerId)) {
      ctx.addIssue({
        code: "custom",
        path: issue.path[0] === "providerId" ? issue.path : ["params", "enhance", ...issue.path],
        message: issue.message,
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
  if (value.purpose === "region_edit") {
    if (!value.params.region) {
      ctx.addIssue({
        code: "custom",
        path: ["params", "region"],
        message: "params.region is required when purpose is region_edit.",
      });
    }
    if (value.referenceAssetIds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["referenceAssetIds"],
        message: "Region edit generation requires exactly one reference asset.",
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
  .superRefine((value, ctx) => {
    if (value.purpose === "repair") {
      // Legacy purpose: kept for history display only (QC was removed, ADR-033).
      ctx.addIssue({
        code: "custom",
        path: ["purpose"],
        message: "Repair generations can no longer be submitted.",
      });
      return;
    }
    addPurposeContractIssues(value, ctx);
  });
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
    enhanceCheck: EnhanceCheckSchema.nullable().optional(),
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
