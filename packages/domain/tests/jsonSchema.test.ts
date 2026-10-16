import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectDnaJsonSchemaText, publicationDocumentJsonSchemaText } from "../src/jsonSchema";

const checkedIn = (name: string) =>
  readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("exported JSON Schema", () => {
  it("matches the checked-in file used by the Rust backend (run `npm run schema:export`)", () => {
    expect(checkedIn("project-dna.schema.json")).toBe(projectDnaJsonSchemaText());
  });

  it("matches the checked-in publication document schema (run `npm run schema:export`)", () => {
    expect(checkedIn("publication-document.schema.json")).toBe(publicationDocumentJsonSchemaText());
  });
});
