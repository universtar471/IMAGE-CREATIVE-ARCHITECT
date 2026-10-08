import { z } from "zod";

const optionalText = z.string().trim().min(1).optional();
const positiveMetres = z.number().finite().positive().max(10_000).optional();

export const BuildingDimensionsSchema = z.object({
  widthM: positiveMetres,
  depthM: positiveMetres,
  heightM: positiveMetres,
  siteWidthM: positiveMetres,
  siteDepthM: positiveMetres,
});

export const MassingSchema = z.object({
  composition: optionalText,
  mainVolume: optionalText,
  secondaryVolume: optionalText,
  voids: z.array(z.string().trim().min(1)).default([]),
  cantilever: optionalText,
});

export const RoofSchema = z.object({
  type: optionalText,
  pitch: optionalText,
  overhang: optionalText,
});

export const OpeningsSchema = z.object({
  windowType: optionalText,
  frame: optionalText,
  rhythm: optionalText,
  glazing: optionalText,
});

export const MaterialEntrySchema = z.object({
  zone: z.string().trim().min(1, "Zone is required"),
  materialId: z.string().optional(),
  description: z.string().trim().min(1, "Description is required"),
});

export const BuildingDNASchema = z.object({
  schemaVersion: z.literal(1),
  buildingType: z.string().trim().min(1),
  subtype: optionalText,
  architecturalStyle: optionalText,
  dimensions: BuildingDimensionsSchema.default({}),
  floors: z.number().int().positive().max(200).optional(),
  massing: MassingSchema.default({ voids: [] }),
  roof: RoofSchema.default({}),
  openings: OpeningsSchema.default({}),
  materials: z.array(MaterialEntrySchema).default([]),
  colorPalette: z.array(z.string().trim().min(1)).default([]),
  specialFeatures: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().default(""),
});

export type BuildingDNA = z.infer<typeof BuildingDNASchema>;
export type MaterialEntry = z.infer<typeof MaterialEntrySchema>;
