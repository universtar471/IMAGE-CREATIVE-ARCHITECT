import type { z } from "zod";
import { ProjectDNASchema, type ProjectDNA } from "../schemas/projectDna";
import type { ProjectType } from "../schemas/enums";

export type FieldErrors = Record<string, string>;

export type DNAValidation = { ok: true; dna: ProjectDNA } | { ok: false; fieldErrors: FieldErrors };

/**
 * Validate a complete DNA aggregate. Error keys are dotted paths
 * (e.g. "building.dimensions.widthM") so forms can attach messages to fields.
 */
export function validateProjectDNA(candidate: unknown): DNAValidation {
  const parsed = ProjectDNASchema.safeParse(candidate);
  if (parsed.success) return { ok: true, dna: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path.map(String).join(".") || "(root)";
    fieldErrors[key] ??= friendlyMessage(issue);
  }
  return { ok: false, fieldErrors };
}

type Issue = z.core.$ZodIssue;

/** Turn Zod's technical messages into actionable field messages. */
function friendlyMessage(issue: Issue): string {
  const msg = issue.message;
  if (issue.code === "invalid_type") {
    if (/received NaN/i.test(msg)) return "Enter a valid number.";
    if (/received undefined/i.test(msg)) return "This field is required.";
  }
  if (issue.code === "too_small" && issue.origin === "number") {
    return issue.inclusive
      ? `Must be at least ${issue.minimum}.`
      : `Must be greater than ${issue.minimum}.`;
  }
  if (issue.code === "too_big" && issue.origin === "number") {
    return `Must be at most ${issue.maximum}.`;
  }
  if (issue.code === "too_small" && issue.origin === "string") return "This field cannot be empty.";
  if (issue.code === "invalid_type" && /expected int/i.test(msg)) return "Enter a whole number.";
  return msg;
}

export type ReadinessItem = { key: string; label: string; done: boolean };

/**
 * Minimum DNA for status `dna_ready`. Mirrored by the Rust service
 * (`services::status::dna_is_ready`); keep both in sync.
 */
export function dnaReadiness(dna: ProjectDNA, projectType: ProjectType): ReadinessItem[] {
  return [
    {
      key: "building.architecturalStyle",
      label: "Architectural style",
      done: !!dna.building.architecturalStyle,
    },
    {
      key: "building.floors",
      label: "Number of floors",
      done: projectType === "interior" || dna.building.floors !== undefined,
    },
    {
      key: "context.macroContext",
      label: "Macro context",
      done: !!dna.context.macroContext,
    },
  ];
}

export const isDnaReady = (dna: ProjectDNA, projectType: ProjectType) =>
  dnaReadiness(dna, projectType).every((i) => i.done);
