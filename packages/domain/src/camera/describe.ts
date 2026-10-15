/**
 * Deterministic wording for a camera (the compiler's "camera" section, also usable as UI
 * captions). Angle convention (CameraDNASchema): azimuth 0 = looking straight at the front
 * facade; positive = orbiting clockwise seen from above with the front facade at the bottom
 * of the plan, i.e. toward the viewer's LEFT when facing the front. So +45 is the front-left
 * three-quarter view, -45 front-right, ±90 the left/right side, ±180 the rear.
 */
import type { CameraDNA, CameraViewType } from "../schemas/future";
import type { Facade, VisibilityResult } from "../site/visibility";

const VIEW_TYPE_WORDS: Record<CameraViewType, string> = {
  exterior_front: "exterior front view",
  exterior_corner: "exterior corner view",
  exterior_side: "exterior side view",
  exterior_rear: "exterior rear view",
  aerial: "aerial view",
  street_level: "street-level pedestrian view",
  detail: "architectural detail view",
  interior_wide: "wide interior view",
  interior_detail: "interior detail view",
  custom: "custom view",
};

export const isInteriorViewType = (t: CameraViewType) =>
  t === "interior_wide" || t === "interior_detail";

/** Azimuth normalised to (-180, 180]. */
export function normalizeAzimuth(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** "frontal view", "front-left three-quarter view", "left side view", "rear view", … */
export function azimuthWords(azimuthDeg: number): string {
  const a = normalizeAzimuth(azimuthDeg);
  const side = a > 0 ? "left" : "right";
  const abs = Math.abs(a);
  if (abs < 15) return "frontal view";
  if (abs < 75) return `front-${side} three-quarter view`;
  if (abs <= 105) return `${side} side view`;
  if (abs < 165) return `rear-${side} three-quarter view`;
  return "rear view";
}

/** "from eye level", "from a high aerial viewpoint, about 32° down", … or null. */
export function elevationWords(camera: Pick<CameraDNA, "elevationDeg" | "heightM">): string | null {
  const e = camera.elevationDeg;
  const h = camera.heightM;
  if (e !== undefined) {
    if (e <= -10) return "from a low angle looking up";
    if (e < 10) {
      if (h !== undefined && h > 2.2) return `from a raised viewpoint about ${num(h)} m high`;
      if (h !== undefined && h < 1.3) return "from a low, seated eye level";
      return "from eye level";
    }
    if (e < 25) return "from a slightly elevated viewpoint";
    if (e < 60) return `from an aerial viewpoint, about ${num(e)}° down`;
    return "from directly overhead";
  }
  if (h !== undefined) {
    if (h > 2.2) return `from a raised viewpoint about ${num(h)} m high`;
    if (h < 1.3) return "from a low, seated eye level";
    return "from eye level";
  }
  return null;
}

/** Viewpoint phrase, e.g. "front-left three-quarter view from eye level", or null. */
export function viewpointWords(camera: CameraDNA): string | null {
  const parts: string[] = [];
  if (camera.azimuthDeg !== undefined && !isInteriorViewType(camera.viewType)) {
    parts.push(azimuthWords(camera.azimuthDeg));
  }
  const elevation = elevationWords(camera);
  if (elevation) parts.push(parts.length ? elevation : `view ${elevation}`);
  return parts.length ? parts.join(" ") : null;
}

/** Lens feel by 35 mm-equivalent focal length, e.g. "24 mm wide-angle". */
export function lensWords(lensMm: number): string {
  const feel =
    lensMm < 20
      ? "ultra-wide-angle"
      : lensMm < 35
        ? "wide-angle"
        : lensMm < 70
          ? "natural standard"
          : lensMm < 135
            ? "short telephoto, compressed perspective"
            : "telephoto, strongly compressed perspective";
  return `${num(lensMm)} mm ${feel} lens`;
}

/** The compiler's camera section text, without site knowledge. */
export function cameraSectionText(camera: CameraDNA): string {
  return describeCamera(camera);
}

/** The facades an azimuth's wording names ("front-left three-quarter" → front, left). */
function namedFacades(azimuthDeg: number): Facade[] {
  const a = normalizeAzimuth(azimuthDeg);
  const side: Facade = a > 0 ? "left" : "right";
  const abs = Math.abs(a);
  if (abs < 15) return ["front"];
  if (abs < 75) return ["front", side];
  if (abs <= 105) return [side];
  if (abs < 165) return ["rear", side];
  return ["rear"];
}

/** "front-left", "left", "rear-right", "rear" or "front". */
function directionWords(azimuthDeg: number): string {
  const a = normalizeAzimuth(azimuthDeg);
  const side = a > 0 ? "left" : "right";
  const abs = Math.abs(a);
  if (abs < 15) return "front";
  if (abs < 75) return `front-${side}`;
  if (abs <= 105) return side;
  if (abs < 165) return `rear-${side}`;
  return "rear";
}

/** Composition wording that promises a facade ("…and the left side", "rear elevation"). */
const FACADE_PROMISE: Partial<Record<Facade, RegExp>> = {
  left: /\bleft(?:[- ]hand)?\s+(?:side|facade|façade|elevation|wall)s?\b/i,
  right: /\bright(?:[- ]hand)?\s+(?:side|facade|façade|elevation|wall)s?\b/i,
  rear: /\b(?:rear|back)\s+(?:side|facade|façade|elevation|wall)s?\b/i,
};
const TWO_FACADES = /\b(?:two|both|2)\s+(?:exposed\s+)?(?:facades|sides|elevations)\b/i;

/**
 * The azimuth wording when the site hides a facade the angle names, so the text never
 * promises it (ADR-034): an attached or walled side is "front facade only"; an unknown
 * side is neither promised nor forbidden ("centred on the front facade").
 */
function occlusionAwareAzimuth(azimuthDeg: number, visibility: VisibilityResult): string | null {
  const named = namedFacades(azimuthDeg);
  const hidden = named.filter((f) => visibility.occludedFacades.includes(f));
  if (!hidden.length) return null;
  const shown = named.filter((f) => !hidden.includes(f));
  const roof = visibility.visibleFacades.includes("roof") ? " and roof" : "";
  const unknownOnly = hidden.every((f) =>
    visibility.warnings.some((w) => w.facade === f && w.code === "side_unknown"),
  );
  const direction = directionWords(azimuthDeg);
  if (shown.length) {
    const facade = `${shown.join(" and ")} facade${roof}`;
    return unknownOnly
      ? `${direction} oblique view centred on the ${facade}`
      : `${direction} oblique view of the ${facade} only`;
  }
  const facades = hidden.map((f) => `${f} facade`).join(" and ");
  return `${direction}-side viewpoint; the ${facades} ${hidden.length > 1 ? "are" : "is"} ${
    unknownOnly ? "not confirmed" : "not shown"
  }`;
}

/**
 * The camera section text. With a `visibility` (from `resolveVisibility`) the viewpoint
 * and composition never promise a facade the site hides: the azimuth wording is narrowed
 * and a composition naming a hidden facade is replaced by the visible one.
 */
export function describeCamera(camera: CameraDNA, visibility?: VisibilityResult | null): string {
  const parts: string[] = [VIEW_TYPE_WORDS[camera.viewType]];
  const guarded =
    visibility && camera.azimuthDeg !== undefined && !isInteriorViewType(camera.viewType)
      ? occlusionAwareAzimuth(camera.azimuthDeg, visibility)
      : null;
  const viewpoint = guarded
    ? joinViewpoint(guarded, elevationWords(camera))
    : viewpointWords(camera);
  if (viewpoint) parts.push(`viewpoint: ${viewpoint}`);
  if (camera.lensMm !== undefined) parts.push(`lens: ${lensWords(camera.lensMm)}`);
  if (camera.distanceM !== undefined) {
    const target = isInteriorViewType(camera.viewType) ? "the subject" : "the building";
    parts.push(`distance: about ${num(camera.distanceM)} m from ${target}`);
  }
  const composition = guardComposition(camera.composition?.trim(), visibility);
  if (composition) parts.push(`composition: ${composition}`);
  const notes = camera.notes.trim();
  if (notes) parts.push(`camera notes: ${notes}`);
  return `Camera: ${parts.join("; ")}.`;
}

function joinViewpoint(azimuth: string, elevation: string | null): string {
  if (!elevation) return azimuth;
  // "left-side viewpoint; the left facade is not shown" keeps the elevation on the view.
  const [view, ...rest] = azimuth.split("; ");
  return [`${view} ${elevation}`, ...rest].join("; ");
}

function guardComposition(
  composition: string | undefined,
  visibility: VisibilityResult | null | undefined,
): string | undefined {
  if (!composition || !visibility) return composition;
  const hidden = visibility.occludedFacades.filter((f) => f !== "front" && f !== "roof");
  if (!hidden.length) return composition;
  const promises =
    hidden.some((f) => FACADE_PROMISE[f]?.test(composition)) || TWO_FACADES.test(composition);
  if (!promises) return composition;
  const shown = visibility.visibleFacades.find((f) => f !== "roof");
  return shown ? `${shown} facade dominant` : undefined;
}

/** Fixed formatting: at most 1 decimal, '.' separator, no locale. */
function num(n: number): string {
  return String(Math.round(n * 10) / 10);
}
