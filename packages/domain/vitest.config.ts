import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "domain",
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
