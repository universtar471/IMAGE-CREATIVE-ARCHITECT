/**
 * Camera Director plan geometry (pure). Plan coordinates are metres with the building
 * footprint centred on the origin, x to the right and y DOWN (SVG convention); the front
 * facade faces +y (the bottom of the diagram).
 *
 * CameraDNA convention (packages/domain future.ts): azimuth 0 = looking straight at the
 * front; positive = orbiting clockwise seen from above. On the diagram, clockwise from the
 * bottom goes towards the left, so azimuth +90° sits on the left side of the plan.
 * `distanceM` is measured from the footprint centre to the camera.
 */
import type { CameraDNA, ProjectDNA } from "@arch/domain";

export type Footprint = { widthM: number; depthM: number; fromDna: boolean };
export type PlanPoint = { x: number; y: number };

export const DEFAULT_FOOTPRINT = { widthM: 12, depthM: 10 } as const;
/** Full-frame sensor width; lens focal length → horizontal field of view. */
const SENSOR_WIDTH_MM = 36;
export const DEFAULT_LENS_MM = 28;

export function footprintOf(dna: Pick<ProjectDNA, "building">): Footprint {
  const d = dna.building.dimensions;
  const ok = (n: number | undefined): n is number => typeof n === "number" && n > 0;
  return {
    widthM: ok(d.widthM) ? d.widthM : DEFAULT_FOOTPRINT.widthM,
    depthM: ok(d.depthM) ? d.depthM : DEFAULT_FOOTPRINT.depthM,
    fromDna: ok(d.widthM) && ok(d.depthM),
  };
}

/** Into (-180, 180]. */
export function normalizeAzimuth(deg: number): number {
  const a = (((deg % 360) + 360) % 360) as number;
  return a > 180 ? a - 360 : a;
}

const RAD = Math.PI / 180;

export function cameraToPlan(azimuthDeg: number, distanceM: number): PlanPoint {
  const a = azimuthDeg * RAD;
  // `+ 0` turns -0 into 0 so positions compare cleanly.
  return { x: -distanceM * Math.sin(a) + 0, y: distanceM * Math.cos(a) + 0 };
}

export function planToCamera(p: PlanPoint): { azimuthDeg: number; distanceM: number } {
  return {
    azimuthDeg: normalizeAzimuth(Math.atan2(-p.x, p.y) / RAD),
    distanceM: Math.hypot(p.x, p.y),
  };
}

/** Distance used to draw a camera whose distance is not set yet. */
export function defaultDistance(fp: Footprint): number {
  return Math.round(Math.max(fp.widthM, fp.depthM) * 1.8);
}

export type CameraPlacement = PlanPoint & {
  azimuthDeg: number;
  distanceM: number;
  /** False when azimuth or distance is not set (drawn dashed at a default spot). */
  placed: boolean;
};

export function cameraPlacement(camera: CameraDNA, fp: Footprint): CameraPlacement {
  const azimuthDeg = camera.azimuthDeg ?? 0;
  const distanceM = camera.distanceM ?? defaultDistance(fp);
  return {
    ...cameraToPlan(azimuthDeg, distanceM),
    azimuthDeg,
    distanceM,
    placed: camera.azimuthDeg !== undefined && camera.distanceM !== undefined,
  };
}

export function horizontalFovDeg(lensMm = DEFAULT_LENS_MM): number {
  return (2 * Math.atan(SENSOR_WIDTH_MM / (2 * lensMm))) / RAD;
}

/** Triangle from the camera towards the footprint centre (it always looks at the building). */
export function viewCone(pos: PlanPoint, fovDeg: number, length: number): PlanPoint[] {
  const heading = Math.atan2(-pos.y, -pos.x);
  const half = (Math.min(fovDeg, 170) / 2) * RAD;
  return [
    pos,
    { x: pos.x + length * Math.cos(heading - half), y: pos.y + length * Math.sin(heading - half) },
    { x: pos.x + length * Math.cos(heading + half), y: pos.y + length * Math.sin(heading + half) },
  ];
}

/** Half-size of the square plan view so every camera and the footprint fit with margin. */
export function planHalfExtent(placements: readonly PlanPoint[], fp: Footprint): number {
  const far = placements.reduce((m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.y)), 0);
  return Math.max(far * 1.18 + 2, Math.max(fp.widthM, fp.depthM) * 1.3);
}

/** What a drag stores: whole degrees, half metres, at least 1 m away. */
export function snapPosition(p: PlanPoint): { azimuthDeg: number; distanceM: number } {
  const { azimuthDeg, distanceM } = planToCamera(p);
  return {
    azimuthDeg: Math.round(azimuthDeg),
    distanceM: Math.max(1, Math.round(distanceM * 2) / 2),
  };
}

/** Keyboard nudge: ←/→ orbit (5°, Shift 1°), ↑/↓ move away/closer (1 m, Shift 0.5 m). */
export function nudge(
  current: { azimuthDeg: number; distanceM: number },
  key: string,
  fine: boolean,
): { azimuthDeg: number; distanceM: number } | null {
  const step = fine ? 1 : 5;
  const dStep = fine ? 0.5 : 1;
  switch (key) {
    case "ArrowLeft":
      // Clockwise from above = towards the left of the diagram for a camera at the front.
      return { ...current, azimuthDeg: normalizeAzimuth(current.azimuthDeg + step) };
    case "ArrowRight":
      return { ...current, azimuthDeg: normalizeAzimuth(current.azimuthDeg - step) };
    case "ArrowUp":
      return { ...current, distanceM: current.distanceM + dStep };
    case "ArrowDown":
      return { ...current, distanceM: Math.max(1, current.distanceM - dStep) };
    default:
      return null;
  }
}
