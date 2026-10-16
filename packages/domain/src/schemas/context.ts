import { z } from "zod";
import { DensitySchema } from "./enums";

const optionalText = z.string().trim().min(1).optional();
const textList = z.array(z.string().trim().min(1)).default([]);

export const SideTopologySchema = z.enum(["attached", "open", "unknown"]);
export type SideTopology = z.infer<typeof SideTopologySchema>;

export const SiteTopologySchema = z
  .object({
    left: SideTopologySchema.default("unknown"),
    right: SideTopologySchema.default("unknown"),
    cornerLot: z.boolean().default(false),
    cornerSide: z.enum(["left", "right"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.cornerLot && !value.cornerSide) {
      ctx.addIssue({
        code: "custom",
        path: ["cornerSide"],
        message: "cornerSide is required for a corner lot.",
      });
    }
    if (value.cornerLot && value.cornerSide && value[value.cornerSide] === "attached") {
      ctx.addIssue({
        code: "custom",
        path: ["cornerSide"],
        message: "cornerSide must not be attached.",
      });
    }
  });
export type SiteTopology = z.infer<typeof SiteTopologySchema>;

export const ContextLibrarySelectionSchema = z.object({
  version: z.literal(1),
  presetId: z.string().trim().min(1),
  regionId: z.string().trim().min(1),
  approvedOptional: z.array(z.string().trim().min(1)).default([]),
});
export type ContextLibrarySelection = z.infer<typeof ContextLibrarySelectionSchema>;

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
  siteTopology: SiteTopologySchema.optional(),
  library: ContextLibrarySelectionSchema.optional(),
  distantBackground: textList,
  atmosphereNotes: z.string().default(""),
  negativeConstraints: textList,
});

export type ContextDNA = z.infer<typeof ContextDNASchema>;
