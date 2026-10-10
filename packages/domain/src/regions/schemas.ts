import { z } from "zod";

const normalized = z.number().finite().min(0).max(1);
const ulid = "[0-7][0-9A-HJKMNP-TV-Z]{25}";
const regionId = z.string().regex(new RegExp(`^RGN_${ulid}$`));
const objectId = z.string().regex(new RegExp(`^OBJ_${ulid}$`));
const point = z.tuple([normalized, normalized]);

export const RectShapeSchema = z
  .object({
    type: z.literal("rect"),
    x: normalized,
    y: normalized,
    w: normalized,
    h: normalized,
  })
  .refine(
    (shape) => shape.w > 0 && shape.h > 0 && shape.x + shape.w <= 1 && shape.y + shape.h <= 1,
    "Rectangle must stay inside the image.",
  );

export const PolygonShapeSchema = z.object({
  type: z.literal("polygon"),
  points: z.array(point).min(3),
});
export const BrushStrokeSchema = z.object({
  points: z.array(point).min(1),
  radius: z.number().finite().gt(0).max(1),
});
export const BrushShapeSchema = z.object({
  type: z.literal("brush"),
  strokes: z.array(BrushStrokeSchema),
});
export const RegionShapeSchema = z.union([RectShapeSchema, PolygonShapeSchema, BrushShapeSchema]);
export type RegionShape = z.infer<typeof RegionShapeSchema>;

export const RegionKindSchema = z.enum(["object", "zone", "material"]);
export type RegionKind = z.infer<typeof RegionKindSchema>;

export const RegionDTOSchema = z.object({
  id: regionId,
  projectId: z.string(),
  assetId: z.string(),
  label: z.string().trim().min(1),
  kind: RegionKindSchema,
  objectId: objectId.nullable(),
  shape: RegionShapeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RegionDTO = z.infer<typeof RegionDTOSchema>;

export const SceneObjectCategorySchema = z.enum([
  "wall",
  "roof",
  "window",
  "door",
  "floor",
  "landscape",
  "furniture",
  "sky",
  "other",
]);
export type SceneObjectCategory = z.infer<typeof SceneObjectCategorySchema>;

export const SceneObjectRelationSchema = z.object({
  type: z.enum(["on", "next_to", "inside", "above", "below"]),
  targetId: objectId,
});

export const SceneObjectSchema = z.object({
  id: objectId,
  name: z.string().trim().min(1),
  category: SceneObjectCategorySchema,
  material: z.string().trim().min(1).optional(),
  relations: z.array(SceneObjectRelationSchema),
});
export type SceneObject = z.infer<typeof SceneObjectSchema>;

export const SceneSchema = z.object({
  schemaVersion: z.literal(1),
  objects: z.array(SceneObjectSchema),
});
export type Scene = z.infer<typeof SceneSchema>;

export const RegionEditParamsSchema = z
  .object({
    regionIds: z.array(regionId).min(1),
    instruction: z.string(),
    mode: z.enum(["edit", "material_replace"]),
    material: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.regionIds).size !== value.regionIds.length) {
      ctx.addIssue({ code: "custom", path: ["regionIds"], message: "regionIds must be unique." });
    }
    if (value.mode === "edit" && value.instruction.trim() === "") {
      ctx.addIssue({
        code: "custom",
        path: ["instruction"],
        message: "Instruction is required in edit mode.",
      });
    }
    if (value.mode === "material_replace" && !value.material) {
      ctx.addIssue({
        code: "custom",
        path: ["material"],
        message: "Material is required in material_replace mode.",
      });
    }
  });
export type RegionEditParams = z.infer<typeof RegionEditParamsSchema>;

export const RegionListRequestSchema = z.object({ projectId: z.string(), assetId: z.string() });
export type RegionListRequest = z.infer<typeof RegionListRequestSchema>;

export const RegionSaveRequestSchema = z.object({
  projectId: z.string(),
  assetId: z.string(),
  region: z.object({
    id: regionId.optional(),
    label: z.string().trim().min(1),
    kind: RegionKindSchema,
    objectId: objectId.nullable(),
    shape: RegionShapeSchema,
  }),
});
export type RegionSaveRequest = z.infer<typeof RegionSaveRequestSchema>;

export const RegionDeleteRequestSchema = z.object({ projectId: z.string(), regionId });
export type RegionDeleteRequest = z.infer<typeof RegionDeleteRequestSchema>;
