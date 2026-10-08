/**
 * Future provider boundary (Phase 2+). Interfaces only — no implementations in Phase 1.
 * Providers depend on these domain contracts; the domain never imports vendor SDKs.
 */
import type { PromptBundle } from "./schemas/prompt";

export type ProviderCapabilities = {
  id: string;
  textToImage: boolean;
  imageToImage: boolean;
  maxReferenceImages: number;
};

export type GenerationRequest = {
  projectId: string;
  prompt: PromptBundle;
  referenceAssetIds: string[];
};

export type GenerationResult = {
  /** Managed asset IDs created from the provider output (with lineage). */
  assetIds: string[];
};

export interface GenerationProvider {
  capabilities(): ProviderCapabilities;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
