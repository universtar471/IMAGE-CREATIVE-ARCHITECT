import type { GenerationPreset } from "./schema";
export const GENERATION_LIGHTING: GenerationPreset[] = [
  [
    "natural",
    "Tự nhiên",
    "Natural",
    "Natural daylight through existing windows, physically plausible indirect illumination and shadows.",
  ],
  [
    "soft_natural",
    "Sáng dịu",
    "Soft natural",
    "Soft, diffuse interior daylight with gentle shadows, balanced highlights and controlled window exposure.",
  ],
  [
    "golden",
    "Giờ vàng",
    "Golden hour",
    "Warm golden-hour light entering only through existing openings, with realistic falloff.",
  ],
  [
    "warm",
    "Ấm áp",
    "Warm",
    "Warm indoor illumination from existing plausible fixtures; no changes to architecture or fixture positions.",
  ],
  [
    "neutral",
    "Trung tính",
    "Neutral",
    "Neutral white indoor illumination, accurate material colors and balanced contrast.",
  ],
  [
    "night",
    "Ban đêm",
    "Night",
    "Nighttime interior illumination using existing plausible light sources; preserve visible furniture and circulation.",
  ],
].map(([id, vi, en, promptFragment]) => ({
  id: id!,
  label: { vi: vi!, en: en! },
  description: { vi: vi!, en: promptFragment! },
  icon: `icon-light-${id === "soft_natural" ? "soft" : id}`,
  promptFragment: promptFragment!,
  negativeFragment: "overexposed windows",
  defaults: {},
  constraints: ["existing-openings"],
  conflicts: [],
  compatibleModes: ["interior"],
}));
