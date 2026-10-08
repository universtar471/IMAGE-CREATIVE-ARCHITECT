import { z } from "zod";
import { ProjectDNASchema } from "./schemas/projectDna";

/** Canonical JSON Schema text for persisted (fully parsed) ProjectDNA. */
export function projectDnaJsonSchemaText(): string {
  const schema = z.toJSONSchema(ProjectDNASchema, { io: "output", target: "draft-2020-12" });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
