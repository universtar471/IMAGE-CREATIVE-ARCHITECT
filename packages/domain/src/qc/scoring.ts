import {
  QC_CATEGORIES,
  type QcLocal,
  type QcResult,
  type QcThresholds,
  type QcVision,
} from "./schemas";

export type QcScoreResult = { overall: number | null; result: QcResult };

/** Apply the ADR-024 result rules to a completed local and optional vision run. */
export function scoreReport(
  local: QcLocal,
  vision: QcVision | null,
  thresholds: QcThresholds,
): QcScoreResult {
  const values = vision ? QC_CATEGORIES.map((category) => vision.scores[category]) : null;
  const overall = values
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : local.edgeAlignment;

  if (overall === null) return { overall: null, result: "unscored" };

  const categoryFails = values?.some((value) => value < thresholds.categoryMin) ?? false;
  const artifactFails =
    thresholds.highArtifactFails &&
    (vision?.artifacts.some((artifact) => artifact.severity === "high") ?? false);
  if (categoryFails || overall < thresholds.passMin || artifactFails) {
    return { overall, result: "fail" };
  }
  if (overall < thresholds.passMin + 10) return { overall, result: "warn" };
  return { overall, result: "pass" };
}
