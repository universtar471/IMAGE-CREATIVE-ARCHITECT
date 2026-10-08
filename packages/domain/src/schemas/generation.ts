/**
 * Phase 2 generation + provider contracts (see docs/API_CONTRACTS.md §9).
 * Provider-neutral: no vendor request shapes here. The Rust backend serializes these
 * shapes in camelCase; the UI parses every response with these schemas.
 */
import { z } from "zod";
import { PromptBundleSchema } from "./prompt";

export const ProviderKindSchema = z.enum(["local", "remote"]);
export type ProviderKind = z.infer<typeof ProviderKindSchema>;

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

export const GenerationPurposeSchema = z.enum(["hero", "variation"]);
export type GenerationPurpose = z.infer<typeof GenerationPurposeSchema>;

/** `interrupted` = the app closed while the provider call was running. */
export const GenerationStatusSchema = z.enum(["running", "completed", "failed", "interrupted"]);
export type GenerationStatus = z.infer<typeof GenerationStatusSchema>;

export const GenerationParamsSchema = z.object({
  aspectRatio: z.string().nullable(),
  imageSize: z.string().nullable(),
  outputCount: z.number().int().min(1).max(4),
  seed: z.number().int().nonnegative().nullable(),
});
export type GenerationParams = z.infer<typeof GenerationParamsSchema>;

export const GenerationSubmitRequestSchema = z.object({
  projectId: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  purpose: GenerationPurposeSchema,
  /** Compiled in the UI from persisted data (ADR-008); stored verbatim as the request snapshot. */
  prompt: PromptBundleSchema,
  /** Ordered; every ID must be a ready asset of this project. */
  referenceAssetIds: z.array(z.string()),
  params: GenerationParamsSchema,
});
export type GenerationSubmitRequest = z.infer<typeof GenerationSubmitRequestSchema>;

export const GenerationErrorSchema = z.object({
  /** Provider error kind: auth | rate_limited | blocked | invalid_request | network | timeout | bad_response | interrupted */
  kind: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type GenerationError = z.infer<typeof GenerationErrorSchema>;

export const GenerationDTOSchema = z.object({
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
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type GenerationDTO = z.infer<typeof GenerationDTOSchema>;
