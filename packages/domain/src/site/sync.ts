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
import type { SideTopology, SiteTopology } from "../schemas/context";
import type { SiteBoundary, SiteBoundaryKind, SiteExtension } from "../schemas/extensions";
import type { EvidenceStatus } from "../facts/evidence";
import { resolveSiteAdjacency, type SiteAdjacencyInput } from "./adjacency";

const TOPOLOGY_OF_KIND: Record<SiteBoundaryKind, SideTopology> = {
  attached_building: "attached",
  street: "open",
  open_space: "open",
  boundary_wall: "unknown",
  unknown: "unknown",
};

/** The ADR-028 toggles that express the same sides. */
export function siteTopologyFromSite(site: Pick<SiteExtension, "left" | "right">): SiteTopology {
  const cornerSide =
    site.left.kind === "street" ? "left" : site.right.kind === "street" ? "right" : undefined;
  return {
    left: TOPOLOGY_OF_KIND[site.left.kind],
    right: TOPOLOGY_OF_KIND[site.right.kind],
    cornerLot: cornerSide !== undefined,
    ...(cornerSide ? { cornerSide } : {}),
  };
}

/**
 * The `site` extension to start editing from: the stored one, or the four sides derived
 * from the ADR-028 toggles (so the editor opens on what older projects already declared).
 */
export function siteForEditing(dna: SiteAdjacencyInput): SiteExtension {
  const { coordinateConvention, front, left, right, rear } = resolveSiteAdjacency(dna);
  return { version: 1, coordinateConvention, front, left, right, rear };
}

/**
 * A copy of `site` with one side changed. Changing the kind clears the side's neighbour
 * link and height relation, which described the previous kind.
 */
export function withSiteBoundary(
  site: SiteExtension,
  side: keyof Pick<SiteExtension, "front" | "left" | "right" | "rear">,
  patch: { kind?: SiteBoundaryKind; status?: EvidenceStatus },
): SiteExtension {
  const current = site[side];
  const kindChanged = patch.kind !== undefined && patch.kind !== current.kind;
  const base: SiteBoundary = kindChanged
    ? { kind: patch.kind!, evidence: current.evidence }
    : current;
  const next: SiteBoundary = {
    ...base,
    evidence: { ...base.evidence, status: patch.status ?? base.evidence.status },
  };
  return { ...site, [side]: next };
}
