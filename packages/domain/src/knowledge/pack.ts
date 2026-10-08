/**
 * Knowledge Packs are read-only configuration bundles (JSON data, never code).
 * They contribute defaults and suggestions; saved projects persist the resolved DNA,
 * so a project never depends on a pack staying unchanged.
 */
import { z } from "zod";
import { DensitySchema, ProjectTypeSchema } from "../schemas/enums";
import { CameraViewTypeSchema } from "../schemas/future";

const textList = z.array(z.string().trim().min(1)).default([]);

const ZonePartialSchema = z.object({
  spaceType: z.string().optional(),
  roadType: z.string().optional(),
  elements: z.array(z.string()).optional(),
  vegetation: z.array(z.string()).optional(),
  adjacentBuildings: z.array(z.string()).optional(),
  notes: z.string().optional(),
});

export const ContextPartialSchema = z.object({
  macroContext: z.string().optional(),
  climateContext: z.string().optional(),
  density: DensitySchema.optional(),
  front: ZonePartialSchema.optional(),
  rear: ZonePartialSchema.optional(),
  left: ZonePartialSchema.optional(),
  right: ZonePartialSchema.optional(),
  distantBackground: z.array(z.string()).optional(),
  atmosphereNotes: z.string().optional(),
  negativeConstraints: z.array(z.string()).optional(),
});
export type ContextPartial = z.infer<typeof ContextPartialSchema>;

export const BuildingPartialSchema = z.object({
  buildingType: z.string().optional(),
  architecturalStyle: z.string().optional(),
  floors: z.number().int().positive().optional(),
  dimensions: z
    .object({
      widthM: z.number().positive().optional(),
      depthM: z.number().positive().optional(),
      heightM: z.number().positive().optional(),
      siteWidthM: z.number().positive().optional(),
      siteDepthM: z.number().positive().optional(),
    })
    .optional(),
  massing: z
    .object({
      composition: z.string().optional(),
      mainVolume: z.string().optional(),
      secondaryVolume: z.string().optional(),
      voids: z.array(z.string()).optional(),
      cantilever: z.string().optional(),
    })
    .optional(),
  roof: z
    .object({
      type: z.string().optional(),
      pitch: z.string().optional(),
      overhang: z.string().optional(),
    })
    .optional(),
  openings: z
    .object({
      windowType: z.string().optional(),
      frame: z.string().optional(),
      rhythm: z.string().optional(),
      glazing: z.string().optional(),
    })
    .optional(),
  materials: z.array(z.object({ zone: z.string(), description: z.string() })).optional(),
  colorPalette: z.array(z.string()).optional(),
  specialFeatures: z.array(z.string()).optional(),
});
export type BuildingPartial = z.infer<typeof BuildingPartialSchema>;

export const ContextPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  context: ContextPartialSchema,
});
export type ContextPreset = z.infer<typeof ContextPresetSchema>;

/** A suggested viewpoint; the Camera module turns it into a CameraDNA with a fresh id. */
export const CameraPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  viewType: CameraViewTypeSchema,
  azimuthDeg: z.number().min(-360).max(360).optional(),
  elevationDeg: z.number().min(-90).max(90).optional(),
  heightM: z.number().positive().optional(),
  distanceM: z.number().positive().optional(),
  lensMm: z.number().positive().optional(),
  aspectRatio: z.string().optional(),
  composition: z.string().optional(),
  /** Suggested as an anchor view when the camera set is first created. */
  anchorRecommended: z.boolean().default(false),
});
export type CameraPreset = z.infer<typeof CameraPresetSchema>;

export const KnowledgePackSchema = z.object({
  packVersion: z.string().min(1),
  projectType: ProjectTypeSchema,
  subtype: z.string().min(1),
  label: z.string().min(1),
  description: z.string().default(""),
  defaults: z
    .object({
      building: BuildingPartialSchema.default({}),
      context: ContextPartialSchema.default({}),
    })
    .default({ building: {}, context: {} }),
  styleSuggestions: textList,
  contextPresets: z.array(ContextPresetSchema).default([]),
  cameraPresets: z.array(CameraPresetSchema).default([]),
  negativeConstraints: textList,
  /** Vocabulary the prompt compiler may use for this type (e.g. "street-facing facade"). */
  promptVocabulary: z
    .object({
      subjectNoun: z.string().optional(),
      framing: z.string().optional(),
    })
    .default({}),
});
export type KnowledgePack = z.infer<typeof KnowledgePackSchema>;

export const DEFAULT_SUBTYPE = "default";
