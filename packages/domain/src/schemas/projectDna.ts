import { z } from "zod";
import { BuildingDNASchema } from "./building";
import { ContextDNASchema } from "./context";
import {
  CameraDNASchema,
  ColorGradeDNASchema,
  LightingDNASchema,
  MoodDNASchema,
  WeatherDNASchema,
} from "./future";
import { SceneSchema } from "../regions/schemas";

export const LockStateSchema = z.object({
  building: z.boolean().default(false),
  context: z.boolean().default(false),
  camera: z.boolean().default(false),
  lighting: z.boolean().default(false),
  weather: z.boolean().default(false),
  mood: z.boolean().default(false),
  colorGrade: z.boolean().default(false),
  objectIds: z.array(z.string()).default([]),
});
export type LockState = z.infer<typeof LockStateSchema>;

export const defaultLockState = (): LockState => ({
  building: false,
  context: false,
  camera: false,
  lighting: false,
  weather: false,
  mood: false,
  colorGrade: false,
  objectIds: [],
});

export const ProjectDNASchema = z.object({
  schemaVersion: z.literal(1),
  building: BuildingDNASchema,
  context: ContextDNASchema,
  cameras: z.array(CameraDNASchema).default([]),
  lighting: LightingDNASchema.optional(),
  weather: WeatherDNASchema.optional(),
  mood: MoodDNASchema.optional(),
  colorGrade: ColorGradeDNASchema.optional(),
  scene: SceneSchema.optional(),
  locks: LockStateSchema.default(defaultLockState),
});

/** Fully resolved (parsed) DNA — what is persisted and compiled. */
export type ProjectDNA = z.infer<typeof ProjectDNASchema>;
/** Loose input shape accepted before defaults are applied. */
export type ProjectDNAInput = z.input<typeof ProjectDNASchema>;

export const DNA_SCHEMA_VERSION = 1 as const;
