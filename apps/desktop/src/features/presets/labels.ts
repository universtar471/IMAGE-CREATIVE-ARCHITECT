import { shotPreset, type ShotPreset } from "@arch/domain";
import type { Locale } from "../../i18n";

export const presetLabel = (preset: ShotPreset, locale: Locale) =>
  locale === "vi" ? preset.labelVi : preset.labelEn;

/** Labels of preset ids in the current language (unknown ids are shown as they are). */
export function presetLabels(ids: readonly string[], locale: Locale): string[] {
  return ids.map((id) => {
    const preset = shotPreset(id);
    return preset ? presetLabel(preset, locale) : id;
  });
}
