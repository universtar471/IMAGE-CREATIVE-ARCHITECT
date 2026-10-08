/**
 * Provider boundary. Since Phase 2 provider adapters run in the Rust backend
 * (`apps/desktop/src-tauri/src/providers`) so API keys never reach the webview (ADR-013).
 * The UI only sees provider-neutral DTOs from `schemas/generation.ts`.
 * These types describe the conceptual contract shared by every adapter.
 */
import type { GenerationParams, ModelCapabilities } from "./schemas/generation";
import type { PromptBundle } from "./schemas/prompt";

export type ProviderCapabilities = {
  id: string;
  models: ModelCapabilities[];
};

export type GenerationRequest = {
  projectId: string;
  modelId: string;
  prompt: PromptBundle;
  referenceAssetIds: string[];
  params: GenerationParams;
};

export type GenerationResult = {
  /** Managed asset IDs created from the provider output (with lineage). */
  assetIds: string[];
};

export interface GenerationProvider {
  capabilities(): ProviderCapabilities;
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
