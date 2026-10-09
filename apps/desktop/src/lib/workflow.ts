/** TODO(wf-domain): replace this stand-in with the shared @arch/domain workflow module. */

export const DNA_STEP_IDS = [
  "dna.building",
  "dna.context",
  "dna.references",
  "dna.camera",
  "dna.lighting",
] as const;

export type DnaStepId = (typeof DNA_STEP_IDS)[number];
export type WorkflowStepId =
  DnaStepId | "generate.master" | "generate.anchors" | "generate.render" | "post.grade";
export type WorkflowStepStatus =
  "locked" | "available" | "confirmed" | "needs_review" | "done" | "skipped";
export type PersistedWorkflowStatus = "open" | "confirmed" | "needs_review";
export type WorkflowStepState = {
  stepId: DnaStepId;
  status: PersistedWorkflowStatus;
  confirmedAt: string | null;
};
export type WorkflowFacts = {
  masterApproved: boolean;
  anchorCameraIds: string[];
  approvedAnchorCameraIds: string[];
};
export type WorkflowStep = {
  id: WorkflowStepId;
  stage: "dna" | "generate" | "post";
  module: string;
  label: string;
};
export type DerivedWorkflowStep = WorkflowStep & {
  status: WorkflowStepStatus;
  blockedBy?: WorkflowStepId;
};
export type WorkflowStageSummary = { unlocked: boolean; complete: boolean };
export type DerivedWorkflow = {
  steps: DerivedWorkflowStep[];
  stages: Record<"dna" | "generate" | "post", WorkflowStageSummary>;
};

export const WORKFLOW_STEPS: readonly WorkflowStep[] = [
  { id: "dna.building", stage: "dna", module: "design_dna", label: "Building" },
  { id: "dna.context", stage: "dna", module: "context", label: "Context" },
  { id: "dna.references", stage: "dna", module: "references", label: "References" },
  { id: "dna.camera", stage: "dna", module: "camera", label: "Camera" },
  { id: "dna.lighting", stage: "dna", module: "lighting", label: "Lighting" },
  { id: "generate.master", stage: "generate", module: "generate", label: "Master image" },
  { id: "generate.anchors", stage: "generate", module: "generate", label: "Anchors" },
  { id: "generate.render", stage: "generate", module: "generate", label: "Camera renders" },
  { id: "post.grade", stage: "post", module: "mood_grade", label: "Mood / Grade" },
];

const isDna = (id: string): id is DnaStepId => (DNA_STEP_IDS as readonly string[]).includes(id);

function normalizedPersisted(persisted: readonly WorkflowStepState[]): WorkflowStepState[] {
  return DNA_STEP_IDS.map((stepId) => {
    const row = persisted.find((item) => item.stepId === stepId);
    return row ? { ...row } : { stepId, status: "open", confirmedAt: null };
  });
}

function firstUnconfirmed(rows: readonly WorkflowStepState[]): DnaStepId | undefined {
  return rows.find((row) => row.status !== "confirmed")?.stepId;
}

