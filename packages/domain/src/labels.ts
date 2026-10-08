import type { AssetRole, AssetSource, Density, ProjectStatus, ProjectType } from "./schemas/enums";
import type { CameraViewType } from "./schemas/future";

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  interior: "Interior",
  townhouse: "Townhouse",
  single_storey_house: "Single-storey house",
  villa: "Villa",
  urban_villa: "Urban villa",
  prefab_modular: "Prefab / modular",
  cafe: "Cafe",
  restaurant: "Restaurant",
  hotel: "Hotel",
  office: "Office",
  commercial: "Commercial",
  resort: "Resort",
  custom: "Custom",
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  dna_ready: "DNA ready",
  concepting: "Concepting",
  master_pending: "Master pending",
  master_approved: "Master approved",
  anchor_generation: "Anchor generation",
  design_locked: "Design locked",
  production: "Production",
  qc: "QC",
  final: "Final",
  archived: "Archived",
};

export const ASSET_ROLE_LABELS: Record<AssetRole, string> = {
  master_architecture: "Master architecture",
  architecture_reference: "Architecture reference",
  material_reference: "Material reference",
  context_reference: "Context reference",
  landscape_reference: "Landscape reference",
  lighting_reference: "Lighting reference",
  mood_reference: "Mood reference",
  camera_reference: "Camera reference",
  regular_image: "Regular image",
};

export const ASSET_SOURCE_LABELS: Record<AssetSource, string> = {
  external: "External",
  ai_generated: "AI generated",
  sketchup: "SketchUp",
  vray: "V-Ray",
  corona: "Corona",
  d5: "D5 Render",
  enscape: "Enscape",
  photo: "Photo",
  reference: "Reference",
  other: "Other",
};

export const DENSITY_LABELS: Record<Density, string> = {
  very_low: "Very low",
  low: "Low",
  medium: "Medium",
  high: "High",
  very_high: "Very high",
};

export const CAMERA_VIEW_TYPE_LABELS: Record<CameraViewType, string> = {
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
