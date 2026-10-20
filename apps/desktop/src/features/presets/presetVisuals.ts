import type { PresetGroup, ShotPreset } from "@arch/domain";
import type { PremiumIconId } from "../../components/common/PremiumIcon";

/** Purely visual routing keyed to stable preset ids; prompts and patches are untouched. */
export const groupVisualId: Record<PresetGroup, PremiumIconId> = {
  render: "enhance",
  time_light: "sunset",
  weather: "clouds",
  palette: "color",
  camera: "view",
  people_cars: "people",
  effects: "atmosphere",
  color_look: "color",
};

export function presetVisualId(preset: Pick<ShotPreset, "id" | "group">): PremiumIconId {
  const id = preset.id;
  switch (preset.group) {
    case "render":
      if (id.includes("sketch")) return "edit";
      if (id.includes("clean")) return "sharpen";
      if (id.includes("white_model")) return "isometric";
      return id.includes("viewport") ? "create-image" : "enhance";
    case "time_light":
      if (id.endsWith("night") || id.endsWith("blue_hour")) return "night";
      if (id.endsWith("dawn") || id.endsWith("golden_hour") || id.endsWith("afternoon"))
        return "sunset";
      return "day";
    case "weather":
      if (id.includes("rain")) return "rain";
      if (id.includes("mist")) return "fog";
      return id.includes("clear") ? "day" : "clouds";
    case "palette":
      return "color";
    case "camera":
      if (id.includes("aerial")) return "isometric";
      if (id.includes("detail")) return "closeup";
      if (id.includes("overview") || id.includes("oblique")) return "wide-view";
      return "view";
    case "people_cars":
      if (id.startsWith("people.")) return "people";
      if (id.startsWith("cars.") || id.startsWith("bikes.")) return "car";
      if (id.startsWith("plants.")) return "tree";
      if (id.startsWith("pets.")) return "pet";
      return "people";
    case "effects":
      if (id.includes("sunstar")) return "sunstar";
      if (id.includes("trail") || id.includes("motion")) return "long-exposure";
      if (id.includes("water")) return "waves";
      if (id.includes("cloud")) return "clouds";
      if (id.includes("rays") || id.includes("flare")) return "volumetric";
      if (id.includes("reflection")) return "color";
      return "atmosphere";
    case "color_look":
      if (id.includes("warm")) return "sunset";
      if (id.includes("cool")) return "night";
      if (id.includes("matte")) return "hdr";
      return "color";
    default:
      return "preset-grid";
  }
}
