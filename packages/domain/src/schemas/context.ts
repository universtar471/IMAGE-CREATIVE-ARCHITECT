import { z } from "zod";
import { DensitySchema } from "./enums";

const optionalText = z.string().trim().min(1).optional();
const textList = z.array(z.string().trim().min(1)).default([]);

export const ContextZoneSchema = z.object({
  spaceType: optionalText,
  roadType: optionalText,
  elements: textList,
  vegetation: textList,
  adjacentBuildings: textList,
  notes: z.string().default(""),
});
export type ContextZone = z.infer<typeof ContextZoneSchema>;

export const CONTEXT_DIRECTIONS = ["front", "rear", "left", "right"] as const;
export type ContextDirection = (typeof CONTEXT_DIRECTIONS)[number];

export const emptyContextZone = (): ContextZone => ({
  elements: [],
  vegetation: [],
  adjacentBuildings: [],
  notes: "",
});

export const ContextDNASchema = z.object({
  schemaVersion: z.literal(1),
  macroContext: optionalText,
  climateContext: optionalText,
  density: DensitySchema.optional(),
  front: ContextZoneSchema.default(emptyContextZone),
  rear: ContextZoneSchema.default(emptyContextZone),
  left: ContextZoneSchema.default(emptyContextZone),
  right: ContextZoneSchema.default(emptyContextZone),
  distantBackground: textList,
  atmosphereNotes: z.string().default(""),
  negativeConstraints: textList,
});

export type ContextDNA = z.infer<typeof ContextDNASchema>;
