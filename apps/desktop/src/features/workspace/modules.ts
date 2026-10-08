/**
 * Workspace module registry — the permanent left-navigation information architecture.
 * Future modules keep their fixed positions now; Phase N only flips `availableIn` to null
 * and plugs in a canvas view + property panel.
 */
import {
  Camera,
  Download,
  Dna,
  Images,
  LayoutDashboard,
  MapPinned,
  Palette,
  ScanSearch,
  Sparkles,
  SunMedium,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export type ModuleId =
  | "overview"
  | "design_dna"
  | "context"
  | "references"
  | "camera"
  | "lighting"
  | "mood_grade"
  | "generate"
  | "enhance"
  | "qc"
  | "export";

export type WorkspaceModule = {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  group: "project" | "scene" | "production";
  /** Phase in which the module becomes functional; null = available now. */
  availableIn: number | null;
  description: string;
};

export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "project",
    availableIn: null,
    description: "Project summary, readiness and prompt preview.",
  },
  {
    id: "design_dna",
    label: "Design DNA",
    icon: Dna,
    group: "project",
    availableIn: null,
    description: "Building form, style, materials and colors.",
  },
  {
    id: "context",
    label: "Context",
    icon: MapPinned,
    group: "project",
    availableIn: null,
    description: "Site surroundings by direction.",
  },
  {
    id: "references",
    label: "References",
    icon: Images,
    group: "project",
    availableIn: null,
    description: "Imported images, roles and the master image.",
  },
  {
    id: "camera",
    label: "Camera",
    icon: Camera,
    group: "scene",
    availableIn: 3,
    description: "Camera presets, anchor views and the Camera Director.",
  },
  {
    id: "lighting",
    label: "Lighting",
    icon: SunMedium,
    group: "scene",
    availableIn: 4,
    description: "Sun, sky and artificial lighting systems.",
  },
  {
    id: "mood_grade",
    label: "Mood / Grade",
    icon: Palette,
    group: "scene",
    availableIn: 4,
    description: "Weather, mood presets and color grading.",
  },
  {
    id: "generate",
    label: "Generate",
    icon: Sparkles,
    group: "production",
    availableIn: 2,
    description: "Provider-neutral image generation and the hero workflow.",
  },
  {
    id: "enhance",
    label: "Enhance",
    icon: Wand2,
    group: "production",
    availableIn: 5,
    description: "Upscale to 2K/4K with architecture preservation.",
  },
  {
    id: "qc",
    label: "QC",
    icon: ScanSearch,
    group: "production",
    availableIn: 6,
    description: "Vision QC scores, overlays and repair requests.",
  },
  {
    id: "export",
    label: "Export",
    icon: Download,
    group: "production",
    availableIn: 9,
    description: "Presentation, social and contact-sheet export presets.",
  },
];

export const moduleById = (id: ModuleId) => WORKSPACE_MODULES.find((m) => m.id === id)!;
export const isFutureModule = (id: ModuleId) => moduleById(id).availableIn !== null;

export type TrayTabId = "assets" | "versions" | "jobs" | "history";

export const TRAY_TABS: readonly {
  id: TrayTabId;
  label: string;
  availableIn: number | null;
  note: string;
}[] = [
  { id: "assets", label: "Assets", availableIn: null, note: "" },
  {
    id: "versions",
    label: "Versions",
    availableIn: null,
    note: "Import lineage now; version tree arrives with generation in Phase 2.",
  },
  {
    id: "jobs",
    label: "Jobs",
    availableIn: 3,
    note: "The job queue (generation, upscale, QC) becomes functional in Phase 3.",
  },
  {
    id: "history",
    label: "History",
    availableIn: 2,
    note: "Generation and edit history arrives in Phase 2.",
  },
];
