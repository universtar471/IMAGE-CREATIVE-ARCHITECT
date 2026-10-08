/**
 * Deterministic wording for a camera (the compiler's "camera" section, also usable as UI
 * captions). Angle convention (CameraDNASchema): azimuth 0 = looking straight at the front
 * facade; positive = orbiting clockwise seen from above with the front facade at the bottom
 * of the plan, i.e. toward the viewer's LEFT when facing the front. So +45 is the front-left
 * three-quarter view, -45 front-right, ±90 the left/right side, ±180 the rear.
 */
import type { CameraDNA, CameraViewType } from "../schemas/future";

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

/** The compiler's camera section text. */
export function cameraSectionText(camera: CameraDNA): string {
  const parts: string[] = [VIEW_TYPE_WORDS[camera.viewType]];
  const viewpoint = viewpointWords(camera);
  if (viewpoint) parts.push(`viewpoint: ${viewpoint}`);
  if (camera.lensMm !== undefined) parts.push(`lens: ${lensWords(camera.lensMm)}`);
  if (camera.distanceM !== undefined) {
    const target = isInteriorViewType(camera.viewType) ? "the subject" : "the building";
    parts.push(`distance: about ${num(camera.distanceM)} m from ${target}`);
  }
  const composition = camera.composition?.trim();
  if (composition) parts.push(`composition: ${composition}`);
  const notes = camera.notes.trim();
  if (notes) parts.push(`camera notes: ${notes}`);
  return `Camera: ${parts.join("; ")}.`;
}

/** Fixed formatting: at most 1 decimal, '.' separator, no locale. */
function num(n: number): string {
  return String(Math.round(n * 10) / 10);
}
