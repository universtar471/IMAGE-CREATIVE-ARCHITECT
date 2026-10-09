import { z } from "zod";
import { ProjectDNASchema } from "./schemas/projectDna";

/** Canonical JSON Schema text for persisted (fully parsed) ProjectDNA. */
export function projectDnaJsonSchemaText(): string {
  const schema = z.toJSONSchema(ProjectDNASchema, { io: "output", target: "draft-2020-12" }) as {
    properties?: { locks?: { required?: string[] } };
  };
  // `mood` was added in Phase 4; old persisted DNA may omit it and Zod still supplies false.
  const lockRequired = schema.properties?.locks?.required;
  if (lockRequired)
    schema.properties!.locks!.required = lockRequired.filter((key) => key !== "mood");
  return `${JSON.stringify(schema, null, 2)}\n`;
}
