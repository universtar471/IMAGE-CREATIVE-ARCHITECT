/**
 * The conflict gate of every paid submit (ADR-034 P0-B, SRS §12.3): generate, variations,
 * anchors, batches, generative enhance and region edit all call `checkShot` with the
 * persisted DNA, the shot and the user's free text BEFORE anything reaches the bridge.
 *
 * - BLOCK: nothing is sent; the user must fix the selection ("Sửa lựa chọn").
 * - WARN: nothing is sent until each WARN code is accepted ("Duyệt ngoại lệ").
 * - ALLOW (after accepted exceptions): the request goes out with the verdict and the
 *   accepted exceptions recorded in its prompt snapshot (`PromptBundle.validation`); the
 *   backend refuses a snapshot whose verdict is BLOCK.
 *
 * Batches validate per item: items that are not ALLOW are skipped and reported, never sent.
 * Pure: no store, no bridge.
 */
import {
  validateShot,
  withResolvedWarnings,
  type BatchCreateRequest,
  type ConflictCode,
  type ProjectDNA,
  type ProjectType,
  type PromptBundle,
  type ShotValidation,
  type ShotValidationSnapshot,
  type ShotIntent,
} from "@arch/domain";
import { BridgeError } from "../../lib/bridge";
import { t } from "../../i18n";

export type ShotCheck = {
  dna: ProjectDNA;
  projectType: ProjectType;
  cameraId?: string | null;
  /** The user's free text (extra prompt, region instruction); checked before it is appended. */
  extraPrompt?: string | null;
  approvedExceptions?: readonly ConflictCode[];
  shotIntent?: Partial<ShotIntent>;
};

export function checkShot(input: ShotCheck): ShotValidation {
  return validateShot({
    dna: input.dna,
    shotIntent: {
      projectType: input.projectType,
      cameraId: input.cameraId ?? null,
      ...(input.shotIntent ?? {}),
    },
    extraPrompt: input.extraPrompt ?? null,
    approvedExceptions: input.approvedExceptions,
  });
}

/** Only ALLOW (every WARN accepted, no BLOCK) may be submitted. */
export const canSubmit = (v: Pick<ShotValidation, "verdict">) => v.verdict === "ALLOW";

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

/** The bundle carrying the gate's outcome: snapshot + accepted codes in `resolvedWarnings`. */
export function withValidation<B extends PromptBundle>(bundle: B, v: ShotValidation): B {
  const accepted = acceptedWarnings(v);
  const merged = accepted.length ? (withResolvedWarnings(bundle, accepted) as B) : bundle;
  return { ...merged, validation: validationSnapshot(v) };
}

/** Thrown by the store when the gate refuses a submit; `details.validation` has the issues. */
export function conflictError(v: ShotValidation): BridgeError {
  return new BridgeError({
    code: "VALIDATION_ERROR",
    message: v.verdict === "BLOCK" ? t("conflictUi.refusedBlock") : t("conflictUi.refusedWarn"),
    details: { validation: v },
  });
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
  /** Items that are not ALLOW: never sent. */
  skipped: BatchGateEntry[];
};

/** Validate every batch item; items that are not ALLOW are dropped from the request. */
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
    const validation = checkShot({ dna, projectType, cameraId: item.cameraId, approvedExceptions });
    const entry = { label: item.label, validation };
    entries.push(entry);
    if (canSubmit(validation))
      items.push({ ...item, prompt: withValidation(item.prompt, validation) });
    else skipped.push(entry);
  }
  return { request: items.length ? { ...request, items } : null, entries, skipped };
}
