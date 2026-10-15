/**
 * Site adjacency resolver (ADR-034, SRS §5.2).
 *
 * The explicit `site` extension wins. Older projects only have the ADR-028
 * `context.siteTopology` toggles (plus free-text hints), so the four sides are derived:
 * - attached → attached_building
 * - open → open_space, or street on the cornerSide of a corner lot
 * - unknown → unknown
 * - front → street; rear → unknown
 * A side set by a UI toggle is `user_declared`; one read from free text is `inferred`.
 *
 * Left/right are as seen by a viewer outside the plot facing the front facade.
 */
import type { ContextDNA } from "../schemas/context";
import type { SiteBoundary, SiteExtension, SiteSide } from "../schemas/extensions";
import { resolveSiteTopology, type CornerSide, type TopologySource } from "../prompt/topology";
import type { EvidenceStatus } from "../facts/evidence";

export type SiteAdjacencySource = "site" | "siteTopology";

export type ResolvedSiteAdjacency = Pick<
  SiteExtension,
  "coordinateConvention" | "front" | "left" | "right" | "rear"
> & {
  /** Where the sides came from: the `site` extension or the ADR-028 derivation. */
  source: SiteAdjacencySource;
};

export type SiteAdjacencyInput = {
  site?: SiteExtension | null;
  context?: Pick<ContextDNA, "siteTopology" | "left" | "right" | "density"> | null;
};

const boundary = (kind: SiteBoundary["kind"], status: EvidenceStatus): SiteBoundary => ({
  kind,
  evidence: { status, sourceAssetIds: [] },
});

const TOPOLOGY_EVIDENCE: Record<TopologySource, EvidenceStatus> = {
  explicit: "user_declared",
  inferred: "inferred",
  default: "unknown",
};

export function resolveSiteAdjacency(dna: SiteAdjacencyInput): ResolvedSiteAdjacency {
  if (dna.site) {
    const { coordinateConvention, front, left, right, rear } = dna.site;
    return { source: "site", coordinateConvention, front, left, right, rear };
  }
  const topology = resolveSiteTopology(dna.context);
  const side = (name: CornerSide): SiteBoundary => {
    const value = topology[name];
    const status = TOPOLOGY_EVIDENCE[topology.source[name]];
    if (value === "attached") return boundary("attached_building", status);
    if (value === "open")
      return boundary(
        topology.cornerLot && topology.cornerSide === name ? "street" : "open_space",
        status,
      );
    return boundary("unknown", "unknown");
  };
  return {
    source: "siteTopology",
    coordinateConvention: "viewer_facing_front_facade",
    front: boundary("street", "inferred"),
    left: side("left"),
    right: side("right"),
    rear: boundary("unknown", "unknown"),
  };
}

/** A side a camera may actually show as a free facade. */
export function isExposableBoundary(b: Pick<SiteBoundary, "kind">): boolean {
  return b.kind === "street" || b.kind === "open_space";
}

export function attachedSides(adjacency: ResolvedSiteAdjacency): SiteSide[] {
  return (["front", "left", "right", "rear"] as const).filter(
    (s) => adjacency[s].kind === "attached_building",
  );
}
