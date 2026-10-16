/**
 * Effect catalog (ADR-036 P2c, SRS §6.1–6.2): the user label (Vietnamese "feel" names of
 * SRS §6.2 and English), the SRS family and the English prompt wording.
 *
 * `promptEn` contains `{intensity}`, replaced by `INTENSITY_EN`. Each effect is applied ONLY
 * to its real source, and `guardEn` states what the effect must never change or create.
 */
import type { EffectFamily, EffectId, EffectIntensity } from "./schemas";

export type EffectDefinition = {
  id: EffectId;
  family: EffectFamily;
  labelVi: string;
  labelEn: string;
  promptEn: string;
  guardEn: string;
};

export const INTENSITY_EN: Readonly<Record<EffectIntensity, string>> = {
  light: "subtle",
  medium: "moderate",
  strong: "strong",
};

export const EFFECT_CATALOG: readonly EffectDefinition[] = [
  {
    id: "vehicle_light_trails",
    family: "long_exposure_motion",
    labelVi: "Vệt sáng xe",
    labelEn: "Vehicle light trails",
    promptEn:
      "Apply {intensity} long-exposure light trails ONLY to moving vehicles on the existing road.",
    guardEn:
      "Do not introduce new lanes, widen the street, remove parked vehicles or blur the building.",
  },
  {
    id: "people_motion_blur",
    family: "long_exposure_motion",
    labelVi: "Người chuyển động mờ",
    labelEn: "Motion-blurred people",
    promptEn:
      "Apply {intensity} long-exposure motion blur ONLY to people walking along existing paths and floors.",
    guardEn:
      "Keep people to scale and grounded; do not blur standing or seated people, furniture or the building.",
  },
  {
    id: "soft_clouds",
    family: "long_exposure_nature",
    labelVi: "Mây mềm",
    labelEn: "Soft clouds",
    promptEn: "Apply {intensity} long-exposure streaking ONLY to the clouds in the visible sky.",
    guardEn:
      "Do not add sky where none is visible, and keep the horizon, roofline and building edges unchanged.",
  },
  {
    id: "silky_water",
    family: "long_exposure_nature",
    labelVi: "Nước mượt",
    labelEn: "Silky water",
    promptEn: "Apply {intensity} long-exposure smoothing ONLY to the existing water surfaces.",
    guardEn:
      "Do not add, enlarge or move any water body; keep pool edges, coping and the building's reflections in place.",
  },
  {
    id: "sunstar",
    family: "sunstar",
    labelVi: "Tia sao",
    labelEn: "Sunstar",
    promptEn:
      "Apply a {intensity} starburst ONLY to an existing point light source (the sun at an edge of the building or a visible lamp).",
    guardEn: "Do not add a second sun or any new light source.",
  },
  {
    id: "lens_flare",
    family: "lens_flare",
    labelVi: "Lóe sáng nhẹ",
    labelEn: "Gentle lens flare",
    promptEn:
      "Apply a {intensity} lens flare consistent with the direction of the existing light source.",
    guardEn: "Keep the flare clear of key architectural details and never add a new light source.",
  },
  {
    id: "god_rays",
    family: "atmospheric_glow",
    labelVi: "Luồng sáng",
    labelEn: "Light rays",
    promptEn:
      "Apply {intensity} atmospheric glow and volumetric light rays ONLY where light passes through real openings, gaps or foliage.",
    guardEn: "Light rays never pass through solid walls or roofs; do not add new openings.",
  },
  {
    id: "reflection_control",
    family: "reflection_control",
    labelVi: "Giảm phản xạ kính",
    labelEn: "Reduce glass reflections",
    promptEn:
      "Apply {intensity} polarizing-filter reflection control to the existing glass and water surfaces.",
    guardEn:
      "Do not reveal anything behind the glass that is not in the original references, and keep the glazing visible.",
  },
];

const BY_ID = new Map(EFFECT_CATALOG.map((e) => [e.id, e]));

export function effectDefinition(id: EffectId): EffectDefinition {
  return BY_ID.get(id)!;
}

/** The English apply sentence of an effect at an intensity. */
export function effectPromptEn(id: EffectId, intensity: EffectIntensity): string {
  return effectDefinition(id).promptEn.replace("{intensity}", INTENSITY_EN[intensity]);
}
