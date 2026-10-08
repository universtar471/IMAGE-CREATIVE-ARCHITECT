import type { GenerationPurpose, GenerationStatus, JobStatus } from "@arch/domain";

export const GENERATION_STATUS_LABELS: Record<GenerationStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
};

export const GENERATION_STATUS_TONE: Record<GenerationStatus, string> = {
  queued: "badge-neutral",
  running: "badge-info",
  completed: "badge-success",
  failed: "badge-danger",
  interrupted: "badge-warning",
  cancelled: "badge-neutral",
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  retrying: "Retrying",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export const JOB_STATUS_TONE: Record<JobStatus, string> = {
  queued: "badge-neutral",
  running: "badge-info",
  retrying: "badge-warning",
  completed: "badge-success",
  failed: "badge-danger",
  cancelled: "badge-neutral",
  interrupted: "badge-warning",
};

export const PURPOSE_LABELS: Record<GenerationPurpose, string> = {
  hero: "Hero",
  variation: "Variation",
  anchor: "Anchor",
  production: "Production",
};

/** Generation statuses that can still change. */
export const isActiveGeneration = (s: GenerationStatus) => s === "queued" || s === "running";

/** "0:07", "1:05", "1:02:03" */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
