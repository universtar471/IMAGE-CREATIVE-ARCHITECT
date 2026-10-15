import type { ColorGradeV2 } from "./schema";

export const GRADE_STYLE_PRESETS = {
  earthy_muted: {
    vi: "Trầm mộc",
    en: "Earthy Muted",
    grade: {
      saturation: -20,
      texture: 6,
      clarity: 3,
      blacks: 14,
      temperature: 28,
      toneCurve: "matte",
    },
    styles: ["wabi_sabi", "japandi", "organic_modern"],
  },
  heritage_warmth: {
    vi: "Ấm hoài cổ",
    en: "Heritage Warmth",
    grade: {
      contrast: 22,
      shadows: -16,
      temperature: 20,
      vibrance: 10,
      toneCurve: "soft_s",
      splitTone: {
        shadowsHue: 28,
        shadowsSat: 5,
        highlightsHue: 42,
        highlightsSat: 7,
        balance: 4,
      },
    },
    styles: ["indochine", "modern_classic", "neo_classic"],
  },
  clean_editorial: {
    vi: "Trong trẻo",
    en: "Clean Editorial",
    grade: {
      exposure: 16,
      contrast: 35,
      whites: 0,
      highlights: -80,
      shadows: 100,
      temperature: 0,
      tint: 0,
      saturation: -7,
      clarity: 25,
      blacks: -10,
    },
    styles: ["minimalist", "scandinavian", "contemporary"],
  },
  tropical_forest: {
    vi: "Rừng nhiệt đới",
    en: "Tropical Forest",
    grade: {
      saturation: -3,
      contrast: -45,
      splitTone: {
        shadowsHue: 175,
        shadowsSat: 6,
        highlightsHue: 55,
        highlightsSat: 7,
        balance: -8,
      },
    },
    styles: ["tropical", "organic_modern", "minimalist"],
  },
  concrete_steel: {
    vi: "Bê tông thép",
    en: "Concrete Steel",
    grade: {
      contrast: 30,
      highlights: -55,
      whites: -30,
      blacks: -25,
      clarity: 60,
      toneCurve: "strong_s",
      temperature: -30,
      saturation: -40,
    },
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
