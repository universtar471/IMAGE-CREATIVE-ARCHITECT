import { describe, expect, it, vi } from "vitest";
import { GRADE_LOOKS, type AssetDTO } from "@arch/domain";
import {
  batchSourceAssets,
  gradeAtIntensity,
  runBatchGrade,
  searchBatchAssets,
  selectFilteredIds,
} from "../src/features/mood/batchGrade";

const asset = (id: string, overrides: Partial<AssetDTO> = {}): AssetDTO => ({
  id,
  projectId: "p1",
  source: "ai_generated",
  role: "regular_image",
  status: "ready",
  originalName: `Photo ${id}.png`,
  managedRelPath: `${id}.png`,
  absolutePath: `/tmp/${id}.png`,
  thumbnailPath: `/tmp/${id}-thumb.png`,
  mimeType: "image/png",
  fileSizeBytes: 12,
  widthPx: 200,
  heightPx: 150,
  sha256: null,
  parentAssetId: null,
  operation: null,
  createdAt: "2026-10-15T11:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  ...overrides,
});

describe("Batch Color Grade V5.3", () => {
  it("lists only ready images by default, with verified filters", () => {
    const assets = [
      asset("gen"),
      asset("import", { source: "external" }),
      asset("grade", { source: "external", operation: "color_grade" }),
      asset("missing", { status: "missing_file" }),
      asset("text", { mimeType: "text/plain" }),
    ];
    expect(batchSourceAssets(assets, "generated").map((a) => a.id)).toEqual(["gen", "grade"]);
    expect(batchSourceAssets(assets, "ungraded").map((a) => a.id)).toEqual(["gen", "import"]);
    expect(batchSourceAssets(assets, "all")).toHaveLength(3);
  });

  it("selects every currently filtered asset without changing selections elsewhere", () => {
    const starting = new Set(["a", "unrelated"]);
    expect([...selectFilteredIds(starting, ["a", "b", "c"], true)]).toEqual([
      "a",
      "unrelated",
      "b",
      "c",
    ]);
    expect([...selectFilteredIds(starting, ["a", "b", "c"], false)]).toEqual(["unrelated"]);
    expect(starting.has("a")).toBe(true);
  });

  it("searches actual metadata, no fabricated space labels", () => {
    expect(
      searchBatchAssets([asset("a", { originalName: "Front-01.png" }), asset("b")], "front").map(
        (a) => a.id,
      ),
    ).toEqual(["a"]);
  });

  it("scales the actual grade, preserving the look identifier", () => {
    const grade = GRADE_LOOKS.warm_tropical;
    const result = gradeAtIntensity(grade, 50);
    expect(result.temperature).toBe(grade.temperature / 2);
    expect(result.contrast).toBe(grade.contrast / 2);
    expect(result.look).toBe(grade.look);
    expect(gradeAtIntensity(grade, 0).temperature).toBe(0);
    expect(() => gradeAtIntensity(grade, 101)).toThrow();
  });

  it("processes sequentially, persists successful items and isolates failures", async () => {
    const visited: string[] = [];
    const apply = vi.fn(async (id: string) => {
      visited.push(id);
      if (id === "b") throw new Error("Disk busy");
      return { id: `out-${id}` };
    });
    const { results, progress } = await runBatchGrade({
      assetIds: ["a", "b", "c", "a"],
      grade: GRADE_LOOKS.neutral,
      label: "test",
      apply,
    });
    expect(visited).toEqual(["a", "b", "c"]);
    expect(progress).toEqual({ completed: 2, failed: 1, attempted: 3, total: 3, cancelled: false });
    expect(results[1]).toEqual({ assetId: "b", status: "failed", error: "Disk busy" });
    expect(results[2]?.outputAssetId).toBe("out-c");
  });

  it("cooperatively cancels between writes without losing completed work", async () => {
    let stop = false;
    const { progress, results } = await runBatchGrade({
      assetIds: ["a", "b", "c"],
      grade: GRADE_LOOKS.neutral,
      label: "test",
      apply: async (id) => {
        stop = true;
        return { id: `saved-${id}` };
      },
      shouldCancel: () => stop,
    });
    expect(progress.cancelled).toBe(true);
    expect(progress.attempted).toBe(1);
    expect(results).toHaveLength(1);
  });

  it("never reports a saved image as failed when the progress callback throws", async () => {
    const apply = vi.fn(async (id: string) => ({ id: `out-${id}` }));
    await expect(
      runBatchGrade({
        assetIds: ["a", "b"],
        grade: GRADE_LOOKS.neutral,
        label: "test",
        apply,
        onItem: () => {
          throw new Error("render failed");
        },
      }),
    ).rejects.toThrow("render failed");
    // The first image was written once and is not retried or double counted as a failure.
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
