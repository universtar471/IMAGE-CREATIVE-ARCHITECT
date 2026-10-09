import type { ColorGradeDNA, GradeLookId } from "../schemas/future";

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export const GRADE_LOOKS: Record<GradeLookId, ColorGradeDNA> = {
  neutral: {
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
    look: "neutral",
  },
  warm_tropical: {
    schemaVersion: 1,
    exposure: 25,
    contrast: 8,
    highlights: -8,
    shadows: 12,
    whites: 4,
    blacks: -4,
    temperature: 35,
    tint: 5,
    vibrance: 24,
    saturation: 8,
    clarity: 4,
    dehaze: 5,
    look: "warm_tropical",
  },
  cool_modern: {
    schemaVersion: 1,
    exposure: 10,
    contrast: 14,
    highlights: -4,
    shadows: 4,
    whites: 5,
    blacks: -8,
    temperature: -28,
    tint: 2,
    vibrance: 16,
    saturation: -4,
    clarity: 10,
    dehaze: 8,
    look: "cool_modern",
  },
  soft_editorial: {
    schemaVersion: 1,
    exposure: 20,
    contrast: -18,
    highlights: -18,
    shadows: 18,
    whites: -8,
    blacks: 12,
    temperature: 4,
    tint: 0,
    vibrance: 8,
    saturation: -8,
    clarity: -12,
    dehaze: -8,
    look: "soft_editorial",
  },
  cinematic_dusk: {
    schemaVersion: 1,
    exposure: -20,
    contrast: 22,
    highlights: -16,
    shadows: -4,
    whites: -8,
    blacks: -18,
    temperature: -12,
    tint: 8,
    vibrance: 12,
    saturation: -2,
    clarity: 16,
    dehaze: 12,
    look: "cinematic_dusk",
  },
  bright_magazine: {
    schemaVersion: 1,
    exposure: 45,
    contrast: 10,
    highlights: -5,
    shadows: 14,
    whites: 18,
    blacks: 4,
    temperature: 8,
    tint: 0,
    vibrance: 18,
    saturation: 6,
    clarity: 8,
    dehaze: 10,
    look: "bright_magazine",
  },
};

type PixelScratch = [number, number, number];

function gradePixelInto(
  red: number,
  green: number,
  blue: number,
  grade: ColorGradeDNA,
  output: PixelScratch,
): void {
  let r = red / 255;
  let g = green / 255;
  let b = blue / 255;
  const exposure = grade.exposure / 100;
  r = linearToSrgb(clamp01(srgbToLinear(r) * 2 ** exposure));
  g = linearToSrgb(clamp01(srgbToLinear(g) * 2 ** exposure));
  b = linearToSrgb(clamp01(srgbToLinear(b) * 2 ** exposure));
  const kt = grade.temperature / 100;
  const ki = grade.tint / 100;
  r += 0.1 * kt;
  b -= 0.1 * kt;
  g -= 0.1 * ki;
  const contrast = 1 + grade.contrast / 100;
  r = (r - 0.5) * contrast + 0.5;
  g = (g - 0.5) * contrast + 0.5;
  b = (b - 0.5) * contrast + 0.5;
  const luminance = () => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let l = luminance();
  const hi = 0.25 * (grade.highlights / 100) * smoothstep(0.5, 1, l);
  r += hi;
  g += hi;
  b += hi;
  l = luminance();
  const sh = 0.25 * (grade.shadows / 100) * (1 - smoothstep(0, 0.5, l));
  r += sh;
  g += sh;
  b += sh;
  l = luminance();
  r += 0.15 * (grade.whites / 100) * l ** 2;
  g += 0.15 * (grade.whites / 100) * l ** 2;
  b += 0.15 * (grade.whites / 100) * l ** 2;
  l = luminance();
  r += 0.15 * (grade.blacks / 100) * (1 - l) ** 2;
  g += 0.15 * (grade.blacks / 100) * (1 - l) ** 2;
  b += 0.15 * (grade.blacks / 100) * (1 - l) ** 2;
  l = luminance();
  const clarity = 0.8 * (grade.clarity / 100) * l * (1 - l);
  r += clarity * (r - 0.5);
  g += clarity * (g - 0.5);
  b += clarity * (b - 0.5);
  const d = 0.1 * (grade.dehaze / 100);
  r = (r - d) / (1 - d);
  g = (g - d) / (1 - d);
  b = (b - d) / (1 - d);
  l = luminance();
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    spread = max - min;
  const vibrance = 1 + (grade.vibrance / 100) * (1 - spread);
  r = l + (r - l) * vibrance;
  g = l + (g - l) * vibrance;
  b = l + (b - l) * vibrance;
  l = luminance();
  const saturation = 1 + grade.saturation / 100;
  r = l + (r - l) * saturation;
  g = l + (g - l) * saturation;
  b = l + (b - l) * saturation;
  output[0] = Math.round(clamp01(r) * 255);
  output[1] = Math.round(clamp01(g) * 255);
  output[2] = Math.round(clamp01(b) * 255);
}

/** Apply the documented grade pipeline to one RGB pixel. Alpha is not part of this function. */
export function applyGradePixel(
  rgb: readonly [number, number, number],
  grade: ColorGradeDNA,
): [number, number, number] {
  const output: PixelScratch = [0, 0, 0];
  gradePixelInto(rgb[0], rgb[1], rgb[2], grade, output);
  return output;
}

/** Grade RGBA bytes without mutating the source unless it is explicitly supplied as `out`. */
export function applyGradeToImageData(
  data: Uint8ClampedArray,
  grade: ColorGradeDNA,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const output = out ?? new Uint8ClampedArray(data);
  if (output !== data) output.set(data);
  const scratch: PixelScratch = [0, 0, 0];
  for (let i = 0; i + 2 < data.length; i += 4) {
    gradePixelInto(data[i]!, data[i + 1]!, data[i + 2]!, grade, scratch);
    output[i] = scratch[0];
    output[i + 1] = scratch[1];
    output[i + 2] = scratch[2];
  }
  return output;
}
