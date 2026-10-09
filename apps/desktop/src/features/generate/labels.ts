/** Badge tones per status; the status names themselves are in the i18n dictionaries. */
import type { GenerationStatus, JobStatus } from "@arch/domain";

export const GENERATION_STATUS_TONE: Record<GenerationStatus, string> = {
  queued: "badge-neutral",
  running: "badge-info",
  completed: "badge-success",
  failed: "badge-danger",
  interrupted: "badge-warning",
  cancelled: "badge-neutral",
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
