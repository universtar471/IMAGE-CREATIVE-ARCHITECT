import { z } from "zod";

export const ProjectTypeSchema = z.enum([
  "interior",
  "townhouse",
  "single_storey_house",
  "villa",
  "urban_villa",
  "prefab_modular",
  "cafe",
  "restaurant",
  "hotel",
  "office",
  "commercial",
  "resort",
  "custom",
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

export const ProjectStatusSchema = z.enum([
  "draft",
  "dna_ready",
  "concepting",
  "master_pending",
  "master_approved",
  "anchor_generation",
  "design_locked",
  "production",
  "qc",
  "final",
  "archived",
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

/** Statuses the Phase 1 workflow can actually reach. */
export const PHASE1_STATUSES: readonly ProjectStatus[] = [
  "draft",
  "dna_ready",
  "master_pending",
  "master_approved",
  "archived",
];

export const AssetRoleSchema = z.enum([
  "master_architecture",
  "structure_sketch",
  "architecture_reference",
  "material_reference",
  "context_reference",
  "landscape_reference",
  "lighting_reference",
  "mood_reference",
  "camera_reference",
  "regular_image",
]);
export type AssetRole = z.infer<typeof AssetRoleSchema>;

export const AssetSourceSchema = z.enum([
  "external",
  "ai_generated",
  "sketchup",
  "vray",
  "corona",
  "d5",
  "enscape",
  "photo",
  "reference",
  "other",
]);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const AssetStatusSchema = z.enum(["ready", "missing_file"]);
export type AssetStatus = z.infer<typeof AssetStatusSchema>;

export const DensitySchema = z.enum(["very_low", "low", "medium", "high", "very_high"]);
export type Density = z.infer<typeof DensitySchema>;

/** Supported Phase 1 import formats. */
export const SUPPORTED_IMPORT_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const SUPPORTED_IMPORT_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
