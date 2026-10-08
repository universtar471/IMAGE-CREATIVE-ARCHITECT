import { ProjectDNASchema, type ProjectDNA } from "../schemas/projectDna";
import type { ProjectType } from "../schemas/enums";

export type FieldErrors = Record<string, string>;

export type DNAValidation =
  | { ok: true; dna: ProjectDNA }
  | { ok: false; fieldErrors: FieldErrors };

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
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
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
