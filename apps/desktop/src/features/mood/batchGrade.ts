/**
 * Batch Color Grading V5.3. Pure selectors + sequential job executor.
 * Uses the same grade_apply backend as the single-photo editor; every successful
 * call creates a separate, non-destructive AssetDTO + version in the repository.
 */
import type { AssetDTO, ColorGradeDNA } from "@arch/domain";

export type BatchSourceFilter = "generated" | "all" | "ungraded";
export type BatchItemStatus = "pending" | "processing" | "completed" | "failed";
export type BatchItemResult = {
  assetId: string;
  status: BatchItemStatus;
  outputAssetId?: string;
  error?: string;
};

export const GRADE_FIELDS = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
  "clarity",
  "dehaze",
] as const;

/** Only ready project assets; no pseudo-rooms inferred from filenames or geometry. */
export function batchSourceAssets(
  assets: readonly AssetDTO[],
  source: BatchSourceFilter,
): AssetDTO[] {
  return assets
    .filter(
      (a) =>
        a.status === "ready" &&
        !!a.mimeType?.startsWith("image/") &&
        (source === "all" ||
          (source === "ungraded"
            ? a.operation !== "color_grade"
            : a.source === "ai_generated" || a.operation === "color_grade")),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function searchBatchAssets(assets: readonly AssetDTO[], text: string): AssetDTO[] {
  const query = text.trim().toLocaleLowerCase();
  if (!query) return [...assets];
  return assets.filter((asset) =>
    [asset.originalName, asset.id, asset.source, asset.operation].some((part) =>
      part?.toLocaleLowerCase().includes(query),
    ),
  );
}

/** Applies only the ids in the current filter; leaves other selections untouched. */
export function selectFilteredIds(
  selectedIds: ReadonlySet<string>,
  visibleIds: readonly string[],
  select: boolean,
): Set<string> {
  const updated = new Set(selectedIds);
  for (const id of visibleIds) {
    if (select) updated.add(id);
    else updated.delete(id);
  }
  return updated;
}

/** Scale the *actual* grade input, so the large preview and native saved image match. */
export function gradeAtIntensity(grade: ColorGradeDNA, intensity: number): ColorGradeDNA {
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 100) {
    throw new Error("Grade intensity must be between 0 and 100.");
  }
  const result: ColorGradeDNA = { ...grade };
  for (const field of GRADE_FIELDS) result[field] = ((grade[field] ?? 0) * intensity) / 100;
  return result;
}

export type BatchProgress = {
  completed: number;
  failed: number;
  attempted: number;
  total: number;
  cancelled: boolean;
};

/**
 * Each invoke is awaited to bound memory and avoid writing multiple huge images
 * concurrently. Cancellation is cooperative BETWEEN calls, never during a DB write.
 * Errors are isolated per image. The caller owns refreshing the asset list ONCE.
 */
export async function runBatchGrade(options: {
  assetIds: readonly string[];
  grade: ColorGradeDNA;
  label: string;
  apply: (assetId: string, grade: ColorGradeDNA, label: string) => Promise<{ id: string }>;
  shouldCancel?: () => boolean;
  onItem?: (result: BatchItemResult, progress: BatchProgress) => void;
}): Promise<{ results: BatchItemResult[]; progress: BatchProgress }> {
  const uniqueIds = [...new Set(options.assetIds)];
  const progress: BatchProgress = {
    completed: 0,
    failed: 0,
    attempted: 0,
    total: uniqueIds.length,
    cancelled: false,
  };
  const results: BatchItemResult[] = [];
  for (const id of uniqueIds) {
    if (options.shouldCancel?.()) {
      progress.cancelled = true;
      break;
    }
    let result: BatchItemResult;
    try {
      const output = await options.apply(id, options.grade, options.label);
      result = { assetId: id, outputAssetId: output.id, status: "completed" };
      progress.completed++;
    } catch (error) {
      result = {
        assetId: id,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      progress.failed++;
    }
    progress.attempted++;
    results.push(result);
    // Outside the try: a throwing progress callback must not turn a saved image into a failure.
    options.onItem?.(result, { ...progress });
  }
  return { results, progress };
}
