import { ColorGradeDNASchema } from "../schemas/future";
import type { z } from "zod";

export const ColorGradeV2Schema = ColorGradeDNASchema;

export type ColorGradeV2 = z.infer<typeof ColorGradeV2Schema>;

export function isGradeV2(grade: Partial<ColorGradeV2>): boolean {
  return ["texture", "vignette", "grain", "splitTone", "toneCurve", "lut"].some(
    (key) => grade[key as keyof ColorGradeV2] !== undefined,
  );
}
