/**
 * Optical and motion effects data model (ADR-036 P2c, SRS §6.1–6.2).
 *
 * The selection is a per-shot choice: it lives in `ShotIntent.effects` and the generation
 * snapshot (`PromptBundle.shotIntent`), never in ProjectDNA. Every effect is off by default;
 * a shot has at most one primary effect, and secondary effects are kept only when they are
 * compatible with it.
 */
import { z } from "zod";

/**
 * The eight user-facing effects, grouped into the six SRS §6.1 families
 * (`EFFECT_CATALOG[n].family`).
 */
export const EFFECT_IDS = [
  "vehicle_light_trails",
  "people_motion_blur",
  "soft_clouds",
  "silky_water",
  "sunstar",
  "lens_flare",
  "god_rays",
  "reflection_control",
] as const;
export const EffectIdSchema = z.enum(EFFECT_IDS);
export type EffectId = z.infer<typeof EffectIdSchema>;

/** The six SRS §6.1 effect families. */
export const EFFECT_FAMILIES = [
  "long_exposure_motion",
  "long_exposure_nature",
  "sunstar",
  "lens_flare",
  "atmospheric_glow",
  "reflection_control",
] as const;
export type EffectFamily = (typeof EFFECT_FAMILIES)[number];

export const EFFECT_INTENSITIES = ["light", "medium", "strong"] as const;
export const EffectIntensitySchema = z.enum(EFFECT_INTENSITIES);
export type EffectIntensity = z.infer<typeof EffectIntensitySchema>;

/** Intensity of a newly chosen effect. */
export const DEFAULT_EFFECT_INTENSITY: EffectIntensity = "light";

/** At most this many secondary effects next to the primary one. */
export const MAX_SECONDARY_EFFECTS = 2;

export const EffectChoiceSchema = z.object({
  id: EffectIdSchema,
  intensity: EffectIntensitySchema,
});
export type EffectChoice = z.infer<typeof EffectChoiceSchema>;

/** `ShotIntent.effects`. No primary means no effect at all (secondaries are ignored). */
export const ShotEffectsSchema = z.object({
  primary: EffectChoiceSchema.optional(),
  secondary: z.array(EffectChoiceSchema).max(MAX_SECONDARY_EFFECTS).default([]),
});
export type ShotEffects = z.infer<typeof ShotEffectsSchema>;
export type ShotEffectsInput = z.input<typeof ShotEffectsSchema>;

/** True when the selection turns at least one effect on. */
export const hasEffects = (effects: ShotEffectsInput | null | undefined): boolean =>
  !!effects?.primary;
