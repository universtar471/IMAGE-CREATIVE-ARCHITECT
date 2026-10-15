import { z } from "zod";

export const PromptBundleSchema = z.object({
  compilerVersion: z.string(),
  // Provenance (ADR-034). Optional so bundles stored before P0 and hand-built bundles
  // (enhance, region edit) still parse; `compilePrompt` always sets all five.
  /** Version of the unified conflict validator the shot was checked with. */
  validatorVersion: z.string().optional(),
  /** Space Catalog version; "none" until the catalog ships (P1). */
  catalogVersion: z.string().optional(),
  /** `sha256:<hex>` of the canonical JSON of the compiled DNA plus the shot intent. */
  sourceHash: z.string().optional(),
  /** `sha256:<hex>` of the canonical JSON of the compiler configuration. */
  configHash: z.string().optional(),
  /** WARN conflict codes accepted for this shot, sorted and unique. */
  resolvedWarnings: z.array(z.string()).optional(),
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  referenceInstructions: z.string(),
  preservationInstructions: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export type PromptBundle = z.infer<typeof PromptBundleSchema>;
