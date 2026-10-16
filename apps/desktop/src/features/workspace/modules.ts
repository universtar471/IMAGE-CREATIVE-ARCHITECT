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
  Dna,
  GalleryVerticalEnd,
  Images,
  LayoutDashboard,
  MapPinned,
  Palette,
  ScanSearch,
  ScanLine,
  Shapes,
  SlidersHorizontal,
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
  | "detail"
  | "scene_objects"
  | "effects"
  | "lighting"
  | "mood_grade"
  | "generate"
  | "enhance"
  | "regions"
  | "diagram"
  | "export";

export type WorkspaceModule = {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  group: "overview" | "dna" | "generate" | "post" | "export";
  /** Phase in which the module becomes functional; null = available now. */
  availableIn: number | null;
};

export const WORKSPACE_MODULES: readonly WorkspaceModule[] = [
  {
    id: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    group: "overview",
    availableIn: null,
  },
  {
    id: "design_dna",
    label: "Design DNA",
    icon: Dna,
    group: "dna",
    availableIn: null,
  },
  {
    id: "context",
    label: "Context",
    icon: MapPinned,
    group: "dna",
    availableIn: null,
  },
  {
    id: "references",
    label: "References",
    icon: Images,
    group: "dna",
    availableIn: null,
  },
  {
    id: "camera",
    label: "Camera",
    icon: Camera,
    group: "dna",
    availableIn: null,
  },
  {
    id: "detail",
    label: "Architectural detail",
    icon: ScanLine,
    group: "dna",
    availableIn: null,
  },
  {
    id: "scene_objects",
    label: "Scene objects",
    icon: Car,
    group: "dna",
    availableIn: null,
  },
  {
    id: "effects",
    label: "Effects",
    icon: Aperture,
    group: "dna",
    availableIn: null,
  },
  {
    id: "lighting",
    label: "Lighting",
    icon: SunMedium,
    group: "dna",
    availableIn: null,
  },
  {
    id: "generate",
    label: "Generate",
    icon: Sparkles,
    group: "generate",
    availableIn: null,
  },
  {
    id: "mood_grade",
    label: "Mood / Grade",
    icon: Palette,
    group: "post",
    availableIn: null,
  },
  {
    id: "enhance",
    label: "Enhance",
    icon: Wand2,
    group: "post",
    availableIn: null,
  },
  {
    id: "regions",
    label: "Region edit",
    icon: ScanSearch,
    group: "post",
    availableIn: null,
  },
  {
    id: "diagram",
    label: "Diagram",
    icon: Shapes,
    group: "post",
    availableIn: null,
  },
  {
    id: "export",
    label: "Publishing Studio",
    icon: BookOpen,
    group: "export",
    availableIn: null,
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

/**
 * ADR-040 sections: the five entries of the left navigation. A section is a grouping over
 * modules (`library` has none: it is its own center view). `ModuleId`/`activeModule` stay
 * the source of truth; each section remembers its last module in the store (never the DNA).
 */
export type SectionId = "create" | "library" | "edit" | "present" | "studio";

export type WorkspaceSection = {
  id: SectionId;
  icon: LucideIcon;
  /** Modules of the section in ADR-040 order; the first is the default. */
  modules: readonly ModuleId[];
};

export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  { id: "create", icon: Sparkles, modules: ["generate"] },
  { id: "library", icon: GalleryVerticalEnd, modules: [] },
  { id: "edit", icon: Wand2, modules: ["mood_grade", "enhance", "regions"] },
  { id: "present", icon: BookOpen, modules: ["export", "diagram"] },
  {
    id: "studio",
    icon: SlidersHorizontal,
    modules: [
      "overview",
      "design_dna",
      "context",
      "references",
      "camera",
      "detail",
      "scene_objects",
      "effects",
      "lighting",
    ],
  },
];

/** Sections whose modules are switched by a tab strip above the center area. */
export const TABBED_SECTIONS: readonly SectionId[] = ["edit", "present"];

export type ModuleSectionId = Exclude<SectionId, "library">;

export const sectionById = (id: SectionId) => WORKSPACE_SECTIONS.find((s) => s.id === id)!;

/** The section that owns a module (every module belongs to exactly one). */
export function sectionOfModule(id: ModuleId): ModuleSectionId {
  return WORKSPACE_SECTIONS.find((s) => s.modules.includes(id))!.id as ModuleSectionId;
}

/** Last module per section; starts at each section's first module. */
export type SectionModules = Record<ModuleSectionId, ModuleId>;

export const defaultSectionModules = (): SectionModules => ({
  create: "generate",
  edit: "mood_grade",
  present: "export",
  studio: "overview",
});
