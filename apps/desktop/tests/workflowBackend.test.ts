import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../src/app/services";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
});

afterEach(() => setTransport(null));

describe("mock workflow commands", () => {
  it("returns all five open rows and persists confirm/reopen cascade", async () => {
    const project = await createProject({
      name: "Workflow",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    expect((await call("workflow_get", { projectId: project.id })).steps).toHaveLength(5);
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.building" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.context" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.references" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.camera" });
    const reopened = await call("workflow_reopen_step", {
      projectId: project.id,
      stepId: "dna.context",
    });
    expect(reopened.steps.map((step) => step.status)).toEqual([
      "confirmed",
      "open",
      "needs_review",
      "needs_review",
      "open",
    ]);
  });

  it("rejects confirming an out-of-order DNA step", async () => {
    const project = await createProject({
      name: "Workflow lock",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    await expect(
      call("workflow_confirm_step", { projectId: project.id, stepId: "dna.lighting" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects confirming a cascaded needs_review step", async () => {
    const project = await createProject({
      name: "Workflow review",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    for (const stepId of ["dna.building", "dna.context", "dna.references"] as const) {
      await call("workflow_confirm_step", { projectId: project.id, stepId });
    }
    await call("workflow_reopen_step", { projectId: project.id, stepId: "dna.context" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.context" });
    await expect(
      call("workflow_confirm_step", { projectId: project.id, stepId: "dna.references" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
