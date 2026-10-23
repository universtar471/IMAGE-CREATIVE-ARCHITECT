/**
 * Workspace module registry — the permanent left-navigation information architecture.
 * Future modules keep their fixed positions now; Phase N only flips `availableIn` to null
 * and plugs in a canvas view + property panel. `label` is the canonical English name; the UI
 * shows `modules.<id>.label` / `.description` from the i18n dictionaries.
 */
import {
  BookOpen,
  Aperture,
  Camera,
  Car,
  Clapperboard,
  Dna,
  Images,
  LayoutDashboard,
  MapPinned,
  Palette,
  Sofa,
  ScanSearch,
  ScanLine,
  Shapes,
  Sparkles,
  SunMedium,
  Wand2,
  type LucideIcon,
} from "lucide-react";

export type ModuleId =
  | "style"
  | "rooms"
  | "overview"
  | "design_dna"
  | "context"
  | "references"
  | "camera"
  | "detail"
  | "scene_objects"
  | "effects"
  | "lighting"
  | "mood_grade"
  | "generate"
  | "video"
  | "enhance"
  | "regions"
  | "diagram"
  | "export";

export const MODULE_GROUPS = ["create", "edit", "video", "publish"] as const;
export type ModuleGroup = (typeof MODULE_GROUPS)[number];

export type WorkspaceModule = {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  /**
   * Navigation group (V6.1, ADR-044, after ADR-039): Create image, Edit, Video, Publish.
   */
  group: ModuleGroup;
  /** Inside "Advanced DNA" of the Create group (collapsible; the DNA steps live here). */
  advanced?: boolean;
  /** Phase in which the module becomes functional; null = available now. */
  availableIn: number | null;
};

export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  { id: "style", label: "Style", icon: Palette, group: "create", availableIn: null },
  { id: "rooms", label: "Rooms", icon: Sofa, group: "create", availableIn: null },
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "create",
    availableIn: null,
  },
  {
    id: "generate",
    label: "Generate",
    icon: Sparkles,
    group: "create",
    availableIn: null,
  },
  {
    id: "design_dna",
    label: "Design DNA",
    icon: Dna,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "context",
    label: "Context",
    icon: MapPinned,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "references",
    label: "References",
    icon: Images,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "camera",
    label: "Camera",
    icon: Camera,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "lighting",
    label: "Lighting",
    icon: SunMedium,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "scene_objects",
    label: "Scene objects",
    icon: Car,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "effects",
    label: "Effects",
    icon: Aperture,
    group: "create",
    advanced: true,
    availableIn: null,
  },
  {
    id: "enhance",
    label: "Enhance",
    icon: Wand2,
    group: "edit",
    availableIn: null,
  },
  {
    id: "regions",
    label: "Region edit",
    icon: ScanSearch,
    group: "edit",
    availableIn: null,
  },
  {
    id: "mood_grade",
    label: "Mood / Grade",
    icon: Palette,
    group: "edit",
    availableIn: null,
  },
  {
    id: "detail",
    label: "Architectural detail",
    icon: ScanLine,
    group: "edit",
    availableIn: null,
  },
  {
    id: "video",
    label: "Video",
    icon: Clapperboard,
    group: "video",
    availableIn: null,
  },
  {
    id: "diagram",
    label: "Diagram",
    icon: Shapes,
    group: "publish",
    availableIn: null,
  },
  {
    id: "export",
    label: "Publishing Studio",
    icon: BookOpen,
    group: "publish",
    availableIn: null,
  },
];

/**
 * Modules whose centre is their own work surface (publishing layout, diagram, region drawing):
 * Node mode does not replace it, and the Studio/Node switch says why (ADR-044).
 */
export const OWN_CENTER_MODULES: readonly ModuleId[] = ["regions"];
export const hasOwnCenter = (id: ModuleId) => OWN_CENTER_MODULES.includes(id);

export const moduleById = (id: ModuleId) => WORKSPACE_MODULES.find((m) => m.id === id)!;
export const isFutureModule = (id: ModuleId) => moduleById(id).availableIn !== null;

/** Old links stay usable after interior controls move into Generate. */
export function workspaceModuleForProject(id: ModuleId, projectType?: string): ModuleId {
  if (id === "context") id = "design_dna";
  return projectType === "interior" &&
    ["design_dna", "style", "lighting", "effects", "references"].includes(id)
    ? "generate"
    : id;
}

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
