/**
 * Shot presets (ADR-039, M1): one click adds a chip that writes structured choices into the
 * per-shot `ShotIntent` and, for some presets, one self-written English prompt sentence.
 *
 * Presets never touch ProjectDNA. The selection lives in `ShotIntent.presetIds`; what each
 * preset contributes is resolved from this catalog at compile time, so the snapshot records
 * the ids and the compiled text, and the catalog can be re-worded without a migration.
 */
import { z } from "zod";
import { TimeOfDaySchema } from "../schemas/future";
import type { TimeOfDay, GradeLookId } from "../schemas/future";
import type { EffectId, EffectIntensity } from "../effects/schemas";
import type { SceneObjectState, SceneObjectVisibility } from "../sceneObjects/schemas";
import type { VisualIntentView } from "../camera/intent";

/** The preset groups, in display order (`palette` added by ADR-042). */
export const PRESET_GROUPS = [
  "render",
  "time_light",
  "weather",
  "palette",
  "camera",
  "people_cars",
  "effects",
  "color_look",
] as const;
export const PresetGroupSchema = z.enum(PRESET_GROUPS);
export type PresetGroup = z.infer<typeof PresetGroupSchema>;

/** Per-shot weather choices (a fixed list, so no free text reaches the prompt). */
export const SHOT_WEATHER_IDS = [
  "clear",
  "partly_cloudy",
  "overcast",
  "light_rain",
  "after_rain",
  "morning_mist",
] as const;
export const ShotWeatherSchema = z.enum(SHOT_WEATHER_IDS);
export type ShotWeather = z.infer<typeof ShotWeatherSchema>;

/**
 * `ShotIntent.lighting`: time of day and weather for this shot only. A locked Lighting or
 * Weather DNA wins in the compiler and the validator reports the conflict.
 */
export const ShotLightingSchema = z.object({
  timeOfDay: TimeOfDaySchema.optional(),
  weather: ShotWeatherSchema.optional(),
});
export type ShotLighting = z.infer<typeof ShotLightingSchema>;

/** Where a preset makes sense. `any` is offered for every shot. */
export type PresetScope = "exterior" | "interior" | "any";

/**
 * Where a preset's content comes from, recorded so every preset can be traced to existing
 * app data or to the app's own writing (ADR-039: no wording copied from other products).
 */
export type PresetSource =
  | "authored"
  | "time_of_day"
  | "visual_intent"
  | "effect_catalog"
  | "scene_object_catalog"
  | "grade_look";

/** One object a preset adds; the target (frontage or active space) is resolved per shot. */
export type PresetObject = {
  presetId: string;
  quantity: number;
  state: SceneObjectState;
  visibility?: SceneObjectVisibility;
};

/** The structured part of a preset. Every field is optional; empty means prompt text only. */
export type PresetPatch = {
  timeOfDay?: TimeOfDay;
  weather?: ShotWeather;
  view?: VisualIntentView;
  effect?: { id: EffectId; intensity: EffectIntensity };
  objects?: readonly PresetObject[];
  /** A free post-production look (Mood / Grade); it never reaches the prompt. */
  gradeLookId?: GradeLookId;
};

export type ShotPreset = {
  id: string;
  group: PresetGroup;
  /**
   * Presets sharing an exclusive key replace each other (one time of day, one weather, one
   * view, one primary effect, one render mode, one look). Absent: freely combinable.
   */
  exclusive?: string;
  scope: PresetScope;
  labelVi: string;
  labelEn: string;
  hintVi: string;
  hintEn: string;
  patch: PresetPatch;
  /** Self-written English prompt sentence; absent when the patch compiles elsewhere. */
  promptEn?: string;
  /** What the preset must keep unchanged (English, appended after `promptEn`). */
  keepEn?: string;
  source: PresetSource;
};

export const PresetIdListSchema = z.array(z.string().trim().min(1)).max(24);

/**
 * "My presets" (M2, ADR-040): a saved combination of preset ids, shared by every project.
 * Ids the catalog no longer knows are skipped when the combination is applied.
 */
export const UserPresetDTOSchema = z.object({
  id: z.string(),
  name: z.string(),
  presetIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserPresetDTO = z.infer<typeof UserPresetDTOSchema>;

export const USER_PRESET_NAME_MAX = 60;
