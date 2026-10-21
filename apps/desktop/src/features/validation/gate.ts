/** Creative conflict assessment is advisory. Preserve findings in every prompt snapshot,
 * including batches and retries; choices never require exception approval to be submitted.
 * Provider, file, parameter and cost validation are enforced separately. */
import {
  validateShot,
  type BatchCreateRequest,
  type ConflictCode,
  type ProjectDNA,
  type ProjectType,
  type PromptBundle,
  type ShotValidation,
  type ShotValidationSnapshot,
  type ShotIntent,
} from "@arch/domain";

export type ShotCheck = {
  dna: ProjectDNA;
  projectType: ProjectType;
  cameraId?: string | null;
  /** The user's free text (extra prompt, region instruction); checked before it is appended. */
  extraPrompt?: string | null;
  approvedExceptions?: readonly ConflictCode[];
  /** Per-shot choices (scene objects, …); the project type and camera above always win. */
  shotIntent?: Partial<ShotIntent>;
};

export function checkShot(input: ShotCheck): ShotValidation {
  return validateShot({
    dna: input.dna,
    shotIntent: {
      ...input.shotIntent,
      projectType: input.projectType,
      cameraId: input.cameraId ?? null,
    },
    extraPrompt: input.extraPrompt ?? null,
    approvedExceptions: input.approvedExceptions,
  });
}

const sortedUnique = (codes: readonly string[]) =>
  [...new Set(codes)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** WARN codes still waiting for the user's approval. */
export function pendingWarnings(v: Pick<ShotValidation, "issues">): ConflictCode[] {
  return sortedUnique(
    v.issues.filter((i) => i.severity === "WARN" && !i.accepted).map((i) => i.code),
  ) as ConflictCode[];
}

/** WARN codes accepted for this shot (only those that matched an issue). */
export function acceptedWarnings(v: Pick<ShotValidation, "issues">): ConflictCode[] {
  return sortedUnique(v.issues.filter((i) => i.accepted).map((i) => i.code)) as ConflictCode[];
}

export function validationSnapshot(v: ShotValidation): ShotValidationSnapshot {
  return {
    verdict: v.verdict,
    validatorVersion: v.validatorVersion,
    issueCodes: sortedUnique(v.issues.map((i) => i.code)),
    approvedExceptions: acceptedWarnings(v),
  };
}

/**
 * The bundle carrying the gate's outcome: the snapshot, and in `resolvedWarnings` exactly
 * the WARN codes the user accepted for this shot (never codes that were only found; those
 * are in `validation.issueCodes`). A resent snapshot's older list is replaced, not merged.
 */
export function withValidation<B extends PromptBundle>(bundle: B, v: ShotValidation): B {
  const accepted = acceptedWarnings(v);
  const resolved =
    accepted.length || bundle.resolvedWarnings !== undefined
      ? { ...bundle, resolvedWarnings: accepted }
      : bundle;
  return { ...resolved, validation: validationSnapshot(v) };
}

export function conflictOf(err: { details?: unknown }): ShotValidation | null {
  const details = err.details as { validation?: ShotValidation } | undefined;
  return details?.validation ?? null;
}

export type BatchGateEntry = { label: string; validation: ShotValidation };

export type BatchGate = {
  /** Items that may be sent, each stamped with its validation; null when none may. */
  request: BatchCreateRequest | null;
  /** Every item's validation, in item order (for the panel). */
  entries: BatchGateEntry[];
  /** Retained for compatibility; advisory findings never skip an item. */
  skipped: BatchGateEntry[];
};

/**
 * Validate every batch item with its OWN shot intent (the one its prompt was compiled with,
 * e.g. a per-item `targetDetailId`); all items keep their findings and remain in the request.
 */
export function gateBatch(
  request: BatchCreateRequest,
  dna: ProjectDNA,
  projectType: ProjectType,
  approvedExceptions?: readonly ConflictCode[],
): BatchGate {
  const entries: BatchGateEntry[] = [];
  const skipped: BatchGateEntry[] = [];
  const items: BatchCreateRequest["items"] = [];
  for (const item of request.items) {
    const validation = checkShot({
      dna,
      projectType,
      cameraId: item.cameraId,
      approvedExceptions,
      shotIntent: item.prompt.shotIntent,
    });
    const entry = { label: item.label, validation };
    entries.push(entry);
    items.push({ ...item, prompt: withValidation(item.prompt, validation) });
  }
  return { request: items.length ? { ...request, items } : null, entries, skipped };
}
