/**
 * P4-A stand-in for the shared grade implementation. Keep this implementation byte-for-byte
 * compatible with API_CONTRACTS.md §12.3; it can be removed when @arch/domain/grade is merged.
 * TODO(p4-domain): replace imports with applyGradePixel/applyGradeToImageData from @arch/domain.
 */
import type { ColorGradeDNA } from "@arch/domain";

export const GRADE_LOOKS: Record<string, ColorGradeDNA> = {
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
    exposure: 0.15,
    contrast: 8,
    highlights: 4,
    shadows: 8,
    whites: 4,
    blacks: -4,
    temperature: 35,
    tint: 4,
    vibrance: 24,
    saturation: 8,
    clarity: 4,
    dehaze: 3,
    look: "warm_tropical",
  },
  cool_modern: {
    schemaVersion: 1,
    exposure: 0.1,
    contrast: 14,
    highlights: -5,
    shadows: 4,
    whites: 0,
    blacks: -8,
    temperature: -24,
    tint: 3,
    vibrance: 12,
    saturation: -4,
    clarity: 12,
    dehaze: 8,
    look: "cool_modern",
  },
  soft_editorial: {
    schemaVersion: 1,
    exposure: 0.2,
    contrast: -12,
    highlights: -12,
    shadows: 18,
    whites: -6,
    blacks: 10,
    temperature: 8,
    tint: 0,
    vibrance: 6,
    saturation: -10,
    clarity: -12,
    dehaze: -4,
    look: "soft_editorial",
  },
  cinematic_dusk: {
    schemaVersion: 1,
    exposure: -0.25,
    contrast: 24,
    highlights: -18,
    shadows: -12,
    whites: -10,
    blacks: -18,
    temperature: -12,
    tint: 10,
    vibrance: 8,
    saturation: -8,
    clarity: 18,
    dehaze: 12,
    look: "cinematic_dusk",
  },
  bright_magazine: {
    schemaVersion: 1,
    exposure: 0.45,
    contrast: 6,
    highlights: -4,
    shadows: 20,
    whites: 18,
    blacks: 4,
    temperature: 4,
    tint: 0,
    vibrance: 20,
    saturation: 6,
    clarity: 6,
    dehaze: 2,
    look: "bright_magazine",
  },
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function applyGradePixel(
  rgb: readonly [number, number, number],
  grade: ColorGradeDNA,
): [number, number, number] {
  let c = rgb.map((v) => v / 255) as [number, number, number];
  const exposure = grade.exposure;
  c = c.map((v) => linearToSrgb(clamp(srgbToLinear(v) * 2 ** exposure))) as [
    number,
    number,
    number,
  ];
  const temp = grade.temperature / 100;
  const tint = grade.tint / 100;
  c = [c[0] + 0.1 * temp, c[1] - 0.1 * tint, c[2] - 0.1 * temp];
  const contrast = grade.contrast / 100;
  c = c.map((v) => (v - 0.5) * (1 + contrast) + 0.5) as [number, number, number];
  let l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const add = (amount: number) => {
    c = c.map((v) => v + amount) as [number, number, number];
  };
  add(0.25 * (grade.highlights / 100) * smoothstep(0.5, 1, l));
  l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  add(0.25 * (grade.shadows / 100) * (1 - smoothstep(0, 0.5, l)));
  l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  add(0.15 * (grade.whites / 100) * l ** 2);
  l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  add(0.15 * (grade.blacks / 100) * (1 - l) ** 2);
  l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  c = c.map((v) => v + 0.8 * (grade.clarity / 100) * (v - 0.5) * l * (1 - l)) as [
    number,
    number,
    number,
  ];
  const d = 0.1 * (grade.dehaze / 100);
  c = c.map((v) => (v - d) / (1 - d)) as [number, number, number];
  l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = Math.max(...c) - Math.min(...c);
  c = c.map((v) => l + (v - l) * (1 + (grade.vibrance / 100) * (1 - sat))) as [
    number,
    number,
    number,
  ];
  l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  c = c.map((v) => l + (v - l) * (1 + grade.saturation / 100)) as [number, number, number];
  return c.map((v) => Math.round(clamp(v) * 255)) as [number, number, number];
}

export function applyGradeToImageData(
  data: Uint8ClampedArray,
  grade: ColorGradeDNA,
): Uint8ClampedArray {
  for (let i = 0; i + 3 < data.length; i += 4) {
    const [r, g, b] = applyGradePixel([data[i]!, data[i + 1]!, data[i + 2]!], grade);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return data;
}

export const neutralGrade = (): ColorGradeDNA => ({ ...GRADE_LOOKS.neutral! });
