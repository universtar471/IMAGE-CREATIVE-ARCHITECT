import type { ProjectDNA } from "../schemas/projectDna";
import type { RegionDTO, RegionEditParams } from "./schemas";

export type RegionEditPromptInput = {
  dna: ProjectDNA;
  regions: readonly RegionDTO[];
  params: RegionEditParams;
  nativeMask: boolean;
};

export function buildRegionEditPrompt({
  dna,
  regions,
  params,
  nativeMask,
}: RegionEditPromptInput): string {
  const selected = params.regionIds
    .map((id) => regions.find((region) => region.id === id))
    .filter((region): region is RegionDTO => region !== undefined);
  const objects = new Map((dna.scene?.objects ?? []).map((object) => [object.id, object.name]));
  const labels = selected.map((region) => {
    const objectName = region.objectId ? objects.get(region.objectId) : undefined;
    return objectName ? `${region.label} (${objectName})` : region.label;
  });
  const target = labels.length ? labels.join(", ") : params.regionIds.join(", ");
  const lines: string[] = [];
  if (params.mode === "material_replace") {
    lines.push(
      `For this edit, replace the surface material of ${target} with ${params.material}; keep geometry, edges, openings, lighting direction.`,
    );
  } else {
    lines.push(`Edit only these regions: ${target}. Instruction: ${params.instruction.trim()}`);
  }
  if (!nativeMask)
    lines.push("The second image is a black-and-white mask; only its white area may change.");
  lines.push("Keep everything outside the selected regions unchanged.");
  return lines.join("\n");
}
