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

describe("derived workflow", () => {
  it("starts a new project with only Building available", () => {
    const view = deriveWorkflow([], facts());
    expect(view.steps.map(({ id, status, blockedBy }) => [id, status, blockedBy])).toEqual([
      ["dna.building", "available", undefined],
      ["dna.context", "locked", "dna.building"],
      ["dna.references", "locked", "dna.context"],
      ["dna.camera", "locked", "dna.references"],
      ["dna.lighting", "locked", "dna.camera"],
      ["generate.master", "locked", "dna.building"],
      ["generate.anchors", "locked", "dna.building"],
      ["generate.render", "locked", "dna.building"],
      ["post.grade", "locked", "generate.master"],
    ]);
    expect(view.stages).toEqual({
      dna: { unlocked: true, complete: false },
      generate: { unlocked: false, complete: false },
      post: { unlocked: false, complete: false },
    });
  });

  it("unlocks the chain one confirmed DNA step at a time", () => {
    const one = deriveWorkflow(
      [{ stepId: "dna.building", status: "confirmed", confirmedAt: "now" }],
      facts(),
    );
    expect(one.steps[1]).toMatchObject({ id: "dna.context", status: "available" });
    expect(one.steps[2]).toMatchObject({
      id: "dna.references",
      status: "locked",
      blockedBy: "dna.context",
    });

    const completeDna = deriveWorkflow(allConfirmed(), facts());
    expect(completeDna.steps[4]).toMatchObject({ id: "dna.lighting", status: "confirmed" });
    expect(completeDna.steps[5]).toMatchObject({ id: "generate.master", status: "available" });
    expect(completeDna.stages.dna).toEqual({ unlocked: true, complete: true });
    expect(completeDna.stages.generate).toEqual({ unlocked: true, complete: false });
  });

  it("does not treat needs_review as confirmed", () => {
    const view = deriveWorkflow(
      [{ stepId: "dna.building", status: "needs_review", confirmedAt: "old" }],
      facts(),
    );
    expect(view.steps[0]).toMatchObject({ status: "needs_review" });
    expect(view.steps[1]).toMatchObject({ status: "locked", blockedBy: "dna.building" });
  });

  it("derives anchors and render, including the no-camera skips", () => {
    const noCameras = deriveWorkflow(allConfirmed(), facts({ masterApproved: true }));
    expect(noCameras.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generate.master", status: "done" }),
        expect.objectContaining({ id: "generate.anchors", status: "skipped" }),
        expect.objectContaining({ id: "generate.render", status: "skipped" }),
        expect.objectContaining({ id: "post.grade", status: "available" }),
      ]),
    );

    const nonAnchorCamera = deriveWorkflow(
      allConfirmed(),
      facts({ masterApproved: true, cameraIds: ["CAM_1"] }),
    );
    expect(nonAnchorCamera.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generate.anchors", status: "skipped" }),
        expect.objectContaining({ id: "generate.render", status: "available" }),
      ]),
    );

    const pendingAnchor = deriveWorkflow(
      allConfirmed(),
      facts({
        masterApproved: true,
        anchorCameraIds: ["CAM_1", "CAM_2"],
        approvedAnchorCameraIds: ["CAM_1"],
      }),
    );
    expect(pendingAnchor.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generate.anchors", status: "available" }),
        expect.objectContaining({
          id: "generate.render",
          status: "locked",
          blockedBy: "generate.anchors",
        }),
      ]),
    );

    const allAnchored = deriveWorkflow(
      allConfirmed(),
      facts({
        masterApproved: true,
        anchorCameraIds: ["CAM_1"],
        approvedAnchorCameraIds: ["CAM_1"],
      }),
    );
    expect(allAnchored.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "generate.anchors", status: "done" }),
        expect.objectContaining({ id: "generate.render", status: "available" }),
      ]),
    );
  });

  it("locks every generate step behind reopened DNA even when the master is approved", () => {
    const reopened = reopenStep(allConfirmed(), "dna.context");
    const view = deriveWorkflow(
      reopened,
      facts({
        masterApproved: true,
        anchorCameraIds: ["CAM_1"],
        cameraIds: ["CAM_1"],
        approvedAnchorCameraIds: ["CAM_1"],
      }),
    );
    expect(view.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "generate.master",
          status: "locked",
          blockedBy: "dna.context",
        }),
        expect.objectContaining({
          id: "generate.anchors",
          status: "locked",
          blockedBy: "dna.context",
        }),
        expect.objectContaining({
          id: "generate.render",
          status: "locked",
          blockedBy: "dna.context",
        }),
      ]),
    );
    for (const purpose of ["hero", "anchor", "production"] as const) {
      expect(
        isGenerationAllowed(purpose, reopened, {
          masterApproved: true,
          anchorCameraIds: ["CAM_1"],
          cameraIds: ["CAM_1"],
          approvedAnchorCameraIds: ["CAM_1"],
        }),
      ).toEqual({ ok: false, blockedBy: "dna.context" });
    }
    expect(isGenerationAllowed("variation", reopened, facts({ masterApproved: true }))).toEqual({
      ok: true,
    });

    let reconfirmed = confirmStep(reopened, "dna.context", "later");
    for (const stepId of ["dna.references", "dna.camera", "dna.lighting"] as const) {
      reconfirmed = confirmStep(reopenStep(reconfirmed, stepId), stepId, "later");
    }
    expect(deriveWorkflow(reconfirmed, facts({ masterApproved: true })).steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "generate.master", status: "done" })]),
    );
  });
});

