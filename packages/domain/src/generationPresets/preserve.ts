import type { GenerationPreset, PreserveKey } from "./schema";
const labels: Record<PreserveKey, [string, string, string]> = {
  layout: [
    "Bố cục",
    "Layout",
    "Keep the spatial layout, circulation, object positions and functional relationships exactly as in the source.",
  ],
  camera: [
    "Camera",
    "Camera",
    "Keep the original viewpoint, perspective, camera height, viewing direction, horizon and framing exactly.",
  ],
  architecture: [
    "Kiến trúc",
    "Architecture",
    "Keep the original architectural shell, walls, structural geometry, doors, windows, openings and room proportions exactly. Do not add or remove architectural elements.",
  ],
  furniture: [
    "Nội thất",
    "Furniture",
    "Keep the existing furniture identity, count, shapes, placement and scale exactly. Do not replace, add, remove or relocate furniture.",
  ],
  materials: [
    "Vật liệu",
    "Materials",
    "Keep the original materials, finishes, colors and texture identity exactly. Improve physical material response and texture realism without substituting materials or colors.",
  ],
};
export const GENERATION_PRESERVE: GenerationPreset<PreserveKey>[] = Object.entries(labels).map(
  ([id, [vi, en, promptFragment]]) => ({
    id: id as PreserveKey,
    label: { vi, en },
    description: { vi: `Giữ nguyên ${vi.toLowerCase()} của ảnh gốc.`, en: promptFragment },
    icon: `icon-lock-${id === "materials" ? "material" : id}`,
    promptFragment,
    negativeFragment: "",
    defaults: {},
    constraints: ["hard"],
    conflicts: ["instruction", "style", "reference"],
    compatibleModes: ["interior", "architecture"],
  }),
);
