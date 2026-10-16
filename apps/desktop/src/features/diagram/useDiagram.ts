/**
 * Diagram Studio session state (ADR-037), shared by the property panel and the canvas.
 * Kept per open project for the session; nothing here is written into the DNA.
 */
import { create } from "zustand";
import {
  approveDiagramStep,
  editDiagramStep,
  planDiagram,
  setDiagramStepFrame,
  type DiagramLanguage,
  type DiagramLayout,
  type DiagramPlan,
  type DiagramSources,
  type DiagramStepPatch,
  type DiagramType,
  type ProjectDNA,
  type ProjectType,
} from "@arch/domain";

export type StepChoice = 4 | 6 | 8 | "custom";

export type DiagramConfig = {
  sourceAssetId: string | null;
  type: DiagramType;
  stepChoice: StepChoice;
  customCount: number;
  layout: DiagramLayout;
  lang: DiagramLanguage;
  sources: DiagramSources;
};

export const DEFAULT_DIAGRAM_CONFIG: DiagramConfig = {
  sourceAssetId: null,
  type: "concept_evolution",
  stepChoice: 6,
  customCount: 5,
  layout: "2x3",
  lang: "vi",
  sources: { floorPlan: false, elevation: false, model3d: false },
};

export const stepCountOf = (config: Pick<DiagramConfig, "stepChoice" | "customCount">) =>
  config.stepChoice === "custom" ? config.customCount : config.stepChoice;

type DiagramState = {
  projectId: string | null;
  config: DiagramConfig;
  plan: DiagramPlan | null;
  /** Bumped by every change of the sheet, so previews re-render once per change. */
  revision: number;
  /** Bind the state to `projectId`; another project starts from the defaults. */
  ensureProject: (projectId: string) => void;
  configure: (patch: Partial<DiagramConfig>) => void;
  makePlan: (dna: ProjectDNA, projectType: ProjectType) => void;
  editStep: (stepId: string, patch: DiagramStepPatch) => void;
  approveStep: (stepId: string, approved: boolean) => void;
  setFrames: (frames: Record<string, string | null>) => void;
};

export const useDiagram = create<DiagramState>((set, get) => ({
  projectId: null,
  config: DEFAULT_DIAGRAM_CONFIG,
  plan: null,
  revision: 0,
  ensureProject: (projectId) => {
    if (get().projectId !== projectId)
      set({ projectId, config: DEFAULT_DIAGRAM_CONFIG, plan: null, revision: 0 });
  },
  configure: (patch) =>
    set((s) => ({ config: { ...s.config, ...patch }, revision: s.revision + 1 })),
  makePlan: (dna, projectType) => {
    const { config } = get();
    const plan = planDiagram(dna, config.type, stepCountOf(config), {
      projectType,
      sources: config.sources,
    });
    set((s) => ({ plan, revision: s.revision + 1 }));
  },
  editStep: (stepId, patch) => {
    const plan = get().plan;
    if (!plan) return;
    set((s) => ({ plan: editDiagramStep(plan, stepId, patch), revision: s.revision + 1 }));
  },
  approveStep: (stepId, approved) => {
    const plan = get().plan;
    if (!plan) return;
    set((s) => ({ plan: approveDiagramStep(plan, stepId, approved), revision: s.revision + 1 }));
  },
  setFrames: (frames) => {
    let plan = get().plan;
    if (!plan) return;
    for (const [stepId, assetId] of Object.entries(frames))
      plan = setDiagramStepFrame(plan, stepId, assetId);
    set((s) => ({ plan, revision: s.revision + 1 }));
  },
}));
