import type { CameraDNA, CameraViewType } from "../schemas/future";
import type { ContextDNA } from "../schemas/context";
import type { SideTopology } from "../schemas/context";
import type { ProjectType } from "../schemas/enums";

export type TopologySource = "explicit" | "inferred" | "default";
export type ResolvedSiteTopology = {
  left: SideTopology;
  right: SideTopology;
  cornerLot: boolean;
  cornerSide?: "left" | "right";
  source: { left: TopologySource; right: TopologySource };
};

const ATTACHED = /attached|party wall|lien ke|lien vach|sat vach/i;

function fold(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function inferredSide(context: ContextDNA, side: "left" | "right"): boolean {
  const zone = context[side];
  return [...zone.adjacentBuildings, zone.notes].some((text) => ATTACHED.test(fold(text)));
}

export function resolveSiteTopology(context: ContextDNA): ResolvedSiteTopology {
  const explicit = context.siteTopology;
  const resolve = (side: "left" | "right"): [SideTopology, TopologySource] => {
    const value = explicit?.[side];
    if (value && value !== "unknown") return [value, "explicit"];
    if (inferredSide(context, side)) return ["attached", "inferred"];
    return [value ?? "unknown", value === "unknown" ? "default" : "default"];
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
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId">,
): "left" | "right" | null {
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
  side?: "left" | "right";
  reason: string;
};

export function cameraSitePlan(
  camera: Pick<CameraDNA, "viewType" | "azimuthDeg" | "presetId"> | undefined,
  context: ContextDNA,
  projectType: ProjectType,
): SitePlan {
  if (!camera || projectType === "interior")
    return { mode: "normal", reason: "interior project or no camera" };
  const topology = resolveSiteTopology(context);
  if (
    camera.viewType === "aerial" &&
    (topology.left === "attached" || topology.right === "attached" || context.density === "high")
  ) {
    return { mode: "aerial_block", reason: "aerial view over an attached or high-density block" };
  }
  const side = revealedSide(camera);
  if (!side) return { mode: "normal", reason: "camera does not reveal a side" };
  const sideValue = topology[side];
  if (sideValue === "attached")
    return { mode: "oblique_street", side, reason: `the ${side} side is attached` };
  if (topology.cornerLot && topology.cornerSide === side)
    return { mode: "corner_side", side, reason: `confirmed ${side} corner side` };
  if (sideValue === "unknown")
    return { mode: "unknown_side", side, reason: `the ${side} side is unknown` };
  return { mode: "normal", side, reason: `the ${side} side is open` };
}

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
