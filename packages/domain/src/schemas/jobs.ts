/**
 * Phase 3 job queue, batch and camera-anchor contracts (see docs/API_CONTRACTS.md §10).
 * The Rust backend serializes these in camelCase; the UI parses every response with them.
 */
import { z } from "zod";
import {
  GenerationErrorSchema,
  GenerationParamsSchema,
  GenerationPurposeSchema,
} from "./generation";
import { PromptBundleSchema } from "./prompt";

/**
 * Job lifecycle (ADR-017). `retrying` = a retryable attempt failed and the job waits for
 * `nextAttemptAt`. Terminal: completed, failed, cancelled, interrupted.
 */
export const JobStatusSchema = z.enum([
  "queued",
  "running",
  "retrying",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "interrupted",
];

export const JobDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  batchId: z.string().nullable(),
  /** Every Phase 3 job runs exactly one generation. */
  generationId: z.string(),
  cameraId: z.string().nullable(),
  providerId: z.string(),
  modelId: z.string(),
  /** Short display label, e.g. "Front corner — anchor". */
  label: z.string(),
  status: JobStatusSchema,
  /** Higher runs first; ties run in creation order. */
  priority: z.number().int(),
  /** Attempts started so far (0 while first queued). */
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string().nullable(),
  /** Last attempt's error (also set while `retrying`). */
  error: GenerationErrorSchema.nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type JobDTO = z.infer<typeof JobDTOSchema>;

export const BatchItemSchema = z.object({
  cameraId: z.string().nullable(),
  label: z.string().trim().min(1),
  /** Compiled in the UI per item (ADR-008), stored verbatim on the generation. */
  prompt: PromptBundleSchema,
  referenceAssetIds: z.array(z.string()),
  params: GenerationParamsSchema,
});
export type BatchItem = z.infer<typeof BatchItemSchema>;

export const BatchCreateRequestSchema = z
  .object({
    projectId: z.string(),
    name: z.string().trim().min(1),
    providerId: z.string(),
    modelId: z.string(),
    purpose: GenerationPurposeSchema,
    priority: z.number().int().min(-10).max(10).default(0),
    items: z.array(BatchItemSchema).min(1).max(50),
  })
  .superRefine((value, ctx) => {
    if (value.purpose !== "enhance") return;
    value.items.forEach((item, index) => {
      const enhance = item.params.enhance;
      if (!enhance) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "params", "enhance"],
          message: "params.enhance is required when purpose is enhance.",
        });
        return;
      }
      if (enhance.mode === "conservative" && enhance.targetLongEdge === null) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "params", "enhance", "targetLongEdge"],
          message: "Conservative enhancement requires targetLongEdge.",
        });
      }
      if (enhance.mode === "conservative" && value.providerId !== "local_upscale") {
        ctx.addIssue({
          code: "custom",
          path: ["providerId"],
          message: 'Conservative enhancement requires providerId "local_upscale".',
        });
      }
    });
  });
export type BatchCreateRequest = z.infer<typeof BatchCreateRequestSchema>;

export const JobCountsSchema = z.object(
  Object.fromEntries(
    JobStatusSchema.options.map((s) => [s, z.number().int().nonnegative()]),
  ) as Record<JobStatus, z.ZodNumber>,
);
export type JobCounts = z.infer<typeof JobCountsSchema>;

export const BatchDTOSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  purpose: GenerationPurposeSchema,
  createdAt: z.string(),
  /** In item order. */
  jobIds: z.array(z.string()),
  counts: JobCountsSchema,
});
export type BatchDTO = z.infer<typeof BatchDTOSchema>;

/** The approved anchor image of one anchor-view camera (ADR-016). */
export const CameraAnchorDTOSchema = z.object({
  projectId: z.string(),
  cameraId: z.string(),
  assetId: z.string(),
  approvedAt: z.string(),
});
export type CameraAnchorDTO = z.infer<typeof CameraAnchorDTOSchema>;

/** Payloads of backend → UI events (Tauri `emit`). */
export const JOB_UPDATED_EVENT = "job://updated";
export const GENERATION_UPDATED_EVENT = "generation://updated";
