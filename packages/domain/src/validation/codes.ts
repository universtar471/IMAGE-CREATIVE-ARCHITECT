/**
 * Unified conflict codes (SRS §12.4, ADR-034). Every module reports conflicts with these
 * codes, the same severities and the same i18n keys (`conflicts.<CODE>` in the desktop
 * dictionaries).
 *
 * - BLOCK: generation must not be submitted. It is cleared only by editing project data,
 *   never by an exception or a prompt sentence.
 * - WARN: the user may accept it as an exception for one shot (`exceptionAllowed`).
 * - `escalatesTo`: a WARN code that a rule may raise to BLOCK when the data is confirmed.
 */

export const VALIDATOR_VERSION = "cv-1.0.0";

export type ConflictSeverity = "BLOCK" | "WARN";
export type ShotVerdict = ConflictSeverity | "ALLOW";

/** The SRS §17 phase whose rules raise the code; codes of later phases are registered only. */
export type ConflictPhase = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";

export type ConflictCodeInfo = {
  defaultSeverity: ConflictSeverity;
  escalatesTo?: "BLOCK";
  messageKey: `conflicts.${string}`;
  phase: ConflictPhase;
};

const code = (
  name: string,
  defaultSeverity: ConflictSeverity,
  phase: ConflictPhase,
  escalates = false,
): ConflictCodeInfo => ({
  defaultSeverity,
  ...(escalates ? { escalatesTo: "BLOCK" as const } : {}),
  messageKey: `conflicts.${name}`,
  phase,
});

export const CONFLICT_CODES = {
  SPACE_NOT_IN_BUILDING: code("SPACE_NOT_IN_BUILDING", "BLOCK", "P1"),
  UNVERIFIED_GEOMETRY: code("UNVERIFIED_GEOMETRY", "WARN", "P0", true),
  OCCLUDED_TARGET: code("OCCLUDED_TARGET", "WARN", "P1", true),
  ADJACENT_BUILDING_CONFLICT: code("ADJACENT_BUILDING_CONFLICT", "BLOCK", "P0"),
  OBJECT_NOT_ALLOWED_IN_SPACE: code("OBJECT_NOT_ALLOWED_IN_SPACE", "BLOCK", "P2"),
  OBJECT_NO_PLACEMENT_ZONE: code("OBJECT_NO_PLACEMENT_ZONE", "WARN", "P2", true),
  EFFECT_SOURCE_MISSING: code("EFFECT_SOURCE_MISSING", "BLOCK", "P2"),
  EFFECT_MOTION_CONFLICT: code("EFFECT_MOTION_CONFLICT", "BLOCK", "P2"),
  LOCKED_LIGHTING_CONFLICT: code("LOCKED_LIGHTING_CONFLICT", "BLOCK", "P0"),
  ENHANCE_PRESERVATION_RISK: code("ENHANCE_PRESERVATION_RISK", "WARN", "P3", true),
  OUTPUT_SIZE_MISMATCH: code("OUTPUT_SIZE_MISMATCH", "BLOCK", "P3"),
  PAGE_COUNT_MISMATCH: code("PAGE_COUNT_MISMATCH", "BLOCK", "P5"),
  REQUIRED_IMAGE_MISSING: code("REQUIRED_IMAGE_MISSING", "BLOCK", "P5"),
  PRINT_READABILITY_LOW: code("PRINT_READABILITY_LOW", "WARN", "P5"),
  UNVERIFIED_PUBLICATION_FACT: code("UNVERIFIED_PUBLICATION_FACT", "BLOCK", "P5"),
} as const satisfies Record<string, ConflictCodeInfo>;

export type ConflictCode = keyof typeof CONFLICT_CODES;

/** Codes in table order (SRS §12.4). */
export const CONFLICT_CODE_LIST = Object.keys(CONFLICT_CODES) as ConflictCode[];

export function isConflictCode(value: unknown): value is ConflictCode {
  return typeof value === "string" && Object.hasOwn(CONFLICT_CODES, value);
}
