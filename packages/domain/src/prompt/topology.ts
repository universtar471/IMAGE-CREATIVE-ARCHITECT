import type { CameraDNA, CameraViewType } from "../schemas/future";
import type { SideTopology, SiteTopology } from "../schemas/context";
import type { ProjectType } from "../schemas/enums";

export type CornerSide = "left" | "right";
export type TopologySource = "explicit" | "inferred" | "default";

/** The context shape needed by topology helpers; complete ContextDNA is accepted too. */
export type TopologyContext = {
  siteTopology?: Partial<SiteTopology>;
  left?: { adjacentBuildings?: readonly string[]; notes?: string };
  right?: { adjacentBuildings?: readonly string[]; notes?: string };
  density?: string;
};

export type ResolvedSiteTopology = {
  left: SideTopology;
  right: SideTopology;
  cornerLot: boolean;
  cornerSide?: CornerSide;
  source: { left: TopologySource; right: TopologySource };
};

const ATTACHED = /attached|party wall|lien ke|lien vach|sat vach/i;

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function inferredSide(context: TopologyContext, side: CornerSide): boolean {
  const zone = context[side];
  return [...(zone?.adjacentBuildings ?? []), zone?.notes ?? ""].some((text) =>
    ATTACHED.test(fold(text)),
  );
}

export function resolveSiteTopology(
  context: TopologyContext | null | undefined,
): ResolvedSiteTopology {
  const safe = context ?? {};
  const explicit = safe.siteTopology;
  const resolve = (side: CornerSide): [SideTopology, TopologySource] => {
    const value = explicit?.[side];
    if (value && value !== "unknown") return [value, "explicit"];
    if (inferredSide(safe, side)) return ["attached", "inferred"];
    return [value ?? "unknown", value === "unknown" ? "explicit" : "default"];
  };
  const [left, leftSource] = resolve("left");
  const [right, rightSource] = resolve("right");
  return {
    left,
    right,
    cornerLot: explicit?.cornerLot ?? false,
    ...(explicit?.cornerSide ? { cornerSide: explicit.cornerSide } : {}),
    source: { left: leftSource, right: rightSource },
  };
}

export function revealedSide(
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId"> | null | undefined,
): CornerSide | null {
  if (!camera) return null;
  if (camera.viewType !== "exterior_corner" && camera.viewType !== "exterior_side") return null;
  if (camera.azimuthDeg !== undefined)
    return camera.azimuthDeg > 0 ? "left" : camera.azimuthDeg < 0 ? "right" : null;
  const preset = camera.presetId?.toLowerCase() ?? "";
  if (preset.includes("left")) return "left";
  if (preset.includes("right")) return "right";
  return null;
}

export type SitePlan = {
  mode: "normal" | "oblique_street" | "unknown_side" | "corner_side" | "aerial_block";
  side?: CornerSide;
  reason: string;
};

export function cameraSitePlan(
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId"> | null | undefined,
  context: TopologyContext | null | undefined,
  projectType: ProjectType,
): SitePlan {
  if (!camera || projectType === "interior")
    return { mode: "normal", reason: "interior_or_no_camera" };
  const topology = resolveSiteTopology(context);
  if (
    camera.viewType === "aerial" &&
    (topology.left === "attached" || topology.right === "attached" || context?.density === "high")
  ) {
    return { mode: "aerial_block", reason: "continuous_block" };
  }
  const side = revealedSide(camera);
  if (!side) return { mode: "normal", reason: "no_side_revealed" };
  const sideValue = topology[side];
  if (sideValue === "attached") return { mode: "oblique_street", side, reason: "attached_side" };
  if (topology.cornerLot && topology.cornerSide === side)
    return { mode: "corner_side", side, reason: "confirmed_corner_side" };
  if (sideValue === "unknown") return { mode: "unknown_side", side, reason: "side_not_confirmed" };
  return { mode: "normal", side, reason: "open_side" };
}

export type CameraSitePlan = SitePlan;

export const viewTypeFraming = (viewType: CameraViewType, interior: boolean): string => {
  const framing: Record<CameraViewType, string> = {
    exterior_front: "exterior front view",
    exterior_corner: "exterior three-quarter view",
    exterior_side: "exterior side view",
    exterior_rear: "exterior rear view",
    aerial: "aerial architectural view",
    street_level: "street-level view",
    detail: "architectural detail view",
    interior_wide: "wide interior view",
    interior_detail: "interior detail view",
    custom: interior ? "interior view" : "architectural view",
  };
  return framing[viewType];
};
