/** DETAIL TARGET section (ADR-036 P2b, SRS §5.3). */
import type { ProjectType } from "../../schemas/enums";
import type { DetailRecord } from "../../schemas/extensions";
import type { ProjectDNA } from "../../schemas/projectDna";

export const DETAIL_TARGET_HEADING = "DETAIL TARGET:";

function detailFacade(detail: DetailRecord): string | null {
  return detail.facade ?? detail.location?.facade ?? null;
}

function detailFloor(detail: DetailRecord): string | null {
  return detail.floorId ?? detail.location?.floorId ?? null;
}

function subjectLine(detail: DetailRecord, projectType: ProjectType): string {
  const label = detail.name?.trim() || "architectural detail";
  const facade = detailFacade(detail);
  const floor = detailFloor(detail);
  const qualifiers = [
    floor ? `floor ${floor}` : null,
    facade ? `${facade.toUpperCase()} facade` : null,
  ].filter((value): value is string => value !== null);
  const location = qualifiers.length ? ` (${qualifiers.join(", ")})` : "";
  const building = projectType === "townhouse" ? "townhouse" : "building";
  return `Approved ${label}${location} of the ${building}.`;
}

/** Lines for a target detail, or an empty list when the target is absent or unknown. */
export function detailTargetLines(
  dna: Pick<ProjectDNA, "architecturalDetails">,
  targetDetailId: string | null | undefined,
  projectType: ProjectType,
): string[] {
  if (!targetDetailId) return [];
  const detail = dna.architecturalDetails?.find((item) => item.id === targetDetailId);
  if (!detail) return [];
  const materials = detail.materialIds.length
    ? "approved materials"
    : "the existing surface finish";
  return [
    `${DETAIL_TARGET_HEADING} ${subjectLine(detail, projectType)}`,
    "Focus on the existing railing, surface finish, material junctions and adjacent openings.",
    `Maintain the exact floor, facade, proportions and ${materials}.`,
    "Use a plausible camera location from the street; retain neighboring buildings where visible. Do not invent a free side elevation, extra windows or a new balcony.",
  ];
}

export function detailTargetSection(
  dna: Pick<ProjectDNA, "architecturalDetails">,
  targetDetailId: string | null | undefined,
  projectType: ProjectType,
): string | null {
  const lines = detailTargetLines(dna, targetDetailId, projectType);
  return lines.length ? lines.join("\n") : null;
}
