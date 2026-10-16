/**
 * Export the JSON Schemas the Rust backend embeds from the Zod source of truth:
 * ProjectDNA (validated before persistence) and the stored publication document (SRS P5b).
 * Run: npm run schema:export   (a test fails if a checked-in file drifts)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { projectDnaJsonSchemaText, publicationDocumentJsonSchemaText } from "../src/jsonSchema";

const dnaTarget =
  process.argv[2] ?? fileURLToPath(new URL("../schema/project-dna.schema.json", import.meta.url));
writeFileSync(dnaTarget, projectDnaJsonSchemaText());
console.log(`wrote ${dnaTarget}`);

const publicationTarget =
  process.argv[3] ??
  fileURLToPath(new URL("../schema/publication-document.schema.json", import.meta.url));
writeFileSync(publicationTarget, publicationDocumentJsonSchemaText());
console.log(`wrote ${publicationTarget}`);
