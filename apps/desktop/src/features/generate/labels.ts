import type { GenerationPurpose, GenerationStatus } from "@arch/domain";

export const GENERATION_STATUS_LABELS: Record<GenerationStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

export const GENERATION_STATUS_TONE: Record<GenerationStatus, string> = {
  running: "badge-info",
  completed: "badge-success",
  failed: "badge-danger",
  interrupted: "badge-warning",
};

export const PURPOSE_LABELS: Record<GenerationPurpose, string> = {
  hero: "Hero",
  variation: "Variation",
};

/** "0:07", "1:05", "1:02:03" */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
