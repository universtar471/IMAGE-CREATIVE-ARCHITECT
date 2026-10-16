/**
 * The ADR-028 camera × site plan, read from the resolved site adjacency (ADR-034).
 *
 * `cameraSitePlan` reads the `context.siteTopology` toggles. The compiler's negative prompt,
 * camera section and SITE & OCCLUSION section, and the camera chips, read the plan from
 * `resolveSiteAdjacency` instead, so an explicit `site` wins over the toggles. The sides are
 * folded back to the toggle vocabulary the plan rules use:
 * - attached_building → attached
 * - street / open_space → open; a street on the left or right side is the corner side
 * - boundary_wall / unknown → unknown
 * For a DNA without `site` the adjacency is derived from the toggles, so the plan is the
 * same as `cameraSitePlan` on the toggles; so it is for a `site` that mirrors them.
 */
import type { SideTopology, SiteTopology } from "../schemas/context";
import type { CameraDNA } from "../schemas/future";
import type { ProjectType } from "../schemas/enums";
import type { SiteBoundaryKind } from "../schemas/extensions";
import { cameraSitePlan, type SitePlan } from "../prompt/topology";
import {
  resolveSiteAdjacency,
  type ResolvedSiteAdjacency,
  type SiteAdjacencyInput,
} from "./adjacency";

const TOPOLOGY_OF_KIND: Record<SiteBoundaryKind, SideTopology> = {
  attached_building: "attached",
  street: "open",
  open_space: "open",
  boundary_wall: "unknown",
  unknown: "unknown",
};

/** The left/right toggles that express the resolved sides (corner side: left first). */
export function topologyFromAdjacency(
  adjacency: Pick<ResolvedSiteAdjacency, "left" | "right">,
): SiteTopology {
  const cornerSide =
    adjacency.left.kind === "street"
      ? "left"
      : adjacency.right.kind === "street"
        ? "right"
        : undefined;
  return {
    left: TOPOLOGY_OF_KIND[adjacency.left.kind],
    right: TOPOLOGY_OF_KIND[adjacency.right.kind],
    cornerLot: cornerSide !== undefined,
    ...(cornerSide ? { cornerSide } : {}),
  };
}

/** The camera plan of one shot, from `site` when present, else from the toggles. */
export function siteCameraPlan(
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId"> | null | undefined,
  dna: SiteAdjacencyInput,
  projectType: ProjectType,
): SitePlan {
  if (!camera || projectType === "interior")
    return { mode: "normal", reason: "interior_or_no_camera" };
  const adjacency = resolveSiteAdjacency(dna, projectType);
  return cameraSitePlan(
    camera,
    // Explicit values only: no free-text inference and no project-type default on top.
    { siteTopology: topologyFromAdjacency(adjacency), density: dna.context?.density },
    projectType,
  );
}
