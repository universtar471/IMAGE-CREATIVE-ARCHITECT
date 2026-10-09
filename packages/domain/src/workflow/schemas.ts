import { z } from "zod";

export const WORKFLOW_STEP_IDS = [
  "dna.building",
  "dna.context",
  "dna.references",
  "dna.camera",
  "dna.lighting",
  "generate.master",
  "generate.anchors",
  "generate.render",
  "post.grade",
] as const;

export const DNA_STEP_IDS = [
  "dna.building",
  "dna.context",
  "dna.references",
  "dna.camera",
  "dna.lighting",
] as const;

export const WorkflowStepIdSchema = z.enum(WORKFLOW_STEP_IDS);
export type WorkflowStepId = z.infer<typeof WorkflowStepIdSchema>;

export const DnaStepIdSchema = z.enum(DNA_STEP_IDS);
export type DnaStepId = z.infer<typeof DnaStepIdSchema>;

export const WorkflowStepStatusSchema = z.enum(["open", "confirmed", "needs_review"]);
export type WorkflowStepStatus = z.infer<typeof WorkflowStepStatusSchema>;

export const WorkflowStepStateSchema = z.object({
  stepId: DnaStepIdSchema,
  status: WorkflowStepStatusSchema,
  confirmedAt: z.string().nullable(),
});
export type WorkflowStepState = z.infer<typeof WorkflowStepStateSchema>;

export const WorkflowDTOSchema = z.object({
  steps: z.array(WorkflowStepStateSchema),
});
export type WorkflowDTO = z.infer<typeof WorkflowDTOSchema>;

export const WorkflowGetRequestSchema = z.object({
  projectId: z.string(),
});
export type WorkflowGetRequest = z.infer<typeof WorkflowGetRequestSchema>;

export const WorkflowConfirmStepRequestSchema = z.object({
  projectId: z.string(),
  stepId: DnaStepIdSchema,
});
export type WorkflowConfirmStepRequest = z.infer<typeof WorkflowConfirmStepRequestSchema>;

export const WorkflowReopenStepRequestSchema = z.object({
  projectId: z.string(),
  stepId: DnaStepIdSchema,
});
export type WorkflowReopenStepRequest = z.infer<typeof WorkflowReopenStepRequestSchema>;
