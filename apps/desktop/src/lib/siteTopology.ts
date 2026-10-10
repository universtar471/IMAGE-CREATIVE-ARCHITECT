/**
 * Temporary UI-side copy of the ADR-028 topology contract.
 * TODO(anchor-domain): replace these exports with @arch/domain once the domain branch lands.
 */
import type { CameraDNA, ProjectType } from "@arch/domain";

export type SideTopology = "attached" | "open" | "unknown";
export type CornerSide = "left" | "right";
export type SiteTopology = {
  left: SideTopology;
  right: SideTopology;
  cornerLot: boolean;
  cornerSide?: CornerSide;
};

export type TopologySource = "explicit" | "inferred" | "default";
export type ResolvedSiteTopology = SiteTopology & {
  source: { left: TopologySource; right: TopologySource };
};

type ContextSide = {
  adjacentBuildings?: readonly string[];
  notes?: string;
};

export type TopologyContext = {
  siteTopology?: Partial<SiteTopology>;
  left?: ContextSide;
  right?: ContextSide;
  density?: string;
};

const ATTACHED_TERMS = /attached|party wall|lien ke|lien vach|sat vach/i;

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferredSide(side: ContextSide | undefined): boolean {
  return [...(side?.adjacentBuildings ?? []), side?.notes ?? ""].some((value) =>
    ATTACHED_TERMS.test(fold(value)),
  );
}

function resolveSide(
  context: TopologyContext,
  side: CornerSide,
): { value: SideTopology; source: TopologySource } {
  const explicit = context.siteTopology?.[side];
  if (explicit !== undefined && explicit !== "unknown")
    return { value: explicit, source: "explicit" };
  if (inferredSide(context[side])) return { value: "attached", source: "inferred" };
  if (explicit === "unknown") return { value: "unknown", source: "explicit" };
  return { value: "unknown", source: "default" };
}

export function resolveSiteTopology(
  context: TopologyContext | null | undefined,
): ResolvedSiteTopology {
  const safe = context ?? {};
  const left = resolveSide(safe, "left");
  const right = resolveSide(safe, "right");
  const cornerLot = safe.siteTopology?.cornerLot === true;
  const cornerSide = safe.siteTopology?.cornerSide;
  return {
    left: left.value,
    right: right.value,
    cornerLot,
    ...(cornerSide ? { cornerSide } : {}),
    source: { left: left.source, right: right.source },
  };
}

export function revealedSide(
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId"> | null | undefined,
): CornerSide | null {
  if (!camera || (camera.viewType !== "exterior_corner" && camera.viewType !== "exterior_side"))
    return null;
  if (camera.azimuthDeg !== undefined) {
    if (camera.azimuthDeg > 0) return "left";
    if (camera.azimuthDeg < 0) return "right";
    return null;
  }
  const preset = camera.presetId?.toLowerCase() ?? "";
  if (preset.includes("left")) return "left";
  if (preset.includes("right")) return "right";
  return null;
}

export type CameraSitePlan = {
  mode: "normal" | "oblique_street" | "unknown_side" | "corner_side" | "aerial_block";
  side?: CornerSide;
  reason: string;
};

export function cameraSitePlan(
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId"> | null | undefined,
  context: TopologyContext | null | undefined,
  projectType: ProjectType | string,
): CameraSitePlan {
  if (!camera || projectType === "interior")
    return { mode: "normal", reason: "interior_or_no_camera" };
  const topology = resolveSiteTopology(context);
  if (
    camera.viewType === "aerial" &&
    (topology.left === "attached" || topology.right === "attached" || context?.density === "high")
  )
    return { mode: "aerial_block", reason: "continuous_block" };

  const side = revealedSide(camera);
  if (!side) return { mode: "normal", reason: "no_side_revealed" };
  const value = topology[side];
  if (value === "attached") return { mode: "oblique_street", side, reason: "attached_side" };
  if (topology.cornerLot && topology.cornerSide === side)
    return { mode: "corner_side", side, reason: "confirmed_corner_side" };
  if (value === "unknown") return { mode: "unknown_side", side, reason: "side_not_confirmed" };
  return { mode: "normal", side, reason: "open_side" };
}