describe("workflow persistence helpers", () => {
  it("confirms only the currently available DNA step and returns a new array", () => {
    const persisted: WorkflowStepState[] = [];
    const next = confirmStep(persisted, "dna.building", "2026-10-10T01:02:03.000Z");
    expect(next).toEqual([
      { stepId: "dna.building", status: "confirmed", confirmedAt: "2026-10-10T01:02:03.000Z" },
    ]);
    expect(next).not.toBe(persisted);
    expect(persisted).toEqual([]);
    expect(confirmStep(next, "dna.context", "later")).toEqual([
      next[0],
      { stepId: "dna.context", status: "confirmed", confirmedAt: "later" },
    ]);
  });

  it("reopens a step and cascades later confirmed DNA steps to needs_review", () => {
    const persisted = allConfirmed();
    const next = reopenStep(persisted, "dna.context");
    expect(next).toEqual([
      persisted[0],
      { stepId: "dna.context", status: "open", confirmedAt: null },
      { stepId: "dna.references", status: "needs_review", confirmedAt: "2026-10-10T00:00:00.000Z" },
      { stepId: "dna.camera", status: "needs_review", confirmedAt: "2026-10-10T00:00:00.000Z" },
      { stepId: "dna.lighting", status: "needs_review", confirmedAt: "2026-10-10T00:00:00.000Z" },
    ]);
    expect(next).not.toBe(persisted);
    expect(persisted.every((row) => row.status === "confirmed")).toBe(true);
  });

  it("reports invalid, locked, and non-reopenable operations", () => {
    expect(() => confirmStep([], "generate.master", "now")).toThrow(/DNA step/i);
    expect(() => confirmStep([], "dna.context", "now")).toThrow(/locked|previous/i);
    expect(() =>
      confirmStep(
        [{ stepId: "dna.building", status: "confirmed", confirmedAt: "now" }],
        "dna.building",
        "later",
      ),
    ).toThrow(/locked|confirmed/i);
    expect(() => reopenStep([], "dna.building")).toThrow(/confirmed|needs_review/i);
    expect(() => reopenStep([], "generate.master")).toThrow(/DNA step/i);
  });

  it("does not confirm a cascaded needs_review step until it is reopened", () => {
    const reopened = reopenStep(allConfirmed(), "dna.context");
    const reviewed = confirmStep(reopened, "dna.context", "reviewed");
    expect(() => confirmStep(reviewed, "dna.references", "later")).toThrow(/locked|reopen/i);
  });
});

describe("generation workflow gating", () => {
  it.each([
    ["hero", "dna.building"],
    ["anchor", "dna.building"],
    ["production", "dna.building"],
  ] as const)("blocks %s on the first unfinished DNA step", (purpose, blockedBy) => {
    expect(isGenerationAllowed(purpose, [], facts())).toEqual({ ok: false, blockedBy });
  });

  it("gates each purpose at its own prerequisite", () => {
    const masterFacts = facts({
      masterApproved: true,
      anchorCameraIds: ["CAM_1"],
      approvedAnchorCameraIds: [],
    });
    expect(isGenerationAllowed("hero", allConfirmed(), masterFacts)).toEqual({ ok: true });
    expect(isGenerationAllowed("variation", [], masterFacts)).toEqual({ ok: true });
    expect(isGenerationAllowed("anchor", allConfirmed(), facts())).toEqual({
      ok: false,
      blockedBy: "generate.master",
    });
    expect(isGenerationAllowed("production", allConfirmed(), masterFacts)).toEqual({
      ok: false,
      blockedBy: "generate.anchors",
    });
    expect(
      isGenerationAllowed(
        "production",
        allConfirmed(),
        facts({
          masterApproved: true,
          anchorCameraIds: ["CAM_1"],
          approvedAnchorCameraIds: ["CAM_1"],
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("allows variation with an approved master even when DNA is not confirmed", () => {
    expect(isGenerationAllowed("variation", [], facts({ masterApproved: true }))).toEqual({
      ok: true,
    });
    expect(isGenerationAllowed("variation", [], facts())).toEqual({
      ok: false,
      blockedBy: "generate.master",
    });
  });
});
