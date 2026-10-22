import { z } from "zod";
import { INTERIOR_STYLES, type InteriorStyleId } from "../interior/catalog";

export const GENERATION_GOAL_IDS = [
  "photorealistic",
  "redesign",
  "refine",
  "variations",
  "clean_space",
  "ambience",
] as const;
export const GENERATION_ROOM_IDS = [
  "living_room",
  "bedroom",
  "kitchen",
  "dining_room",
  "bathroom",
  "home_office",
  "kids_room",
  "lobby",
  "other",
] as const;
export const GENERATION_CAMERA_IDS = [
  "original",
  "eye_level",
  "diagonal",
  "front",
  "wide",
  "detail",
] as const;
export const GENERATION_LIGHT_IDS = [
  "natural",
  "soft_natural",
  "golden",
  "warm",
  "neutral",
  "night",
] as const;
export const PRESERVE_KEYS = [
  "layout",
  "camera",
  "architecture",
  "furniture",
  "materials",
] as const;
export const REFERENCE_ATTRIBUTES = ["style", "colors", "materials", "layout", "lighting"] as const;
export type PreserveKey = (typeof PRESERVE_KEYS)[number];
export type GenerationGoal = (typeof GENERATION_GOAL_IDS)[number];
export type GenerationRoom = (typeof GENERATION_ROOM_IDS)[number];
export type GenerationLight = (typeof GENERATION_LIGHT_IDS)[number];
export const PreserveSchema = z.object({
  layout: z.boolean(),
  camera: z.boolean(),
  architecture: z.boolean(),
  furniture: z.boolean(),
  materials: z.boolean(),
});
export const InteriorGenerationSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.literal("interior"),
  input: z.object({
    type: z.enum(["none", "render", "photo", "sketch"]),
    assetId: z.string().min(1).nullable(),
  }),
  goal: z.enum(GENERATION_GOAL_IDS),
  room: z.enum(GENERATION_ROOM_IDS),
  style: z
    .enum(INTERIOR_STYLES.map((s) => s.id) as [InteriorStyleId, ...InteriorStyleId[]])
    .nullable(),
  changeLevel: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  preserve: PreserveSchema,
  camera: z.object({ mode: z.enum(GENERATION_CAMERA_IDS) }),
  lighting: z.object({ preset: z.enum(GENERATION_LIGHT_IDS).nullable() }),
  reference: z
    .object({
      assetId: z.string().min(1),
      attributes: z.object({
        style: z.boolean(),
        colors: z.boolean(),
        materials: z.boolean(),
        layout: z.boolean(),
        lighting: z.boolean(),
      }),
    })
    .nullable(),
  instruction: z.string().max(4000),
  sourceAnalysis: z
    .object({
      roomType: z.string().max(150),
      geometry: z.string().max(1500),
      materials: z.array(z.string().max(200)).max(15),
      lighting: z.string().max(800),
    })
    .optional(),
});
export type InteriorGenerationState = z.infer<typeof InteriorGenerationSchema>;
export type GenerationInputImage = {
  assetId: string;
  type: Exclude<InteriorGenerationState["input"]["type"], "none">;
};
export type GenerationPreset<Id extends string = string> = {
  id: Id;
  label: { vi: string; en: string };
  description: { vi: string; en: string };
  icon: string;
  promptFragment: string;
  negativeFragment: string;
  defaults: Record<string, unknown>;
  constraints: readonly string[];
  conflicts: readonly string[];
  compatibleModes: readonly ("interior" | "architecture")[];
};

export const ALL_PRESERVE = {
  layout: true,
  camera: true,
  architecture: true,
  furniture: true,
  materials: true,
} as const;

export function initialInteriorGeneration(input?: GenerationInputImage): InteriorGenerationState {
  return {
    schemaVersion: 1,
    mode: "interior",
    input: input ? { ...input } : { type: "none", assetId: null },
    goal: "photorealistic",
    room: "living_room",
    style: null,
    changeLevel: 1,
    preserve: { ...ALL_PRESERVE },
    camera: { mode: "original" },
    lighting: { preset: null },
    reference: null,
    instruction: "",
  };
}
