import { ALL_PRESERVE, type GenerationPreset } from "./schema";
export const GENERATION_CHANGE_LEVELS: GenerationPreset[] = [
  {
    id: "0",
    label: { vi: "Giữ nguyên", en: "Keep original" },
    icon: "icon-change-locked",
    promptFragment:
      "Keep the design unchanged. Improve rendering quality only; do not redesign, relocate, add or remove major elements.",
    defaults: { preserve: { ...ALL_PRESERVE } },
  },
  {
    id: "1",
    label: { vi: "Thay đổi nhẹ", en: "Light changes" },
    icon: "icon-change-light",
    promptFragment:
      "Make restrained, local refinements only within unlocked categories. Avoid unnecessary redesign.",
    defaults: {
      preserve: {
        layout: true,
        camera: true,
        architecture: true,
        furniture: true,
        materials: false,
      },
    },
  },
  {
    id: "2",
    label: { vi: "Thiết kế lại", en: "Redesign" },
    icon: "icon-change-medium",
    promptFragment:
      "Allow coordinated design changes to unlocked categories while retaining all active hard locks.",
    defaults: {
      preserve: {
        layout: true,
        camera: true,
        architecture: true,
        furniture: false,
        materials: false,
      },
    },
  },
  {
    id: "3",
    label: { vi: "AI tự do", en: "AI freedom" },
    icon: "icon-change-free",
    promptFragment:
      "Explore a creative design direction freely within the categories that are explicitly unlocked; active hard locks remain mandatory.",
    defaults: {
      preserve: {
        layout: false,
        camera: false,
        architecture: true,
        furniture: false,
        materials: false,
      },
    },
  },
].map((p) => ({
  ...p,
  description: { vi: p.label.vi, en: p.promptFragment },
  negativeFragment: "",
  constraints: ["hard-locks-win"],
  conflicts: [],
  compatibleModes: ["interior", "architecture"],
}));
