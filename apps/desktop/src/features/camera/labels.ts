import type { CameraViewType, ProjectStatus } from "@arch/domain";

export const VIEW_TYPE_LABELS: Record<CameraViewType, string> = {
  exterior_front: "Exterior — front",
  exterior_corner: "Exterior — corner",
  exterior_side: "Exterior — side",
  exterior_rear: "Exterior — rear",
  aerial: "Aerial",
  street_level: "Street level",
  detail: "Detail",
  interior_wide: "Interior — wide",
  interior_detail: "Interior — detail",
  custom: "Custom",
};

/** Ratios offered in the camera editor (providers adapt when they do not offer one). */
export const CAMERA_ASPECT_RATIOS = [
  "16:9",
  "3:2",
  "4:3",
  "1:1",
  "4:5",
  "3:4",
  "2:3",
  "9:16",
  "21:9",
];

/** Statuses at or after master approval (the master is approved in all of them). */
const MASTER_APPROVED_STATUSES: readonly ProjectStatus[] = [
  "master_approved",
  "anchor_generation",
  "design_locked",
  "production",
  "qc",
  "final",
];
export const isMasterApproved = (s: ProjectStatus) => MASTER_APPROVED_STATUSES.includes(s);
