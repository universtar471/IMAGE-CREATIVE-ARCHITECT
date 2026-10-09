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

const dnaIndex = (id: DnaStepId) => DNA_STEP_IDS.indexOf(id);
const firstUnconfirmed = (persisted: readonly WorkflowStepState[]): DnaStepId | undefined => {
  const byId = new Map(persisted.map((row) => [row.stepId, row]));
  return DNA_STEP_IDS.find((id) => byId.get(id)?.status !== "confirmed");
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
  const dnaComplete = dnaRows.every((row) => row.status === "confirmed");
  const firstBlocked = firstUnconfirmed(persisted);
  const masterStatus: WorkflowViewStatus = !dnaComplete
    ? "locked"
    : facts.masterApproved
      ? "done"
      : "available";
  const anchorsStatus: WorkflowViewStatus = !dnaComplete
    ? "locked"
    : facts.anchorCameraIds.length === 0
      ? "skipped"
      : !facts.masterApproved
        ? "locked"
        : hasAllAnchors(facts)
          ? "done"
          : "available";
  const cameraCount = facts.cameraIds?.length ?? facts.anchorCameraIds.length;
  const renderStatus: WorkflowViewStatus = !dnaComplete
    ? "locked"
    : cameraCount === 0
      ? "skipped"
      : !facts.masterApproved
        ? "locked"
        : anchorsStatus === "done" || anchorsStatus === "skipped"
          ? "available"
          : "locked";

  const steps: WorkflowViewStep[] = DNA_STEP_IDS.map((id, index) => {
    const row = dnaRows[index]!;
    if (row.status === "confirmed" || row.status === "needs_review") {
      return { id, stage: "dna", moduleId: WORKFLOW_STEPS[index]!.moduleId, status: row.status };
    }
    const unlocked = index === 0 || dnaRows[index - 1]!.status === "confirmed";
    return {
      id,
      stage: "dna",
      moduleId: WORKFLOW_STEPS[index]!.moduleId,
      status: unlocked ? "available" : "locked",
      ...(unlocked ? {} : { blockedBy: DNA_STEP_IDS[index - 1]! }),
    };
  });

  steps.push(
    {
      id: "generate.master",
      stage: "generate",
      moduleId: "generate",
      status: masterStatus,
      ...(masterStatus === "locked" ? { blockedBy: firstBlocked ?? "dna.building" } : {}),
    },
    {
      id: "generate.anchors",
      stage: "generate",
      moduleId: "generate",
      status: anchorsStatus,
      ...(anchorsStatus === "locked"
        ? { blockedBy: dnaComplete ? "generate.master" : (firstBlocked ?? "dna.building") }
        : {}),
    },
    {
      id: "generate.render",
      stage: "generate",
      moduleId: "generate",
      status: renderStatus,
      ...(renderStatus === "locked"
        ? {
            blockedBy: !dnaComplete
              ? (firstBlocked ?? "dna.building")
              : facts.masterApproved
                ? "generate.anchors"
                : "generate.master",
          }
        : {}),
    },
    {
      id: "post.grade",
      stage: "post",
      moduleId: "mood_grade",
      status: facts.masterApproved ? "available" : "locked",
      ...(!facts.masterApproved ? { blockedBy: "generate.master" } : {}),
    },
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
  const index = dnaIndex(stepId);
  if (current.status === "confirmed" || current.status === "needs_review") {
    throw new Error(`Workflow step ${stepId} is locked; reopen it before confirming again.`);
  }
  if (index > 0 && persistedStatus(persisted, DNA_STEP_IDS[index - 1]!).status !== "confirmed") {
    throw new Error(`Workflow step ${stepId} is locked; finish ${DNA_STEP_IDS[index - 1]!} first.`);
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
  const index = dnaIndex(stepId);
  const current = persistedStatus(persisted, stepId);
  if (current.status !== "confirmed" && current.status !== "needs_review") {
    throw new Error(
      `Workflow step ${stepId} is not confirmed or needs_review and cannot be reopened.`,
    );
  }
  return persisted.map((row) => {
    const rowIndex = dnaIndex(row.stepId);
    if (row.stepId === stepId) return { ...row, status: "open", confirmedAt: null };
    if (rowIndex > index && row.status === "confirmed") return { ...row, status: "needs_review" };
    return { ...row };
  });
}

export type GenerationAllowed = { ok: true } | { ok: false; blockedBy: WorkflowStepId };

export function isGenerationAllowed(
  purpose: GenerationPurpose,
  persisted: readonly WorkflowStepState[],
  facts: WorkflowFacts,
): GenerationAllowed {
  const first = firstUnconfirmed(persisted);
  if (purpose !== "variation" && purpose !== "enhance" && purpose !== "repair" && first)
    return { ok: false, blockedBy: first };
  if (purpose === "variation" || purpose === "enhance" || purpose === "repair") {
    return facts.masterApproved ? { ok: true } : { ok: false, blockedBy: "generate.master" };
  }
  if ((purpose === "anchor" || purpose === "production") && !facts.masterApproved) {
    return { ok: false, blockedBy: "generate.master" };
  }
  if (purpose === "production" && !hasAllAnchors(facts)) {
    return { ok: false, blockedBy: "generate.anchors" };
  }
  return { ok: true };
}
