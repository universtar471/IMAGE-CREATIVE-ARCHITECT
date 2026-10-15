/**
 * Visibility resolver (ADR-034, SRS §5.2).
 *
 * Given the four site sides and one camera, decide which facades the camera may show:
 * - The camera's angle names the facades it would reveal (azimuth convention of
 *   `camera/describe.ts`: +45 front-left, ±90 a side, ±180 the rear).
 * - A side (left, right, rear) is visible only when it is `street` or `open_space`. An
 *   attached side is never visible; a boundary wall or an unknown side is never claimed.
 * - The front facade is the reference of the convention: it stays visible unless it is
 *   itself attached, but an unconfirmed or walled front lowers the confidence.
 * - The roof is visible from aerial and high viewpoints only.
 *
 * There are no neighbour heights or setbacks in the DNA yet, so the result never claims
 * exact visibility: `confidence` is capped below 1 and an oblique view next to a neighbour
 * is "may show", not "shows". Pure and deterministic.
 */
import type { CameraDNA } from "../schemas/future";
import { SITE_SIDES, type SiteBoundary, type SiteSide } from "../schemas/extensions";
import { isConfirmed } from "../facts/evidence";
import { normalizeAzimuth } from "../camera/describe";
import { isExposableBoundary, type ResolvedSiteAdjacency } from "./adjacency";

export const FACADES = ["front", "left", "right", "rear", "roof"] as const;
export type Facade = (typeof FACADES)[number];

/** Where a camera may stand, named from the viewer facing the front facade. */
export const CAMERA_ZONES = [
  "front",
  "front_left",
  "front_right",
  "left",
  "right",
  "rear_left",
  "rear_right",
  "rear",
  "aerial",
] as const;
export type CameraZone = (typeof CAMERA_ZONES)[number];

export type VisibilityCamera = Pick<
  CameraDNA,
  "viewType" | "azimuthDeg" | "elevationDeg" | "presetId"
>;

export type VisibilityWarningCode =
  /** The camera angle would reveal an attached side; it stays hidden. */
  | "attached_side_hidden"
  /** A boundary wall runs along a side the angle would reveal. */
  | "boundary_wall"
  /** The side the angle would reveal is unknown; it is not claimed. */
  | "side_unknown"
  /** The facade's site evidence is inferred or unknown. */
  | "evidence_unconfirmed"
  /** An occluding neighbour has no height relation; partial occlusion is approximate. */
  | "neighbour_height_unknown";

export type VisibilityWarning = { code: VisibilityWarningCode; facade: Facade };

export type VisibilityResult = {
  /** Facades the camera may show, in `FACADES` order. */
  visibleFacades: Facade[];
  /** Facades the camera angle points at but the site hides, in `FACADES` order. */
  occludedFacades: Facade[];
  warnings: VisibilityWarning[];
  /** 0..1, two decimals; never 1 (no heights or setbacks are known). */
  confidence: number;
  /** Camera zones from which the building can be seen without exposing a hidden side. */
  feasibleCameraZones: CameraZone[];
};

/** Upper bound: neighbour heights, setbacks and geometry are not modelled yet. */
export const MAX_VISIBILITY_CONFIDENCE = 0.9;

const INTERIOR_VIEWS = new Set(["interior_wide", "interior_detail"]);

/** True when the facade could be shown by some camera, from the site data alone. */
export function isFacadeExposable(adjacency: ResolvedSiteAdjacency, facade: Facade): boolean {
  if (facade === "roof") return true;
  if (facade === "front") return adjacency.front.kind !== "attached_building";
  return isExposableBoundary(adjacency[facade]);
}

/** The camera's azimuth, or one implied by its view type and preset; null when unknown. */
export function cameraAzimuth(camera: VisibilityCamera): number | null {
  if (camera.azimuthDeg !== undefined) return normalizeAzimuth(camera.azimuthDeg);
  const preset = camera.presetId?.toLowerCase() ?? "";
  const side = preset.includes("left") ? 1 : preset.includes("right") ? -1 : 0;
  switch (camera.viewType) {
    case "exterior_rear":
      return 180;
    case "exterior_side":
      return side ? side * 90 : null;
    case "exterior_corner":
      return side ? side * 45 : null;
    default:
      return side ? side * 45 : 0;
  }
}

/** The facades a camera angle points at, before the site is considered. */
export function requestedFacades(camera: VisibilityCamera): Facade[] {
  if (INTERIOR_VIEWS.has(camera.viewType)) return [];
  const out = new Set<Facade>();
  const azimuth = cameraAzimuth(camera);
  if (azimuth === null) {
    out.add("front");
  } else {
    const abs = Math.abs(azimuth);
    const side: Facade = azimuth > 0 ? "left" : "right";
    if (abs < 75) out.add("front");
    if (abs >= 15 && abs < 165) out.add(side);
    if (abs > 105) out.add("rear");
  }
  if (camera.viewType === "aerial" || (camera.elevationDeg ?? 0) >= 25) out.add("roof");
  return FACADES.filter((f) => out.has(f));
}

const ZONE_FACADES: Record<CameraZone, readonly Facade[]> = {
  front: ["front"],
  front_left: ["front", "left"],
  front_right: ["front", "right"],
  left: ["left"],
  right: ["right"],
  rear_left: ["rear", "left"],
  rear_right: ["rear", "right"],
  rear: ["rear"],
  aerial: ["roof"],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolveVisibility(
  adjacency: ResolvedSiteAdjacency,
  camera: VisibilityCamera | null | undefined,
): VisibilityResult {
  const requested = camera ? requestedFacades(camera) : [];
  const visible = requested.filter((f) => isFacadeExposable(adjacency, f));
  const occluded = requested.filter((f) => !visible.includes(f));

  const warnings: VisibilityWarning[] = [];
  let confidence = MAX_VISIBILITY_CONFIDENCE;
  for (const facade of requested) {
    if (facade === "roof") continue;
    const b: SiteBoundary = adjacency[facade];
    if (b.kind === "attached_building" && facade !== "front")
      warnings.push({ code: "attached_side_hidden", facade });
    if (b.kind === "boundary_wall") warnings.push({ code: "boundary_wall", facade });
    if (b.kind === "unknown") {
      if (facade !== "front") warnings.push({ code: "side_unknown", facade });
      confidence *= 0.5;
    }
    if (!isConfirmed(b.evidence)) {
      warnings.push({ code: "evidence_unconfirmed", facade });
      confidence *= 0.7;
    }
    const occluding = b.kind === "attached_building" || b.kind === "boundary_wall";
    if (occluding && (b.heightRelation ?? "unknown") === "unknown") {
      warnings.push({ code: "neighbour_height_unknown", facade });
      confidence *= 0.9;
    }
  }

  const feasibleCameraZones = CAMERA_ZONES.filter((zone) =>
    ZONE_FACADES[zone].some((f) => isFacadeExposable(adjacency, f)),
  );

  return {
    visibleFacades: visible,
    occludedFacades: occluded,
    warnings,
    confidence: round2(confidence),
    feasibleCameraZones,
  };
}

/** The sides (not the roof) a camera points at that the site hides. */
export function occludedSides(visibility: Pick<VisibilityResult, "occludedFacades">): SiteSide[] {
  return SITE_SIDES.filter((s) => visibility.occludedFacades.includes(s));
}
