/**
 * DNA schemas for future modules (Camera, Lighting, Weather, Mood, Color Grade).
 * Defined now so the aggregate is stable; Phase 1 UI does not edit them.
 */
import { z } from "zod";

export const CameraDNASchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string(),
  azimuthDeg: z.number().min(-360).max(360).optional(),
  elevationDeg: z.number().min(-90).max(90).optional(),
  heightM: z.number().positive().optional(),
  lensMm: z.number().positive().optional(),
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
