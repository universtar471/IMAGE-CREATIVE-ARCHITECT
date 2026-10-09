import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyGradePixel, GRADE_LOOKS } from "./apply";
import type { ColorGradeDNA } from "../schemas/future";

const colours: [number, number, number][] = [
  [0, 0, 0],
  [255, 255, 255],
  [32, 32, 32],
  [128, 128, 128],
  [224, 224, 224],
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
  [0, 255, 255],
  [255, 0, 255],
  [196, 148, 120],
  [238, 190, 160],
  [110, 180, 235],
  [45, 120, 55],
  [180, 210, 80],
];
const zero = (): ColorGradeDNA => ({
  schemaVersion: 1,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  clarity: 0,
  dehaze: 0,
});
const grades: ColorGradeDNA[] = [zero()];
for (const key of [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
  "clarity",
  "dehaze",
] as const) {
  for (const value of [-100, -50, 50, 100]) grades.push({ ...zero(), [key]: value });
}
grades.push(...Object.values(GRADE_LOOKS));
export function generateGradeVectors() {
  const rows = grades.map((grade) => ({
    grade,
    input: colours,
    output: colours.map((c) => applyGradePixel(c, grade)),
  }));
  const path = fileURLToPath(new URL("../../test-vectors/grade.json", import.meta.url));
  writeFileSync(path, `${JSON.stringify(rows, null, 2)}\n`);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) generateGradeVectors();
