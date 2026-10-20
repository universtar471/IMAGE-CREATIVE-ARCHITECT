/**
 * Image recipes (M4, ADR-042): one click plans several variants of the same source, each a
 * preset combination layered on the current shot. Planning never runs anything: the desktop
 * shows the variants and the total cost, and submits them only after the usual spend confirm,
 * one ordinary generation per variant (so every run stays an immutable record with lineage).
 *
 * Each variant goes through `setShotPresets`, so a variant's time of day replaces the shot's
 * own (exclusive keys) while the user's other chips (render mode, people, …) are kept.
 */
import type { ProjectDNA } from "../schemas/projectDna";
import type { ShotIntent } from "../validation/shotIntent";
import { normalizePresetIds, setShotPresets } from "../presets/apply";

export type RecipeVariant = {
  id: string;
  labelVi: string;
  labelEn: string;
  presetIds: readonly string[];
};

export type ImageRecipe = {
  id: string;
  labelVi: string;
  labelEn: string;
  hintVi: string;
  hintEn: string;
  variants: readonly RecipeVariant[];
};

const variant = (id: string, labelVi: string, labelEn: string, ...presetIds: string[]) => ({
  id,
  labelVi,
  labelEn,
  presetIds,
});

export const IMAGE_RECIPES: readonly ImageRecipe[] = [
  {
    id: "lighting_scenarios",
    labelVi: "6 kịch bản ánh sáng",
    labelEn: "6 lighting scenarios",
    hintVi: "Cùng góc nhìn, sáu thời điểm và điều kiện ánh sáng",
    hintEn: "The same view at six times and light conditions",
    variants: [
      variant("morning", "Buổi sáng", "Morning", "time.morning", "weather.clear"),
      variant("midday", "Giữa trưa", "Midday", "time.midday", "weather.clear"),
      variant("golden", "Giờ vàng", "Golden hour", "time.golden_hour", "weather.partly_cloudy"),
      variant("overcast", "Trời âm u", "Overcast", "time.afternoon", "weather.overcast"),
      variant("blue", "Giờ xanh", "Blue hour", "time.blue_hour", "weather.clear"),
      variant("night", "Ban đêm", "Night", "time.night", "weather.clear"),
    ],
  },
  {
    id: "weather_set",
    labelVi: "Bộ thời tiết",
    labelEn: "Weather set",
    hintVi: "Bốn kiểu thời tiết, giữ nguyên công trình",
    hintEn: "Four kinds of weather, the building unchanged",
    variants: [
      variant("clear", "Trời quang", "Clear", "weather.clear"),
      variant("after_rain", "Sau mưa", "After rain", "weather.after_rain"),
      variant("light_rain", "Mưa nhẹ", "Light rain", "weather.light_rain"),
      variant("mist", "Sương sớm", "Morning mist", "weather.morning_mist", "time.dawn"),
    ],
  },
  {
    id: "facade_palette",
    labelVi: "Phối màu mặt tiền",
    labelEn: "Facade colour options",
    hintVi: "Bốn màu sơn tường, giữ nguyên vật liệu khác",
    hintEn: "Four wall paint colours, other materials unchanged",
    variants: [
      variant("warm_white", "Trắng ấm", "Warm white", "palette.warm_white"),
      variant("sand_beige", "Be cát", "Sand beige", "palette.sand_beige"),
      variant("light_grey", "Xám nhạt", "Light grey", "palette.light_grey"),
      variant("charcoal", "Xám than", "Charcoal", "palette.charcoal"),
    ],
  },
  {
    id: "material_moodboard",
    labelVi: "Moodboard vật liệu",
    labelEn: "Material moodboard",
    hintVi: "Một bảng mẫu vật liệu thấy trong ảnh",
    hintEn: "One board of the materials seen in the image",
    variants: [variant("board", "Moodboard", "Moodboard", "render.material_moodboard")],
  },
];

export const imageRecipe = (id: string): ImageRecipe | undefined =>
  IMAGE_RECIPES.find((r) => r.id === id);

export type PlannedVariant = {
  variant: RecipeVariant;
  shotIntent: ShotIntent;
  /** Presets of this variant that do not fit the shot (e.g. a facade palette indoors). */
  skipped: string[];
};

/**
 * The shots of a recipe on top of `base`: the user's chips plus the variant's presets, the
 * variant winning every exclusive key. A variant whose own presets were all skipped is left
 * out, so an interior shot never pays for facade colours it cannot show.
 */
export function planRecipe(
  recipe: ImageRecipe,
  base: ShotIntent,
  dna: ProjectDNA,
  variantIds?: readonly string[],
): PlannedVariant[] {
  const chosen = recipe.variants.filter((v) => !variantIds || variantIds.includes(v.id));
  return chosen.flatMap((v) => {
    const ids = normalizePresetIds([...(base.presetIds ?? []), ...v.presetIds]);
    const { shotIntent, skipped } = setShotPresets(base, ids, dna);
    const own = skipped.filter((id) => v.presetIds.includes(id));
    return own.length === v.presetIds.length ? [] : [{ variant: v, shotIntent, skipped: own }];
  });
}
