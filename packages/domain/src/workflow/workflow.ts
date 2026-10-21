import {
  DNA_STEP_IDS,
  DnaStepIdSchema,
  type DnaStepId,
  type WorkflowStepId,
  type WorkflowStepState,
} from "./schemas";
import type { GenerationPurpose } from "../schemas/generation";

export type WorkflowStage = "dna" | "generate" | "post";
export type WorkflowModuleId =
  "design_dna" | "context" | "references" | "camera" | "lighting" | "generate" | "mood_grade";
export type WorkflowViewStatus =
  "locked" | "available" | "confirmed" | "needs_review" | "done" | "skipped";

export type WorkflowStepDefinition = {
  id: WorkflowStepId;
  stage: WorkflowStage;
  moduleId: WorkflowModuleId;
};

export const WORKFLOW_STEPS = [
  { id: "dna.building", stage: "dna", moduleId: "design_dna" },
  { id: "dna.context", stage: "dna", moduleId: "context" },
  { id: "dna.references", stage: "dna", moduleId: "references" },
  { id: "dna.camera", stage: "dna", moduleId: "camera" },
  { id: "dna.lighting", stage: "dna", moduleId: "lighting" },
  { id: "generate.master", stage: "generate", moduleId: "generate" },
  { id: "generate.anchors", stage: "generate", moduleId: "generate" },
  { id: "generate.render", stage: "generate", moduleId: "generate" },
  { id: "post.grade", stage: "post", moduleId: "mood_grade" },
] as const satisfies readonly WorkflowStepDefinition[];

export type WorkflowFacts = {
  masterApproved: boolean;
  anchorCameraIds: readonly string[];
  approvedAnchorCameraIds: readonly string[];
  /** The contract's minimum facts omit non-anchor cameras; callers may provide them for render. */
  cameraIds?: readonly string[];
  /**
   * The request carries a validated source image. Hero and image-editing operations then
   * need neither confirmed DNA nor Master approval. Progress is advisory for every purpose.
   */
  hasSourceImage?: boolean;
};

export type WorkflowViewStep = {
  id: WorkflowStepId;
  stage: WorkflowStage;
  moduleId: WorkflowModuleId;
  status: WorkflowViewStatus;
  blockedBy?: WorkflowStepId;
};

export type WorkflowStageSummary = { unlocked: boolean; complete: boolean };
export type WorkflowView = {
  steps: WorkflowViewStep[];
  stages: Record<WorkflowStage, WorkflowStageSummary>;
};

const persistedStatus = (
  persisted: readonly WorkflowStepState[],
  id: DnaStepId,
): WorkflowStepState =>
  persisted.find((row) => row.stepId === id) ?? {
    stepId: id,
    status: "open",
    confirmedAt: null,
  };

const hasAllAnchors = (facts: WorkflowFacts) =>
  facts.anchorCameraIds.every((id) => facts.approvedAnchorCameraIds.includes(id));

export function deriveWorkflow(
  persisted: readonly WorkflowStepState[],
  facts: WorkflowFacts,
): WorkflowView {
  const dnaRows = DNA_STEP_IDS.map((id) => persistedStatus(persisted, id));
  // Confirmations record progress; they do not gate access to other tools.
  const masterStatus: WorkflowViewStatus = facts.masterApproved ? "done" : "available";
  const anchorsStatus: WorkflowViewStatus =
    facts.anchorCameraIds.length === 0 ? "skipped" : hasAllAnchors(facts) ? "done" : "available";
  const cameraCount = facts.cameraIds?.length ?? facts.anchorCameraIds.length;
  const renderStatus: WorkflowViewStatus = cameraCount === 0 ? "skipped" : "available";

  const steps: WorkflowViewStep[] = DNA_STEP_IDS.map((id, index) => {
    const row = dnaRows[index]!;
    if (row.status === "confirmed" || row.status === "needs_review") {
      return { id, stage: "dna", moduleId: WORKFLOW_STEPS[index]!.moduleId, status: row.status };
    }
    return { id, stage: "dna", moduleId: WORKFLOW_STEPS[index]!.moduleId, status: "available" };
  });
  steps.push(
    { id: "generate.master", stage: "generate", moduleId: "generate", status: masterStatus },
    { id: "generate.anchors", stage: "generate", moduleId: "generate", status: anchorsStatus },
    { id: "generate.render", stage: "generate", moduleId: "generate", status: renderStatus },
    { id: "post.grade", stage: "post", moduleId: "mood_grade", status: "available" },
  );

  const stageSteps = (stage: WorkflowStage) => steps.filter((step) => step.stage === stage);
  const stageSummary = (stage: WorkflowStage): WorkflowStageSummary => {
    const items = stageSteps(stage);
    return {
      unlocked: items.some((step) => !["locked", "skipped"].includes(step.status)),
      complete: items.every((step) => ["confirmed", "done", "skipped"].includes(step.status)),
    };
  };

  return {
    steps,
    stages: {
      dna: stageSummary("dna"),
      generate: stageSummary("generate"),
      post: stageSummary("post"),
    },
  };
}

function assertDnaStep(stepId: string): asserts stepId is DnaStepId {
  if (!DnaStepIdSchema.safeParse(stepId).success) {
    throw new Error(
      `Invalid workflow step: ${stepId}. Only DNA steps can be confirmed or reopened.`,
    );
  }
}

export function confirmStep(
  persisted: readonly WorkflowStepState[],
  stepId: DnaStepId | string,
  now: string,
): WorkflowStepState[] {
  assertDnaStep(stepId);
  const current = persistedStatus(persisted, stepId);
  if (current.status === "confirmed" || current.status === "needs_review") {
    throw new Error(`Workflow step ${stepId} is locked; reopen it before confirming again.`);
  }
  const next = persisted.map((row) => ({ ...row }));
  const existing = next.findIndex((row) => row.stepId === stepId);
  const confirmed = { stepId, status: "confirmed" as const, confirmedAt: now };
  if (existing === -1) next.push(confirmed);
  else next[existing] = confirmed;
  return next;
}

export function reopenStep(
  persisted: readonly WorkflowStepState[],
  stepId: DnaStepId | string,
): WorkflowStepState[] {
  assertDnaStep(stepId);
  const current = persistedStatus(persisted, stepId);
  if (current.status !== "confirmed" && current.status !== "needs_review") {
    throw new Error(
      `Workflow step ${stepId} is not confirmed or needs_review and cannot be reopened.`,
    );
  }
  return persisted.map((row) => {
    if (row.stepId === stepId) return { ...row, status: "open", confirmedAt: null };
    return { ...row };
  });
}

/**
 * Whether a reference counts as the source image of a quick generate (mirrors Rust
 * `workflow::is_source_image`): sketches, ordinary imported images, the master and AI outputs.
 * Reference images keep their reference role unless explicitly used by an editing operation.
 */
export function isQuickSourceImage(asset: {
  role: string;
  source: string;
  mediaKind?: string;
  mimeType?: string | null;
}): boolean {
  if (asset.mediaKind === "video" || asset.mimeType?.startsWith("video/")) return false;
  return (
    asset.role === "structure_sketch" ||
    asset.role === "master_architecture" ||
    asset.role === "regular_image" ||
    asset.source === "ai_generated"
  );
}

export type GenerationAllowed = { ok: true } | { ok: false; blockedBy: WorkflowStepId };

/** Compatibility helper for batch/tool callers: progress is advisory, never a prerequisite. */
export function isGenerationAllowed(
  _purpose: GenerationPurpose,
  _persisted: readonly WorkflowStepState[],
  _facts: WorkflowFacts,
): GenerationAllowed {
  return { ok: true };
}
