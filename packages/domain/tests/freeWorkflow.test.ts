import { expect, it } from "vitest";
import { confirmStep, deriveWorkflow, isGenerationAllowed } from "../src";

const facts = { masterApproved: false, anchorCameraIds: ["CAM_1"], approvedAnchorCameraIds: [] };
it("keeps every workflow section available without ordered confirmations", () => {
  expect(deriveWorkflow([], facts).steps.every((step) => step.status !== "locked")).toBe(true);
  expect(confirmStep([], "dna.lighting", "now")[0]?.status).toBe("confirmed");
});
it.each(["hero", "variation", "anchor", "production", "enhance", "region_edit"] as const)(
  "%s has no workflow approval gate",
  (purpose) => {
    expect(isGenerationAllowed(purpose, [], facts)).toEqual({ ok: true });
  },
);
