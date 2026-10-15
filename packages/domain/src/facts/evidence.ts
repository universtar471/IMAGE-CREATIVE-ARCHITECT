/**
 * Evidence attached to a project fact (ADR-034, SRS §3.4).
 *
 * `verified` and `user_declared` facts may be stated as facts in prompts and publications;
 * `inferred` and `unknown` must never be presented as measured or confirmed.
 */
import { z } from "zod";

export const EVIDENCE_STATUSES = ["verified", "user_declared", "inferred", "unknown"] as const;
export const EvidenceStatusSchema = z.enum(EVIDENCE_STATUSES);
export type EvidenceStatus = z.infer<typeof EvidenceStatusSchema>;

export const EvidenceRefSchema = z.object({
  status: EvidenceStatusSchema,
  sourceAssetIds: z.array(z.string().trim().min(1)).default([]),
  approvedByUser: z.boolean().optional(),
  /** Only meaningful for AI-inferred facts. */
  confidence: z.number().min(0).max(1).optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

/** True when the fact may be treated as confirmed: `verified` or `user_declared`. */
export function isConfirmed(evidence: Pick<EvidenceRef, "status"> | null | undefined): boolean {
  return evidence?.status === "verified" || evidence?.status === "user_declared";
}

/** Evidence with no source; used for defaults and derived values. */
export const unknownEvidence = (): EvidenceRef => ({ status: "unknown", sourceAssetIds: [] });
