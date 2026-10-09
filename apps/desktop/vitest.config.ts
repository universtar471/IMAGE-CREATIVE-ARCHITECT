import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineProject({
  server: { fs: { allow: [repoRoot] } },
  test: {
    name: "desktop",
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
  },
});
