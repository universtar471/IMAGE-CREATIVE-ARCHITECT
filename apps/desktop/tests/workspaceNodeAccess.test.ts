import { expect, it } from "vitest";
import { hasOwnCenter } from "../src/features/workspace/modules";
it("allows the lineage graph in diagram and publication workspaces", () => {
  expect(hasOwnCenter("diagram")).toBe(false);
  expect(hasOwnCenter("export")).toBe(false);
  expect(hasOwnCenter("regions")).toBe(true);
});
