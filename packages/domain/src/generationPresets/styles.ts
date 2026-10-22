import { INTERIOR_STYLES } from "../interior/catalog";
import type { GenerationPreset } from "./schema";
export const GENERATION_STYLES: GenerationPreset[] = INTERIOR_STYLES.map((style) => ({
  id: style.id,
  label: { vi: style.vi, en: style.en },
  description: { vi: style.vi, en: style.prompt },
  icon: "icon-style",
  promptFragment: style.prompt,
  negativeFragment: "",
  defaults: {},
  constraints: ["hard-locks-win"],
  conflicts: ["change-level-0"],
  compatibleModes: ["interior"],
}));
