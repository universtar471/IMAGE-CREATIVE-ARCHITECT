import { describe, expect, it } from "vitest";
import {
  DNA_STEP_IDS,
  WORKFLOW_STEPS,
  confirmStep,
  deriveWorkflow,
  isGenerationAllowed,
  reopenStep,
  type WorkflowFacts,
  type WorkflowStepState,
} from "../src/lib/workflow";

const facts: WorkflowFacts = {
  masterApproved: false,
  anchorCameraIds: ["cam-a"],
  approvedAnchorCameraIds: [],
};

const open = (): WorkflowStepState[] =>
  DNA_STEP_IDS.map((stepId) => ({ stepId, status: "open", confirmedAt: null }));

describe("guided workflow contract", () => {
  it("keeps the stable ordered ids and unlocks only the next DNA step", () => {
    expect(WORKFLOW_STEPS.map((step) => step.id)).toEqual([
      "dna.building",
      "dna.context",
      "dna.references",
      "dna.camera",
      "dna.lighting",
      "generate.master",
      "generate.anchors",
      "generate.render",
      "post.grade",
    ]);
    const view = deriveWorkflow(open(), facts);
    expect(view.steps.find((step) => step.id === "dna.building")?.status).toBe("available");
    expect(view.steps.find((step) => step.id === "dna.context")?.status).toBe("locked");
    expect(view.steps.find((step) => step.id === "dna.context")?.blockedBy).toBe("dna.building");
  });

  it("confirms an unlocked step and rejects a locked step", () => {
    const confirmed = confirmStep(open(), "dna.building", "2026-10-10T00:00:00.000Z");
    expect(confirmed.find((step) => step.stepId === "dna.building")).toEqual({
      stepId: "dna.building",
      status: "confirmed",
      confirmedAt: "2026-10-10T00:00:00.000Z",
    });
    expect(() => confirmStep(open(), "dna.context", "2026-10-10T00:00:00.000Z")).toThrow(
      /dna\.building/,
    );
  });

  it("reopening cascades later confirmed DNA steps to needs_review", () => {
    const persisted = DNA_STEP_IDS.map((stepId, index) => ({
      stepId,
      status: index < 4 ? "confirmed" : "open",
      confirmedAt: index < 4 ? `2026-10-10T00:0${index}:00.000Z` : null,
    })) as WorkflowStepState[];
    const reopened = reopenStep(persisted, "dna.context");
    expect(reopened.map((step) => step.status)).toEqual([
      "confirmed",
      "open",
      "needs_review",
      "needs_review",
      "open",
    ]);
  });

  it("derives master, anchor, render and post states from facts", () => {
    const allConfirmed = DNA_STEP_IDS.map((stepId) => ({
      stepId,
      status: "confirmed" as const,
      confirmedAt: "2026-10-10T00:00:00.000Z",
    }));
    const master = deriveWorkflow(allConfirmed, { ...facts, masterApproved: true });
    expect(master.steps.find((step) => step.id === "generate.master")?.status).toBe("done");
    expect(master.steps.find((step) => step.id === "generate.anchors")?.status).toBe("available");
    expect(master.steps.find((step) => step.id === "generate.render")?.status).toBe("locked");
    expect(master.steps.find((step) => step.id === "post.grade")?.status).toBe("available");

    const anchored = deriveWorkflow(allConfirmed, {
      ...facts,
      masterApproved: true,
      approvedAnchorCameraIds: ["cam-a"],
    });
    expect(anchored.steps.find((step) => step.id === "generate.anchors")?.status).toBe("done");
    expect(anchored.steps.find((step) => step.id === "generate.render")?.status).toBe("available");

    const noAnchors = deriveWorkflow(allConfirmed, {
      masterApproved: true,
      anchorCameraIds: [],
      approvedAnchorCameraIds: [],
    });
    expect(noAnchors.steps.find((step) => step.id === "generate.anchors")?.status).toBe("skipped");
    expect(noAnchors.steps.find((step) => step.id === "generate.render")?.status).toBe("skipped");
    const newNoAnchors = deriveWorkflow(allConfirmed, {
      masterApproved: false,
      anchorCameraIds: [],
      approvedAnchorCameraIds: [],
    });
    expect(newNoAnchors.steps.find((step) => step.id === "generate.anchors")?.status).toBe(
      "skipped",
    );
  });

  it("enforces generation prerequisites by purpose", () => {
    expect(isGenerationAllowed("variation", open(), facts)).toEqual({
      allowed: false,
      blockedBy: "generate.master",
    });
    expect(isGenerationAllowed("hero", open(), facts)).toEqual({
      allowed: false,
      blockedBy: "dna.building",
    });
    const allConfirmed = DNA_STEP_IDS.map((stepId) => ({
      stepId,
      status: "confirmed" as const,
      confirmedAt: "2026-10-10T00:00:00.000Z",
    }));
    expect(isGenerationAllowed("hero", allConfirmed, facts)).toEqual({ allowed: true });
    expect(
      isGenerationAllowed("variation", allConfirmed, { ...facts, masterApproved: true }),
    ).toEqual({ allowed: true });
  });
});
