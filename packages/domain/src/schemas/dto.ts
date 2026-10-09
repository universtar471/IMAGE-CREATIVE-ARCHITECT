/**
 * Data transfer shapes crossing the desktop bridge (Tauri commands).
 * The Rust side serializes these in camelCase; the UI parses them with these schemas.
 */
import { z } from "zod";
import {
  AssetRoleSchema,
  AssetSourceSchema,
  AssetStatusSchema,
  ProjectStatusSchema,
  ProjectTypeSchema,
} from "./enums";
import { ProjectDNASchema } from "./projectDna";

export const ProjectDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectType: ProjectTypeSchema,
  subtype: z.string().nullable(),
  status: ProjectStatusSchema,
  activeMasterAssetId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type ProjectDTO = z.infer<typeof ProjectDTOSchema>;

export const ProjectSummaryDTOSchema = ProjectDTOSchema.extend({
  assetCount: z.number().int().nonnegative(),
  /** Absolute path of the master's small thumbnail, if one exists. Never the original. */
  thumbnailPath: z.string().nullable(),
});
export type ProjectSummaryDTO = z.infer<typeof ProjectSummaryDTOSchema>;

export const AssetDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  source: AssetSourceSchema,
  role: AssetRoleSchema,
  status: AssetStatusSchema,
  originalName: z.string().nullable(),
  managedRelPath: z.string(),
  /** Absolute path of the managed original (for the canvas of the selected asset only). */
  absolutePath: z.string(),
  /** Absolute path of the small thumbnail used by grids/trays. */
  thumbnailPath: z.string().nullable(),
  mimeType: z.string().nullable(),
  fileSizeBytes: z.number().int().nonnegative().nullable(),
  widthPx: z.number().int().positive().nullable(),
  heightPx: z.number().int().positive().nullable(),
  sha256: z.string().nullable(),
  parentAssetId: z.string().nullable(),
  operation: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetDTO = z.infer<typeof AssetDTOSchema>;

export const ProjectBundleDTOSchema = z.object({
  project: ProjectDTOSchema,
  dna: ProjectDNASchema,
  assets: z.array(AssetDTOSchema),
});
export type ProjectBundleDTO = z.infer<typeof ProjectBundleDTOSchema>;

export const AppErrorCodeSchema = z.enum([
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "IO_ERROR",
  "DB_ERROR",
  "CONFLICT",
  "UNSUPPORTED_FILE",
  "INVALID_STATE",
  "DUPLICATE_ASSET",
  "PROVIDER_NOT_CONFIGURED",
  /** A provider call made directly by a command failed; details `{ providerId, kind, retryable }`. */
  "PROVIDER_ERROR",
]);
export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>;

export const AppErrorSchema = z.object({
  code: AppErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type AppError = z.infer<typeof AppErrorSchema>;
