/**
 * Resolves gallery choices (30 v1 looks, five v2 style presets, LUTs) into a full
 * ColorGradeDNA, and finds the style presets that match the project (ADR-031/032).
 */
import {
  GRADE_LOOKS,
  GRADE_STYLE_PRESETS,
  gradePresetsForStyle,
  type ColorGradeDNA,
  type GradeStylePresetId,
  type ProjectDNA,
} from "@arch/domain";
import { neutralGrade } from "../../lib/grade";

export const STYLE_PRESET_IDS = Object.keys(GRADE_STYLE_PRESETS) as GradeStylePresetId[];

/** Strength given to a LUT when it is first selected (API §21.3). */
export const DEFAULT_LUT_STRENGTH = 70;

export const isStylePresetId = (id: string): id is GradeStylePresetId =>
  Object.hasOwn(GRADE_STYLE_PRESETS, id);

export const isLookId = (id: string): id is keyof typeof GRADE_LOOKS =>
  Object.hasOwn(GRADE_LOOKS, id);

/** A style preset over a neutral base; `look` records the preset id. */
export function stylePresetGrade(id: GradeStylePresetId): ColorGradeDNA {
  const preset = GRADE_STYLE_PRESETS[id].grade as Partial<ColorGradeDNA>;
  return {
    ...neutralGrade(),
    ...preset,
    ...(preset.splitTone ? { splitTone: { ...preset.splitTone } } : {}),
    look: id,
  };
}

/** The grade for a v1 look id or a style preset id; null for anything else. */
export function gradeForPreset(id: string): ColorGradeDNA | null {
  if (isLookId(id)) return { ...GRADE_LOOKS[id] };
  if (isStylePresetId(id)) return stylePresetGrade(id);
  return null;
}

/**
 * Choosing a look replaces every adjustment but keeps the LUT layer: a LUT is picked in
 * its own tab and is meant to sit on top of any look.
 */
export function chooseGradePreset(current: ColorGradeDNA, id: string): ColorGradeDNA | null {
  const next = gradeForPreset(id);
  if (!next) return null;
  return current.lut ? { ...next, lut: { ...current.lut } } : next;
}

/** Select (or clear with null) a LUT; re-selecting the same LUT keeps its strength. */
export function withLut(grade: ColorGradeDNA, lutId: string | null): ColorGradeDNA {
  if (!lutId) {
    const { lut: _drop, ...rest } = grade;
    return rest as ColorGradeDNA;
  }
  const strength = grade.lut?.lutId === lutId ? grade.lut.strength : DEFAULT_LUT_STRENGTH;
  return { ...grade, lut: { lutId, strength } };
}

export function withLutStrength(grade: ColorGradeDNA, strength: number): ColorGradeDNA {
  if (!grade.lut) return grade;
  const value = Math.max(0, Math.min(100, Math.round(strength)));
  return { ...grade, lut: { ...grade.lut, strength: value } };
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .trim();

/**
 * Style keys of the project: the interior style id (§18) and the exterior
 * `building.architecturalStyle` (§19) as a key ("Neo classic" → "neo_classic") plus its
 * words, so "Modern tropical" also matches "modern" and "tropical".
 */
export function projectStyleKeys(dna: Partial<ProjectDNA> | null | undefined): string[] {
  const keys = new Set<string>();
  const interior = (dna as { interior?: { styleId?: unknown } } | null)?.interior;
  if (typeof interior?.styleId === "string" && interior.styleId) keys.add(interior.styleId);
  const exterior = (dna as { building?: { architecturalStyle?: unknown } } | null)?.building
    ?.architecturalStyle;
  if (typeof exterior === "string" && exterior.trim()) {
    const words = fold(exterior)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (words.length) keys.add(words.join("_"));
    for (const word of words) keys.add(word);
  }
  return [...keys];
}

/** Style preset ids that fit the project style (the "Hợp phong cách" badge). */
export function matchingStylePresets(
  dna: Partial<ProjectDNA> | null | undefined,
): Set<GradeStylePresetId> {
  return new Set(projectStyleKeys(dna).flatMap((key) => gradePresetsForStyle(key)));
}
