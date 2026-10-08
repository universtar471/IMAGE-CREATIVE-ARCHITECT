import type { z } from "zod";
import { CameraDNASchema, type CameraDNA } from "../schemas/future";
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
  if (!parsed.success) return { ok: false, fieldErrors: issueErrors(parsed.error.issues) };
  const cameraErrors = cameraSetErrors(parsed.data.cameras);
  if (Object.keys(cameraErrors).length) return { ok: false, fieldErrors: cameraErrors };
  return { ok: true, dna: parsed.data };
}

export type CameraValidation =
  { ok: true; camera: CameraDNA } | { ok: false; fieldErrors: FieldErrors };

/**
 * Validate one camera for the field editor. Keys are camera field names ("lensMm");
 * pass the other cameras to also check that the name is unique.
 */
export function validateCamera(
  candidate: unknown,
  otherCameras: readonly Pick<CameraDNA, "id" | "name">[] = [],
): CameraValidation {
  const parsed = CameraDNASchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, fieldErrors: issueErrors(parsed.error.issues) };
  const errors = cameraSetErrors([...otherCameras, parsed.data]);
  const own = otherCameras.length;
  const fieldErrors: FieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    const m = /^cameras\.(\d+)\.(.+)$/.exec(key);
    if (m && Number(m[1]) === own) fieldErrors[m[2]!] = message;
  }
  return Object.keys(fieldErrors).length
    ? { ok: false, fieldErrors }
    : { ok: true, camera: parsed.data };
}

/**
 * Rules across cameras that JSON Schema cannot express: ids are unique (anchors, jobs and
 * generations refer to them) and names are unique (case-insensitive) so lists, job labels
 * and the Contact Sheet stay unambiguous. Later duplicates get the error.
 */
function cameraSetErrors(cameras: readonly Pick<CameraDNA, "id" | "name">[]): FieldErrors {
  const errors: FieldErrors = {};
  const ids = new Set<string>();
  const names = new Set<string>();
  cameras.forEach((c, i) => {
    if (ids.has(c.id)) errors[`cameras.${i}.id`] = "Another camera already uses this id.";
    ids.add(c.id);
    const name = c.name.trim().toLowerCase();
    if (names.has(name)) errors[`cameras.${i}.name`] = "Another camera already uses this name.";
    names.add(name);
  });
  return errors;
}

function issueErrors(issues: readonly Issue[]): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".") || "(root)";
    fieldErrors[key] ??= friendlyMessage(issue);
  }
  return fieldErrors;
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
  if (issue.code === "invalid_format" && issue.path.at(-1) === "id") return "Invalid camera id.";
  if (issue.code === "invalid_value" && issue.path.at(-1) === "viewType")
    return "Choose a view type from the list.";
  return msg;
}

export type ReadinessItem = {
  key: string;
  label: string;
  done: boolean;
  /** What is missing, when the item can name it (e.g. the cameras without an anchor). */
  detail?: string;
};

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
