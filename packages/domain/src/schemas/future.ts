/**
 * DNA schemas for future modules (Camera, Lighting, Weather, Mood, Color Grade).
 * Defined now so the aggregate is stable; Phase 1 UI does not edit them.
 */
import { z } from "zod";

/** What a camera looks at; drives presets, prompt wording and the Camera Director diagram. */
export const CameraViewTypeSchema = z.enum([
  "exterior_front",
  "exterior_corner",
  "exterior_side",
  "exterior_rear",
  "aerial",
  "street_level",
  "detail",
  "interior_wide",
  "interior_detail",
  "custom",
]);
export type CameraViewType = z.infer<typeof CameraViewTypeSchema>;

/**
 * One planned viewpoint (Phase 3, ADR-016). Lives inside the DNA aggregate and is edited by
 * the Camera module. Angles are relative to the building's front facade:
 * azimuth 0 = looking straight at the front, positive = orbiting clockwise seen from above.
 */
export const CameraDNASchema = z.object({
  schemaVersion: z.literal(1),
  /** `CAM_<ULID>` (a 128-bit ULID starts with 0-7), made by the UI on creation; never reused. */
  id: z.string().regex(/^CAM_[0-7][0-9A-HJKMNP-TV-Z]{25}$/),
  name: z.string().trim().min(1),
  viewType: CameraViewTypeSchema.default("custom"),
  /** Knowledge-pack preset this camera was created from (informational). */
  presetId: z.string().optional(),
  /** Anchor views get an approved anchor image before production renders (ADR-016). */
  isAnchorView: z.boolean().default(false),
  azimuthDeg: z.number().min(-360).max(360).optional(),
  elevationDeg: z.number().min(-90).max(90).optional(),
  heightM: z.number().positive().optional(),
  distanceM: z.number().positive().optional(),
  lensMm: z.number().positive().optional(),
  /** e.g. "16:9"; when set, generation for this camera defaults to it. */
  aspectRatio: z.string().optional(),
  targetObjectId: z.string().optional(),
  composition: z.string().optional(),
  notes: z.string().default(""),
});
export type CameraDNA = z.infer<typeof CameraDNASchema>;

export const LightingDNASchema = z.object({
  schemaVersion: z.literal(1),
  timeOfDay: z.string().optional(),
  sunDirection: z.string().optional(),
  sunElevation: z.string().optional(),
  intensity: z.string().optional(),
  shadowLength: z.string().optional(),
  shadowSoftness: z.string().optional(),
  ambientLight: z.string().optional(),
  artificialLighting: z
    .array(
      z.object({
        type: z.string(),
        temperatureK: z.number().int().positive().optional(),
        intensity: z.string().optional(),
        zone: z.string().optional(),
      }),
    )
    .default([]),
});
export type LightingDNA = z.infer<typeof LightingDNASchema>;

export const WeatherDNASchema = z.object({
  schemaVersion: z.literal(1),
  preset: z.string().optional(),
  sky: z.string().optional(),
  humidity: z.string().optional(),
  groundWetness: z.string().optional(),
  haze: z.string().optional(),
  notes: z.string().default(""),
});
export type WeatherDNA = z.infer<typeof WeatherDNASchema>;

export const MoodDNASchema = z.object({
  schemaVersion: z.literal(1),
  preset: z.string().optional(),
  contrast: z.string().optional(),
  saturation: z.string().optional(),
  warmth: z.string().optional(),
  atmosphere: z.string().optional(),
  notes: z.string().default(""),
});
export type MoodDNA = z.infer<typeof MoodDNASchema>;

const gradeSlider = z.number().min(-100).max(100).default(0);

export const ColorGradeDNASchema = z.object({
  schemaVersion: z.literal(1),
  exposure: z.number().min(-5).max(5).default(0),
  contrast: gradeSlider,
  highlights: gradeSlider,
  shadows: gradeSlider,
  whites: gradeSlider,
  blacks: gradeSlider,
  temperature: gradeSlider,
  tint: gradeSlider,
  vibrance: gradeSlider,
  saturation: gradeSlider,
  clarity: gradeSlider,
  dehaze: gradeSlider,
  look: z.string().optional(),
});
export type ColorGradeDNA = z.infer<typeof ColorGradeDNASchema>;
