import type { ColorGradeV2 } from "./schema";

export const GRADE_STYLE_PRESETS = {
  earthy_muted: {
    vi: "Trầm mộc",
    en: "Earthy Muted",
    grade: {
      saturation: -20,
      texture: 8,
      clarity: 5,
      blacks: 12,
      temperature: 8,
      toneCurve: "matte",
    },
    styles: ["wabi_sabi", "japandi", "organic_modern"],
  },
  heritage_warmth: {
    vi: "Ấm hoài cổ",
    en: "Heritage Warmth",
    grade: { contrast: 18, shadows: -14, temperature: 18, vibrance: 9, toneCurve: "soft_s" },
    styles: ["indochine", "modern_classic", "neo_classic"],
  },
  clean_editorial: {
    vi: "Trong trẻo",
    en: "Clean Editorial",
    grade: { exposure: 8, whites: 14, highlights: -12, temperature: 0, tint: 0 },
    styles: ["minimalist", "scandinavian", "contemporary"],
  },
  tropical_forest: {
    vi: "Rừng nhiệt đới",
    en: "Tropical Forest",
    grade: {
      saturation: -12,
      contrast: -8,
      splitTone: {
        shadowsHue: 175,
        shadowsSat: 8,
        highlightsHue: 55,
        highlightsSat: 10,
        balance: -8,
      },
    },
    styles: ["tropical", "organic_modern", "minimalist"],
  },
  concrete_steel: {
    vi: "Bê tông thép",
    en: "Concrete Steel",
    grade: { contrast: 15, clarity: 18, temperature: -12, saturation: -9 },
    styles: ["industrial", "modern", "mid_century_modern"],
  },
} satisfies Record<
  string,
  { vi: string; en: string; grade: Partial<ColorGradeV2>; styles: string[] }
>;

export type GradeStylePresetId = keyof typeof GRADE_STYLE_PRESETS;

export function gradePresetsForStyle(styleKey: string): GradeStylePresetId[] {
  return (Object.keys(GRADE_STYLE_PRESETS) as GradeStylePresetId[]).filter((id) =>
    GRADE_STYLE_PRESETS[id].styles.some((style) => style.toLowerCase() === styleKey.toLowerCase()),
  );
}
