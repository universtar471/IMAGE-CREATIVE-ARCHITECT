/**
 * MP4 timeline (ADR-037): built only from approved steps, as static frames that pan, zoom
 * or appear. Deterministic: the first frame appears, the rest alternate zoom and pan.
 */
import { allDiagramStepsApproved } from "./planner";
import type { DiagramPlan, DiagramVideoMotion } from "./schemas";

export const DIAGRAM_VIDEO_DEFAULTS = {
  durationMs: 3000,
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

export type DiagramTimelineEntry = {
  stepId: string;
  durationMs: number;
  motion: DiagramVideoMotion;
};

export class DiagramNotApprovedError extends Error {
  constructor() {
    super("Every diagram step must be approved before the video is built.");
    this.name = "DiagramNotApprovedError";
  }
}

export function diagramVideoTimeline(
  plan: Pick<DiagramPlan, "steps">,
  durationMs: number = DIAGRAM_VIDEO_DEFAULTS.durationMs,
): DiagramTimelineEntry[] {
  if (!allDiagramStepsApproved(plan)) throw new DiagramNotApprovedError();
  return plan.steps.map((step, i) => ({
    stepId: step.id,
    durationMs,
    motion: i === 0 ? "appear" : i % 2 === 1 ? "zoom" : "pan",
  }));
}
