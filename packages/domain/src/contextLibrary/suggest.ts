import type { ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import type { SiteBoundary } from "../schemas/extensions";
import { resolveSiteAdjacency, type ResolvedSiteAdjacency } from "../site/adjacency";
import { CONTEXT_LIBRARY } from "./registry";
import type { ContextLibraryPreset, ContextSuggestionResult } from "./schemas";

/**
 * Evidence rules (ADR-034 amendment 1): Context Library V4 sits below site evidence, so a cue
 * that the resolved site adjacency contradicts is dropped. The rules mirror what the
 * `SITE & OCCLUSION` section asserts, so the suggestions never argue with it. An `unknown`
 * side never contradicts anything.
 */
const ONE_SIDE_ATTACHED = /\bone attached neighbou?r\b/i;
const PARTY_WALL =
  /party[- ]walls?|attached neighbou?rs?|continuous party[- ]wall|attached side|row[- ]house/i;
const DETACHED_GROUNDS =
  /\blawn\b|\bgrounds?\b|detached villa garden|open grounds|four-sided garden|four exposed elevations|fully detached/i;
const CORNER = /two street-facing elevations|two street edges|\bintersection\b/i;
/** A forbidden cue that forbids what the evidence establishes (an attached neighbour). */
const FORBIDS_PARTY_WALL = /party[- ]walls?|attached neighbou?rs?/i;

const exposable = (b: SiteBoundary) => b.kind === "street" || b.kind === "open_space";
const attached = (b: SiteBoundary) => b.kind === "attached_building";

function cueContradicts(line: string, site: ResolvedSiteAdjacency): boolean {
  const lateral = [site.left, site.right];
  if (ONE_SIDE_ATTACHED.test(line)) return lateral.every(attached) || lateral.every(exposable);
  if (PARTY_WALL.test(line) && lateral.some(exposable)) return true;
  if (DETACHED_GROUNDS.test(line) && [...lateral, site.rear].some(attached)) return true;
  if (CORNER.test(line) && !lateral.some((b) => b.kind === "street") && lateral.some(attached))
    return true;
  return false;
}

function forbiddenContradicts(line: string, site: ResolvedSiteAdjacency): boolean {
  return FORBIDS_PARTY_WALL.test(line) && [site.left, site.right, site.rear].some(attached);
}

const keepEvidenceSafe = (
  lines: readonly string[],
  contradicts: (line: string) => boolean,
  dropped: string[],
): string[] =>
  lines.filter((line) => {
    if (!contradicts(line)) return true;
    dropped.push(line);
    return false;
  });

/**
 * Suggestions of one preset (and optional region) for this DNA, with every cue that the site
 * evidence contradicts moved to `droppedForEvidence`. Pass the project type so the site sides
 * are resolved exactly as the compiler's `SITE & OCCLUSION` section resolves them.
 */
export function suggestContext(
  dna: Pick<ProjectDNA, "site" | "context">,
  presetId: string,
  regionId?: string | null,
  projectType?: ProjectType,
): ContextSuggestionResult {
  const preset: ContextLibraryPreset | null = CONTEXT_LIBRARY.preset(presetId);
  if (!preset) throw new Error(`Unknown context preset: ${presetId}`);
  const region = regionId && regionId !== "unspecified" ? CONTEXT_LIBRARY.region(regionId) : null;
  if (regionId && regionId !== "unspecified" && !region)
    throw new Error(`Unknown context region: ${regionId}`);
  const site = resolveSiteAdjacency(dna, projectType);
  const cue = (line: string) => cueContradicts(line, site);
  const droppedForEvidence: string[] = [];
  return {
    requiredLines: keepEvidenceSafe(preset.requiredIfSupported, cue, droppedForEvidence),
    optionalLines: keepEvidenceSafe(preset.optional, cue, droppedForEvidence),
    forbiddenLines: keepEvidenceSafe(
      preset.forbiddenByDefault,
      (line) => forbiddenContradicts(line, site),
      droppedForEvidence,
    ),
    regionDetails: keepEvidenceSafe(region?.details ?? [], cue, droppedForEvidence),
    regionAvoid: region?.avoid.slice() ?? [],
    droppedForEvidence,
  };
}
