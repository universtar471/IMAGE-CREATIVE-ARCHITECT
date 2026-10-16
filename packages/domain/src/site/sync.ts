/**
 * Keeping `dna.site` (ADR-034) and the ADR-028 `context.siteTopology` toggles in step.
 *
 * The site editor owns `site` and writes both: older code paths (`cameraSitePlan`, the
 * camera chips, the overview summary) still read `siteTopology`. The mapping is lossy on
 * purpose and always the conservative way round:
 * - attached_building → attached
 * - street / open_space → open; a street left or right side makes the lot a corner lot
 * - boundary_wall / unknown → unknown (never "open": a wall or a guess is not a free side)
 */
import type { SiteTopology } from "../schemas/context";
import type {
  HeightRelation,
  SiteBoundary,
  SiteBoundaryKind,
  SiteExtension,
} from "../schemas/extensions";
import type { EvidenceStatus } from "../facts/evidence";
import type { ProjectType } from "../schemas/enums";
import { resolveSiteAdjacency, type SiteAdjacencyInput } from "./adjacency";
import { topologyFromAdjacency } from "./plan";

/** The ADR-028 toggles that express the same sides. */
export function siteTopologyFromSite(site: Pick<SiteExtension, "left" | "right">): SiteTopology {
  return topologyFromAdjacency(site);
}

/**
 * The `site` extension to start editing from: the stored one, or the four sides derived
 * from the ADR-028 toggles (so the editor opens on what older projects already declared).
 */
export function siteForEditing(dna: SiteAdjacencyInput, projectType?: ProjectType): SiteExtension {
  const { coordinateConvention, front, left, right, rear } = resolveSiteAdjacency(dna, projectType);
  return { version: 1, coordinateConvention, front, left, right, rear };
}

/**
 * A copy of `site` with one side changed. Changing the kind clears the side's neighbour
 * link and height relation, which described the previous kind. `heightRelation` sets the
 * side's height against the building; `null` removes it.
 */
export function withSiteBoundary(
  site: SiteExtension,
  side: keyof Pick<SiteExtension, "front" | "left" | "right" | "rear">,
  patch: {
    kind?: SiteBoundaryKind;
    status?: EvidenceStatus;
    heightRelation?: HeightRelation | null;
  },
): SiteExtension {
  const current = site[side];
  const kindChanged = patch.kind !== undefined && patch.kind !== current.kind;
  const base: SiteBoundary = kindChanged
    ? { kind: patch.kind!, evidence: current.evidence }
    : current;
  const { heightRelation: _old, ...rest } = base;
  const heightRelation =
    patch.heightRelation === undefined ? base.heightRelation : (patch.heightRelation ?? undefined);
  const next: SiteBoundary = {
    ...rest,
    ...(heightRelation !== undefined ? { heightRelation } : {}),
    evidence: { ...base.evidence, status: patch.status ?? base.evidence.status },
  };
  return { ...site, [side]: next };
}

/**
 * Kinds whose height against the building matters, so the site editor offers it: a
 * neighbour or a wall that hides the facade behind it (the visibility resolver lowers
 * confidence while it is unknown).
 */
export function sideHasHeightRelation(kind: SiteBoundaryKind): boolean {
  return kind === "attached_building" || kind === "boundary_wall";
}
