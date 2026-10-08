import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectDnaJsonSchemaText } from "../src/jsonSchema";

describe("exported JSON Schema", () => {
  it("matches the checked-in file used by the Rust backend (run `npm run schema:export`)", () => {
    const checkedIn = readFileSync(
      new URL("../schema/project-dna.schema.json", import.meta.url),
      "utf8",
    );
    expect(checkedIn.replace(/\r\n/g, "\n")).toBe(projectDnaJsonSchemaText());
  });
});
