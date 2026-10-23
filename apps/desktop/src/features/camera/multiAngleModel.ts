/**
 * Multi-Angle M1: pure, provider-neutral camera controls.
 * Camera azimuth convention matches existing CameraDNA:
 * 0 = looking directly at the front facade, clockwise positive seen from above.
 * No network calls, no side effects, no AI approximation is presented as geometry truth.
 */
import {
  isInteriorShot,
  INTERIOR_CAMERA_POSES,
  INTERIOR_CAMERA_LENSES,
  type ProjectDNA,
} from "@arch/domain";

export type CameraScope = "building" | "interior";
export type CameraPresetId =
  | "front"
  | "front_left"
  | "front_right"
  | "aerial"
  | "wide_room"
  | "room_corner"
  | "eye_level"
  | "detail_focus";

export type CameraPose = Readonly<{
  azimuthDeg: number;
  elevationDeg: number;
  distanceM: number;
}>;

export type CameraPreset = Readonly<{
  id: CameraPresetId;
  scope: CameraScope;
  pose: CameraPose;
  lensMm?: number;
  icon: "building" | "corner" | "aerial" | "room" | "eye" | "detail";
}>;

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  {
    id: "front",
    scope: "building",
    pose: { azimuthDeg: 0, elevationDeg: 5, distanceM: 15 },
    icon: "building",
  },
  {
    id: "front_left",
    scope: "building",
    pose: { azimuthDeg: 45, elevationDeg: 12, distanceM: 18 },
    icon: "corner",
  },
  {
    id: "front_right",
    scope: "building",
    pose: { azimuthDeg: -45, elevationDeg: 12, distanceM: 18 },
    icon: "corner",
  },
  {
    id: "aerial",
    scope: "building",
    pose: { azimuthDeg: 35, elevationDeg: 55, distanceM: 28 },
    icon: "aerial",
  },
  {
    id: "wide_room",
    scope: "interior",
    pose: INTERIOR_CAMERA_POSES.wide,
    lensMm: INTERIOR_CAMERA_LENSES.wide,
    icon: "room",
  },
  {
    id: "room_corner",
    scope: "interior",
    pose: INTERIOR_CAMERA_POSES.diagonal,
    lensMm: INTERIOR_CAMERA_LENSES.diagonal,
    icon: "corner",
  },
  {
    id: "eye_level",
    scope: "interior",
    pose: INTERIOR_CAMERA_POSES.eye_level,
    lensMm: INTERIOR_CAMERA_LENSES.eye_level,
    icon: "eye",
  },
  {
    id: "detail_focus",
    scope: "interior",
    pose: INTERIOR_CAMERA_POSES.detail,
    lensMm: INTERIOR_CAMERA_LENSES.detail,
    icon: "detail",
  },
];

export const DEFAULT_POSE: Readonly<Record<CameraScope, CameraPose>> = {
  building: CAMERA_PRESETS[0]!.pose,
  interior: CAMERA_PRESETS[4]!.pose,
};

export function cameraScopeFromDna(
  dna: Pick<ProjectDNA, "interior" | "spaceCatalog">,
): CameraScope {
  return isInteriorShot(dna) ? "interior" : "building";
}

export function cameraPresetsFor(scope: CameraScope): readonly CameraPreset[] {
  return CAMERA_PRESETS.filter((preset) => preset.scope === scope);
}

export function normalizeAzimuth(degrees: number): number {
  if (!Number.isFinite(degrees)) return 0;
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function safeFinite(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

export function normalizeCameraPose(pose: Partial<CameraPose>, scope: CameraScope): CameraPose {
  const fallback = DEFAULT_POSE[scope];
  const elevation = safeFinite(pose.elevationDeg, fallback.elevationDeg);
  const distance = safeFinite(pose.distanceM, fallback.distanceM);
  return {
    azimuthDeg: normalizeAzimuth(safeFinite(pose.azimuthDeg, fallback.azimuthDeg)),
    elevationDeg: Math.max(-75, Math.min(75, elevation)),
    // CameraDNA requires strictly positive distance. No 0/NaN/Infinity saved.
    distanceM: Math.max(0.5, Math.min(1000, distance)),
  };
}

export function cameraPosition(pose: CameraPose): { x: number; y: number; z: number } {
  const azimuth = (pose.azimuthDeg * Math.PI) / 180;
  const elevation = (pose.elevationDeg * Math.PI) / 180;
  const horizontal = pose.distanceM * Math.cos(elevation);
  return {
    x: -horizontal * Math.sin(azimuth),
    y: horizontal * Math.cos(azimuth),
    z: pose.distanceM * Math.sin(elevation),
  };
}

export function samePose(a: CameraPose, b: CameraPose): boolean {
  return (
    a.azimuthDeg === b.azimuthDeg &&
    a.elevationDeg === b.elevationDeg &&
    a.distanceM === b.distanceM
  );
}
