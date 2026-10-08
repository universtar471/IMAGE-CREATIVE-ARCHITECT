import { z } from "zod";

export const PromptBundleSchema = z.object({
  compilerVersion: z.string(),
  positivePrompt: z.string(),
  negativePrompt: z.string(),
  referenceInstructions: z.string(),
  preservationInstructions: z.string(),
  metadata: z.record(z.string(), z.unknown()),
});

export type PromptBundle = z.infer<typeof PromptBundleSchema>;
