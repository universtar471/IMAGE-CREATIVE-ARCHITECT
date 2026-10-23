/** One pose source: workflow state references Camera DNA by stable ID, never copies it. */
import type { CameraDNA } from "../schemas/future";

export const INTERIOR_CAMERA_POSES = {
  front: { azimuthDeg: 0, elevationDeg: 0, distanceM: 4 },
  wide: { azimuthDeg: 0, elevationDeg: 0, distanceM: 5 },
  diagonal: { azimuthDeg: 35, elevationDeg: 0, distanceM: 4 },
  eye_level: { azimuthDeg: 0, elevationDeg: 0, distanceM: 3 },
  detail: { azimuthDeg: 20, elevationDeg: -10, distanceM: 1.5 },
} as const;
export const INTERIOR_CAMERA_LENSES = {
  front: 28,
  wide: 20,
  diagonal: 28,
  eye_level: 28,
  detail: 50,
} as const;
export type InteriorPoseMode = keyof typeof INTERIOR_CAMERA_POSES;

export function cameraFromInteriorMode(camera: CameraDNA, mode: InteriorPoseMode): CameraDNA {
  const next = {
    ...camera,
    ...INTERIOR_CAMERA_POSES[mode],
    viewType: mode === "detail" ? ("interior_detail" as const) : ("interior_wide" as const),
    lensMm: INTERIOR_CAMERA_LENSES[mode],
  };
  // Old preset instructions must not contradict the newly selected viewpoint.
  delete next.presetId;
  delete next.composition;
  return next;
}

const POSE_FIELDS = [
  "azimuthDeg",
  "elevationDeg",
  "distanceM",
  "heightM",
  "lensMm",
  "viewType",
  "targetObjectId",
  "composition",
] as const;
export function sameCameraPose(a: CameraDNA, b: CameraDNA): boolean {
  return POSE_FIELDS.every((key) => a[key] === b[key]);
}

/** Use room-local directions; a room has no exterior front/side facade. */
export function interiorStudioCameraText(camera: CameraDNA): string {
  const fields = [
    camera.viewType === "interior_detail"
      ? "Close-up of an existing furniture or finish detail"
      : "Interior room view",
    camera.azimuthDeg === undefined
      ? null
      : `room-local azimuth ${camera.azimuthDeg} degrees, clockwise positive around the room target (0 is the room reference direction)`,
    camera.elevationDeg === undefined
      ? null
      : `elevation ${camera.elevationDeg} degrees (positive looks down, negative looks up)`,
    camera.distanceM === undefined ? null : `distance ${camera.distanceM} m from the room target`,
    camera.heightM === undefined ? null : `camera height ${camera.heightM} m`,
    camera.lensMm === undefined ? null : `${camera.lensMm} mm lens`,
    camera.composition?.trim(),
    "Use the specified Camera DNA viewpoint instead of copying the source framing; keep the same room and existing design within the other locks. Coordinates are estimated unless calibrated geometry is available; do not invent unseen structural facts",
  ];
  return fields.filter(Boolean).join("; ") + ".";
}
