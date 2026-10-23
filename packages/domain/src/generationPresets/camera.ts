import type { GenerationPreset } from "./schema";
export const GENERATION_CAMERAS: GenerationPreset[] = [
  [
    "original",
    "Giữ góc gốc",
    "Original camera",
    "Keep the source camera viewpoint, perspective, camera height, viewing direction, horizon and framing.",
  ],
  [
    "studio",
    "Camera Studio",
    "Camera Studio",
    "Use the linked Camera DNA pose from Camera Studio.",
  ],
  [
    "eye_level",
    "Tầm mắt",
    "Eye level",
    "Interior view at natural eye level with realistic furniture proportions and straight verticals.",
  ],
  [
    "diagonal",
    "Góc chéo",
    "Diagonal",
    "Two-point perspective from a room corner; preserve architectural geometry.",
  ],
  ["front", "Chính diện", "Front", "One-point perspective facing the main interior wall."],
  [
    "wide",
    "Góc rộng",
    "Wide",
    "Wide view showing the room and its circulation; keep natural proportions without fisheye distortion.",
  ],
  [
    "detail",
    "Cận cảnh",
    "Detail",
    "Close-up of an existing furniture or finish detail, with tight framing; do not repeat the whole-room view.",
  ],
].map(([id, vi, en, promptFragment]) => ({
  id: id!,
  label: { vi: vi!, en: en! },
  description: { vi: vi!, en: promptFragment! },
  icon: `icon-camera-${id === "eye_level" ? "eye-level" : id}`,
  promptFragment: promptFragment!,
  negativeFragment: "fisheye distortion",
  defaults: {},
  constraints: id === "original" ? [] : ["camera-unlocked"],
  conflicts: id === "original" ? [] : ["preserve.camera"],
  compatibleModes: ["interior"],
}));
