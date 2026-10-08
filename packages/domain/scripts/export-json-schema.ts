/**
 * Export the ProjectDNA JSON Schema from the Zod source of truth.
 * The Rust backend embeds this file to validate DNA before persistence.
 * Run: npm run schema:export   (a test fails if the checked-in file drifts)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projectDnaJsonSchemaText } from "../src/jsonSchema";

const target = fileURLToPath(new URL("../schema/project-dna.schema.json", import.meta.url));
writeFileSync(target, projectDnaJsonSchemaText());
console.log(`wrote ${target}`);
