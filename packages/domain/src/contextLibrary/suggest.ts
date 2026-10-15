import type { ProjectDNA } from "../schemas/projectDna";
import { resolveSiteAdjacency } from "../site/adjacency";
import { CONTEXT_LIBRARY } from "./registry";
import type { ContextLibraryPreset, ContextSuggestionResult } from "./schemas";

const PARTY_WALL =
  /party[- ]walls?|attached neighbor|continuous party[- ]wall|attached side|row[- ]house/i;
const LAWN_OR_GROUNDS =
  /\blawn\b|\bgrounds?\b|detached villa garden|open grounds|four-sided garden/i;

const evidenceContradicts = (line: string, dna: ProjectDNA): boolean => {
  const adjacency = resolveSiteAdjacency(dna);
  const sides = [adjacency.front, adjacency.left, adjacency.right, adjacency.rear];
  if (
    PARTY_WALL.test(line) &&
    sides.some((side) => side.kind === "street" || side.kind === "open_space")
  )
    return true;
  if (LAWN_OR_GROUNDS.test(line) && sides.some((side) => side.kind === "attached_building"))
    return true;
  return false;
};

const keepEvidenceSafe = (lines: readonly string[], dna: ProjectDNA, dropped: string[]): string[] =>
  lines.filter((line) => {
    if (!evidenceContradicts(line, dna)) return true;
    dropped.push(line);
    return false;
  });

export function suggestContext(
  dna: ProjectDNA,
  presetId: string,
  regionId?: string | null,
): ContextSuggestionResult {
  const preset: ContextLibraryPreset | null = CONTEXT_LIBRARY.preset(presetId);
  if (!preset) throw new Error(`Unknown context preset: ${presetId}`);
  const region = regionId && regionId !== "unspecified" ? CONTEXT_LIBRARY.region(regionId) : null;
  if (regionId && regionId !== "unspecified" && !region)
    throw new Error(`Unknown context region: ${regionId}`);
  const droppedForEvidence: string[] = [];
  return {
    requiredLines: keepEvidenceSafe(preset.requiredIfSupported, dna, droppedForEvidence),
    optionalLines: keepEvidenceSafe(preset.optional, dna, droppedForEvidence),
    forbiddenLines: preset.forbiddenByDefault.slice(),
    regionDetails: region?.details.slice() ?? [],
    regionAvoid: region?.avoid.slice() ?? [],
    droppedForEvidence,
  };
}
