/**
 * Workspace module registry — the permanent left-navigation information architecture.
 * Future modules keep their fixed positions now; Phase N only flips `availableIn` to null
 * and plugs in a canvas view + property panel. `label` is the canonical English name; the UI
 * shows `modules.<id>.label` / `.description` from the i18n dictionaries.
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
};

export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "project",
    availableIn: null,
  },
  {
    id: "design_dna",
    label: "Design DNA",
    icon: Dna,
    group: "project",
    availableIn: null,
  },
  {
    id: "context",
    label: "Context",
    icon: MapPinned,
    group: "project",
    availableIn: null,
  },
  {
    id: "references",
    label: "References",
    icon: Images,
    group: "project",
    availableIn: null,
  },
  {
    id: "camera",
    label: "Camera",
    icon: Camera,
    group: "project",
    availableIn: null,
  },
  {
    id: "lighting",
    label: "Lighting",
    icon: SunMedium,
    group: "project",
    availableIn: null,
  },
  {
    id: "generate",
    label: "Generate",
    icon: Sparkles,
    group: "production",
    availableIn: null,
  },
  {
    id: "mood_grade",
    label: "Mood / Grade",
    icon: Palette,
    group: "production",
    availableIn: null,
  },
  {
    id: "enhance",
    label: "Enhance",
    icon: Wand2,
    group: "production",
    availableIn: 5,
  },
  {
    id: "qc",
    label: "QC",
    icon: ScanSearch,
    group: "production",
    availableIn: 6,
  },
  {
    id: "export",
    label: "Export",
    icon: Download,
    group: "production",
    availableIn: 9,
  },
];

export const moduleById = (id: ModuleId) => WORKSPACE_MODULES.find((m) => m.id === id)!;
export const isFutureModule = (id: ModuleId) => moduleById(id).availableIn !== null;

export type TrayTabId = "assets" | "versions" | "jobs" | "history";

export const TRAY_TABS: readonly {
  id: TrayTabId;
  label: string;
  availableIn: number | null;
}[] = [
  { id: "assets", label: "Assets", availableIn: null },
  { id: "versions", label: "Versions", availableIn: null },
  { id: "jobs", label: "Jobs", availableIn: null },
  { id: "history", label: "History", availableIn: null },
];