export function deriveWorkflow(
  persisted: readonly WorkflowStepState[],
  facts: WorkflowFacts,
): DerivedWorkflow {
  const rows = normalizedPersisted(persisted);
  const firstDnaBlock = firstUnconfirmed(rows);
  const steps: DerivedWorkflowStep[] = [];

  rows.forEach((row, index) => {
    const definition = WORKFLOW_STEPS[index]!;
    const previous = index === 0 ? undefined : rows[index - 1];
    const status: WorkflowStepStatus =
      row.status === "confirmed"
        ? "confirmed"
        : row.status === "needs_review"
          ? "needs_review"
          : previous?.status === "confirmed" || index === 0
            ? "available"
            : "locked";
    steps.push({
      ...definition,
      status,
      ...(status === "locked" ? { blockedBy: previous!.stepId } : {}),
    });
  });

  const dnaConfirmed = rows.every((row) => row.status === "confirmed");
  const master = WORKFLOW_STEPS[5]!;
  const anchors = WORKFLOW_STEPS[6]!;
  const render = WORKFLOW_STEPS[7]!;
  const post = WORKFLOW_STEPS[8]!;
  const masterStatus: WorkflowStepStatus = facts.masterApproved
    ? "done"
    : dnaConfirmed
      ? "available"
      : "locked";
  steps.push({
    ...master,
    status: masterStatus,
    ...(masterStatus === "locked" ? { blockedBy: firstDnaBlock ?? "dna.building" } : {}),
  });

  const anchorsDone =
    facts.anchorCameraIds.length === 0
      ? true
      : facts.anchorCameraIds.every((id) => facts.approvedAnchorCameraIds.includes(id));
  const anchorStatus: WorkflowStepStatus =
    facts.anchorCameraIds.length === 0
      ? "skipped"
      : !facts.masterApproved
        ? "locked"
        : anchorsDone
          ? "done"
          : "available";
  steps.push({
    ...anchors,
    status: anchorStatus,
    ...(anchorStatus === "locked" ? { blockedBy: "generate.master" } : {}),
  });

  const renderStatus: WorkflowStepStatus =
    facts.anchorCameraIds.length === 0
      ? "skipped"
      : !facts.masterApproved
        ? "locked"
        : anchorsDone
          ? "available"
          : "locked";
  steps.push({
    ...render,
    status: renderStatus,
    ...(renderStatus === "locked"
      ? { blockedBy: facts.masterApproved ? "generate.anchors" : "generate.master" }
      : {}),
  });

  const postStatus: WorkflowStepStatus = facts.masterApproved ? "available" : "locked";
  steps.push({
    ...post,
    status: postStatus,
    ...(postStatus === "locked" ? { blockedBy: "generate.master" } : {}),
  });

  const dnaSteps = steps.slice(0, 5);
  const generateSteps = steps.slice(5, 8);
  const postSteps = steps.slice(8);
  return {
    steps,
    stages: {
      dna: {
        unlocked: dnaSteps.some((step) => step.status !== "locked"),
        complete: dnaSteps.every((step) => step.status === "confirmed"),
      },
      generate: {
        unlocked: generateSteps.some((step) => step.status !== "locked"),
        complete: generateSteps.every(
          (step) => step.status === "done" || step.status === "skipped",
        ),
      },
      post: {
        unlocked: postSteps.some((step) => step.status !== "locked"),
        complete: postSteps.every((step) => step.status === "done" || step.status === "skipped"),
      },
    },
  };
}

export function confirmStep(
  persisted: readonly WorkflowStepState[],
  stepId: string,
  now: string,
): WorkflowStepState[] {
  if (!isDna(stepId)) throw new Error(`Invalid workflow step '${stepId}'.`);
  const rows = normalizedPersisted(persisted);
  const index = DNA_STEP_IDS.indexOf(stepId);
  if (index > 0 && rows[index - 1]!.status !== "confirmed") {
    throw new Error(`Cannot confirm '${stepId}': finish '${rows[index - 1]!.stepId}' first.`);
  }
  rows[index] = { stepId, status: "confirmed", confirmedAt: now };
  return rows;
}

export function reopenStep(
  persisted: readonly WorkflowStepState[],
  stepId: string,
): WorkflowStepState[] {
  if (!isDna(stepId)) throw new Error(`Invalid workflow step '${stepId}'.`);
  const rows = normalizedPersisted(persisted);
  const index = DNA_STEP_IDS.indexOf(stepId);
  if (rows[index]!.status !== "confirmed" && rows[index]!.status !== "needs_review") {
    throw new Error(`Cannot reopen '${stepId}': it is not confirmed.`);
  }
  rows[index] = { stepId, status: "open", confirmedAt: null };
  for (let i = index + 1; i < rows.length; i++) {
    if (rows[i]!.status === "confirmed") rows[i] = { ...rows[i]!, status: "needs_review" };
  }
  return rows;
}

export function isGenerationAllowed(
  purpose: "hero" | "anchor" | "production" | "variation",
  persisted: readonly WorkflowStepState[],
  facts: WorkflowFacts,
): { allowed: true } | { allowed: false; blockedBy: WorkflowStepId } {
  const rows = normalizedPersisted(persisted);
  const firstDna = firstUnconfirmed(rows);
  if (purpose !== "variation" && firstDna) return { allowed: false, blockedBy: firstDna };
  if (purpose === "variation") {
    return facts.masterApproved
      ? { allowed: true }
      : { allowed: false, blockedBy: "generate.master" };
  }
  if (purpose === "hero") return { allowed: true };
  if (!facts.masterApproved) return { allowed: false, blockedBy: "generate.master" };
  if (purpose === "anchor") return { allowed: true };
  const anchorsDone = facts.anchorCameraIds.every((id) =>
    facts.approvedAnchorCameraIds.includes(id),
  );
  return anchorsDone ? { allowed: true } : { allowed: false, blockedBy: "generate.anchors" };
}
