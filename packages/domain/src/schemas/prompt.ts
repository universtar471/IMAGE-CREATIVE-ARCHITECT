import { z } from "zod";

/**
 * The conflict check of the shot as it was submitted (ADR-034 P0-B). The desktop gate runs
 * `validateShot` before every paid submit and records the outcome here, inside the request
 * snapshot; the backend refuses a request whose `verdict` is BLOCK.
 */
export const ShotValidationSnapshotSchema = z.object({
  /** Verdict after the accepted exceptions: BLOCK | WARN | ALLOW. */
  verdict: z.enum(["BLOCK", "WARN", "ALLOW"]),
  validatorVersion: z.string(),
  /** Codes of every issue found (accepted ones included), sorted and unique. */
  issueCodes: z.array(z.string()),
  /** WARN codes the user accepted as exceptions for this shot, sorted and unique. */
  approvedExceptions: z.array(z.string()),
});
export type ShotValidationSnapshot = z.infer<typeof ShotValidationSnapshotSchema>;

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
  /** Set by the desktop gate at submit (P0-B); absent on older snapshots and previews. */
  validation: ShotValidationSnapshotSchema.optional(),
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  referenceInstructions: z.string(),
  preservationInstructions: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export type PromptBundle = z.infer<typeof PromptBundleSchema>;
