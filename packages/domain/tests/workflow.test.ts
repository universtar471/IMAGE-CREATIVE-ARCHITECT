import { describe, expect, it } from "vitest";
import {
  DnaStepIdSchema,
  WorkflowConfirmStepRequestSchema,
  WorkflowDTOSchema,
  WorkflowGetRequestSchema,
  WorkflowReopenStepRequestSchema,
  WorkflowStepIdSchema,
  confirmStep,
  deriveWorkflow,
  isGenerationAllowed,
  reopenStep,
  type WorkflowFacts,
  type WorkflowStepState,
} from "../src";

const dnaIds = [
  "dna.building",
  "dna.context",
  "dna.references",
  "dna.camera",
  "dna.lighting",
] as const;

const allConfirmed = (confirmedAt = "2026-10-10T00:00:00.000Z"): WorkflowStepState[] =>
  dnaIds.map((stepId) => ({ stepId, status: "confirmed", confirmedAt }));

const facts = (over: Partial<WorkflowFacts> = {}): WorkflowFacts => ({
  masterApproved: false,
  anchorCameraIds: [],
  approvedAnchorCameraIds: [],
  ...over,
});

describe("workflow schemas", () => {
  it("accepts exactly the stable step ids and persisted DNA states", () => {
    expect(WorkflowStepIdSchema.options).toHaveLength(9);
    expect(DnaStepIdSchema.options).toEqual(dnaIds);
    expect(WorkflowDTOSchema.parse({ steps: allConfirmed() }).steps).toHaveLength(5);
    expect(
      WorkflowDTOSchema.safeParse({
        steps: [{ stepId: "generate.master", status: "open", confirmedAt: null }],
      }).success,
    ).toBe(false);
  });

  it("parses the three workflow request shapes", () => {
    expect(WorkflowGetRequestSchema.parse({ projectId: "PRJ_1" })).toEqual({
      projectId: "PRJ_1",
    });
    expect(
      WorkflowConfirmStepRequestSchema.parse({ projectId: "PRJ_1", stepId: "dna.camera" }),
    ).toEqual({ projectId: "PRJ_1", stepId: "dna.camera" });
    expect(
      WorkflowConfirmStepRequestSchema.parse({ projectId: "PRJ_1", stepId: "generate.master" }),
    ).toEqual({ projectId: "PRJ_1", stepId: "generate.master" });
    expect(
      WorkflowReopenStepRequestSchema.parse({ projectId: "PRJ_1", stepId: "dna.camera" }),
    ).toEqual({ projectId: "PRJ_1", stepId: "dna.camera" });
  });
});

describe("advisory workflow", () => {
  it("keeps every section accessible, including pending anchors and unapproved Master", () => {
    const view = deriveWorkflow([], facts({ anchorCameraIds: ["CAM_1"], cameraIds: ["CAM_1"] }));
    expect(view.steps.every((step) => step.status === "available" && !step.blockedBy)).toBe(true);
    expect(Object.values(view.stages).every((stage) => stage.unlocked && !stage.complete)).toBe(
      true,
    );
  });
  it("preserves confirmed/reviewed progress without locking later sections", () => {
    const rows = allConfirmed().map((row) =>
      row.stepId === "dna.context" ? { ...row, status: "needs_review" as const } : row,
    );
    const view = deriveWorkflow(
      rows,
      facts({ masterApproved: true, anchorCameraIds: ["CAM_1"], cameraIds: ["CAM_1"] }),
    );
    expect(view.steps[1]?.status).toBe("needs_review");
    expect(view.steps.find((step) => step.id === "generate.master")?.status).toBe("done");
    expect(view.steps.find((step) => step.id === "generate.render")?.status).toBe("available");
    expect(view.steps.some((step) => step.status === "locked")).toBe(false);
  });
  it("retains no-camera skips and completed anchor summaries", () => {
    const view = deriveWorkflow(allConfirmed(), facts());
    expect(view.steps.filter((step) => step.status === "skipped").map((step) => step.id)).toEqual([
      "generate.anchors",
      "generate.render",
    ]);
    const anchored = deriveWorkflow(
      [],
      facts({ anchorCameraIds: ["CAM_1"], approvedAnchorCameraIds: ["CAM_1"] }),
    );
    expect(anchored.steps.find((step) => step.id === "generate.anchors")?.status).toBe("done");
  });
  it("confirms in any order without mutating the source rows", () => {
    const rows: WorkflowStepState[] = [];
    const next = confirmStep(rows, "dna.lighting", "now");
    expect(rows).toEqual([]);
    expect(next).toEqual([{ stepId: "dna.lighting", status: "confirmed", confirmedAt: "now" }]);
  });
  it("reopening preserves later confirmations and never relocks generation", () => {
    const rows = allConfirmed();
    const reopened = reopenStep(rows, "dna.context");
    expect(rows.every((row) => row.status === "confirmed")).toBe(true);
    expect(reopened.slice(2)).toEqual(rows.slice(2));
    expect(deriveWorkflow(reopened, facts()).steps.some((step) => step.status === "locked")).toBe(
      false,
    );
    expect(confirmStep(reopened, "dna.context", "later")[1]?.status).toBe("confirmed");
  });
  it("rejects invalid ids, duplicate confirmations and reopening open steps", () => {
    expect(() => confirmStep([], "generate.master", "now")).toThrow(/DNA step/i);
    expect(() => confirmStep(allConfirmed(), "dna.building", "now")).toThrow(/reopen/i);
    expect(() => reopenStep([], "dna.camera")).toThrow(/confirmed|needs_review/i);
    expect(() => reopenStep([], "generate.master")).toThrow(/DNA step/i);
  });
  it("keeps legacy needs_review confirmations explicit", () => {
    const rows = [
      { stepId: "dna.context" as const, status: "needs_review" as const, confirmedAt: "old" },
    ];
    expect(() => confirmStep(rows, "dna.context", "now")).toThrow(/reopen/i);
    expect(confirmStep(reopenStep(rows, "dna.context"), "dna.context", "now")[0]?.status).toBe(
      "confirmed",
    );
  });
  it.each([
    "hero",
    "variation",
    "anchor",
    "production",
    "enhance",
    "region_edit",
    "video",
  ] as const)("%s does not depend on workflow progress", (purpose) => {
    expect(isGenerationAllowed(purpose, [], facts())).toEqual({ ok: true });
    expect(
      isGenerationAllowed(purpose, reopenStep(allConfirmed(), "dna.context"), facts()),
    ).toEqual({ ok: true });
  });
});
