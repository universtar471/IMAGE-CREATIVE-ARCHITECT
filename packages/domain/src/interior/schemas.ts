import { z } from "zod";
import {
  BUILDING_USES,
  CABINETRY_MATERIALS,
  CEILING_MATERIALS,
  COUNTERTOP_MATERIALS,
  FLOOR_MATERIALS,
  FURNITURE,
  INTERIOR_STYLES,
  MATERIAL_PRESETS,
  METAL_FINISHES,
  PALETTES,
  ROOMS,
  ROOM_IDS_BY_USE,
  TEXTILE_MATERIALS,
  WALL_MATERIALS,
  type BuildingUseId,
  type CabinetryMaterialId,
  type CeilingMaterialId,
  type CountertopMaterialId,
  type FloorMaterialId,
  type FurnitureId,
  type InteriorStyleId,
  type MaterialPresetId,
  type MetalFinishId,
  type PaletteId,
  type RoomId,
  type TextileMaterialId,
  type WallMaterialId,
} from "./catalog";

function optionEnum<T extends string>(values: readonly { id: T }[]) {
  return z.enum(values.map(({ id }) => id) as [T, ...T[]]);
}

export const BuildingUseIdSchema = optionEnum<BuildingUseId>(BUILDING_USES);
export const RoomIdSchema = optionEnum<RoomId>(ROOMS);
export const InteriorStyleIdSchema = optionEnum<InteriorStyleId>(INTERIOR_STYLES);
export const PaletteIdSchema = optionEnum<PaletteId>(PALETTES);
export const MaterialPresetIdSchema = optionEnum<MaterialPresetId>(MATERIAL_PRESETS);
export const FurnitureIdSchema = optionEnum<FurnitureId>(FURNITURE);

export const InteriorSurfacesSchema = z.object({
  floor: z.array(optionEnum<FloorMaterialId>(FLOOR_MATERIALS)).default([]),
  wall: z.array(optionEnum<WallMaterialId>(WALL_MATERIALS)).default([]),
  ceiling: z.array(optionEnum<CeilingMaterialId>(CEILING_MATERIALS)).default([]),
  cabinetry: z.array(optionEnum<CabinetryMaterialId>(CABINETRY_MATERIALS)).default([]),
  countertop: z.array(optionEnum<CountertopMaterialId>(COUNTERTOP_MATERIALS)).default([]),
  textile: z.array(optionEnum<TextileMaterialId>(TEXTILE_MATERIALS)).default([]),
  metal: z.array(optionEnum<MetalFinishId>(METAL_FINISHES)).default([]),
});

export const InteriorDNASchema = z
  .object({
    schemaVersion: z.literal(1),
    buildingUseId: BuildingUseIdSchema,
    roomId: RoomIdSchema,
    styleId: InteriorStyleIdSchema,
    paletteId: PaletteIdSchema.optional(),
    materialPresetId: MaterialPresetIdSchema.optional(),
    surfaces: InteriorSurfacesSchema.default({
      floor: [],
      wall: [],
      ceiling: [],
      cabinetry: [],
      countertop: [],
      textile: [],
      metal: [],
    }),
    daylightDirection: z.enum(["front", "left", "right", "rear", "diffuse", "none"]).optional(),
    daylightAmount: z.enum(["low", "medium", "high"]).optional(),
    timeOfDay: z
      .enum(["morning", "midday", "afternoon", "golden_hour", "evening", "night"])
      .optional(),
    artificialScenes: z
      .array(z.enum(["ambient", "task", "accent", "cove", "pendant", "downlight"]))
      .default([]),
    colorTemperatureK: z
      .union([z.literal(2700), z.literal(3000), z.literal(3500), z.literal(4000)])
      .optional(),
    furnitureIds: z.array(FurnitureIdSchema).default([]),
    furnishingDensity: z.enum(["minimal", "balanced", "layered"]).default("balanced"),
    cameraPresetId: z.enum(["wide_entrance", "corner", "one_point", "detail"]).optional(),
    areaM2: z.number().finite().positive().optional(),
    ceilingHeightM: z.number().finite().positive().optional(),
  })
  .superRefine((interior, ctx) => {
    if (!ROOM_IDS_BY_USE[interior.buildingUseId].includes(interior.roomId)) {
      ctx.addIssue({
        code: "custom",
        path: ["roomId"],
        message: "Room is not valid for the selected building use.",
      });
    }
  });

export type InteriorDNA = z.infer<typeof InteriorDNASchema>;
export type InteriorDNAInput = z.input<typeof InteriorDNASchema>;
