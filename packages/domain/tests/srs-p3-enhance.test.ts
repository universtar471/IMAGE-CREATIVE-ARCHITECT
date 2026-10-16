import { describe, expect, it } from "vitest";
import vectors from "../test-vectors/upscale.json";
import {
  BatchCreateRequestSchema,
  EnhanceCheckSchema,
  EnhanceParamsSchema,
  GenerationSubmitRequestSchema,
  buildEnhanceItems,
  buildEnhancePrompt,
  createInitialDNA,
  failedBatchJobIds,
  planEnhanceSources,
  resolveUpscaleSize,
  upscaleTargetLongEdge,
  type EnhanceParams,
  type IfAlreadyLarger,
  type UpscaleTarget,
} from "../src";

const dna = createInitialDNA({ projectType: "custom", pack: null });
const legacy: EnhanceParams = {
  mode: "generative",
  targetLongEdge: null,
  detailStrength: 40,
  architecturePreserve: true,
};
const balanced: EnhanceParams = {
  ...legacy,
  preservationMode: "balanced",
  locks: { geometry: true, material: true, context: true, camera: true },
};
const LOCAL_MODEL = { imageToImage: true, maxReferenceImages: 1, label: "Lanczos3" };
const source = (id: string, widthPx: number, heightPx: number) => ({
  id,
  role: "regular_image" as const,
  status: "ready" as const,
  widthPx,
  heightPx,
});

describe("resolveUpscaleSize (ADR-035)", () => {
  it.each(vectors.map((vector) => [vector.name, vector] as const))(
    "matches the shared vector: %s",
    (_name, vector) => {
      expect(
        resolveUpscaleSize(
          vector.source,
          vector.target as UpscaleTarget,
          vector.ifAlreadyLarger as IfAlreadyLarger,
        ),
      ).toEqual(vector.expected);
    },
  );

  it("keeps 3:2 at exactly 4096 on the long edge without a crop (AC-12)", () => {
    const size = resolveUpscaleSize({ width: 3000, height: 2000 }, "long_edge_4096");
    expect([size.width, size.height]).toEqual([4096, 2731]);
    expect(Math.abs(size.width / size.height - 1.5)).toBeLessThan(0.001);
    expect(size.letterbox).toBe(false);
  });

  it("long edge is exact for every aspect and the short edge never drifts", () => {
    for (const [w, h] of [
      [1, 1],
      [3, 2],
      [2, 3],
      [1000, 1],
      [1366, 768],
      [999, 1001],
    ] as const) {
      for (const target of ["long_edge_2048", "long_edge_4096"] as const) {
        const edge = upscaleTargetLongEdge(target)!;
        const size = resolveUpscaleSize({ width: w, height: h }, target);
        expect(Math.max(size.width, size.height)).toBe(edge);
        const exactShort = (Math.min(w, h) * edge) / Math.max(w, h);
        expect(Math.abs(Math.min(size.width, size.height) - exactShort)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("UHD contain letterboxes and never crops or stretches", () => {
    for (const [w, h] of [
      [3000, 2000],
      [1080, 1920],
      [2100, 900],
      [1920, 1080],
    ] as const) {
      const size = resolveUpscaleSize({ width: w, height: h }, "uhd_3840x2160_contain");
      expect([size.canvasWidth, size.canvasHeight]).toEqual([3840, 2160]);
      expect(size.width).toBeLessThanOrEqual(3840);
      expect(size.height).toBeLessThanOrEqual(2160);
      expect(size.width === 3840 || size.height === 2160).toBe(true);
      expect(size.offsetX + size.width).toBeLessThanOrEqual(3840);
      expect(size.offsetY + size.height).toBeLessThanOrEqual(2160);
      expect(Math.abs(size.width / size.height - w / h) / (w / h)).toBeLessThan(0.002);
      expect(size.letterbox).toBe(w * 9 !== h * 16);
    }
  });

  it("never downscales: a larger source follows ifAlreadyLarger", () => {
    for (const choice of ["keep", "quality_only", "skip"] as const) {
      const size = resolveUpscaleSize({ width: 5000, height: 2000 }, "long_edge_4096", choice);
      expect(size).toMatchObject({ width: 5000, height: 2000, action: choice, letterbox: false });
      const uhd = resolveUpscaleSize(
        { width: 4000, height: 1000 },
        "uhd_3840x2160_contain",
        choice,
      );
      expect(uhd).toMatchObject({ width: 4000, height: 1000, canvasWidth: 4000, action: choice });
    }
  });
});

describe("enhance params and prompt (ADR-035)", () => {
  it("old params parse unchanged and stay free of the new fields", () => {
    const parsed = EnhanceParamsSchema.parse({ mode: "conservative", targetLongEdge: 2048 });
    expect(parsed).toEqual({
      mode: "conservative",
      targetLongEdge: 2048,
      detailStrength: 40,
      architecturePreserve: true,
    });
  });

  it("locks default to on and the upscale target parses all shapes", () => {
    expect(
      EnhanceParamsSchema.parse({ ...legacy, preservationMode: "creative", locks: {} }).locks,
    ).toEqual({ geometry: true, material: true, context: true, camera: true });
    for (const target of [
      "long_edge_2048",
      "long_edge_4096",
      "uhd_3840x2160_contain",
      { width: 1200, height: 900, fit: "contain" },
    ]) {
      expect(
        EnhanceParamsSchema.parse({ ...legacy, upscale: { target } }).upscale?.ifAlreadyLarger,
      ).toBe("keep");
    }
    expect(
      EnhanceParamsSchema.safeParse({
        ...legacy,
        upscale: { target: { width: 1200, height: 900, fit: "cover" } },
      }).success,
    ).toBe(false);
  });

  it("the legacy prompt is byte-identical without a preservation mode", () => {
    expect(buildEnhancePrompt({ dna, params: legacy })).toBe(
      [
        "Enhance this architectural image with detail level: medium.",
        "Architecture Preserve: keep geometry, openings, proportions, materials, camera and composition exactly; add only fine detail and texture, and fix soft or noisy areas.",
        "Never change the building.",
      ].join("\n"),
    );
  });

  it("uses the SRS §8.2 template and the active locks when a mode is set", () => {
    const prompt = buildEnhancePrompt({ dna, params: balanced });
    expect(
      prompt.startsWith("TASK: Enhance the provided architectural render; DO NOT redesign."),
    ).toBe(true);
    expect(prompt).toContain("If uncertain, keep the source unchanged and flag for review.");
    expect(prompt).toContain("EDITABLE REGIONS: the whole frame");
    expect(prompt).toContain("CAMERA LOCK");
    expect(prompt).not.toContain("Enhance this architectural image");
    const noCamera = buildEnhancePrompt({
      dna,
      params: { ...balanced, locks: { ...balanced.locks!, camera: false, context: false } },
    });
    expect(noCamera).not.toContain("CAMERA LOCK");
    expect(noCamera).not.toContain("CONTEXT LOCK");
    expect(noCamera).toContain("GEOMETRY LOCK");
    const masked = buildEnhancePrompt({
      dna,
      params: { ...balanced, preservationMode: "creative", allowedRegionIds: ["RGN_1"] },
    });
    expect(masked).toContain("only the allowed-region mask");
    expect(masked).toContain("always reviewed");
    expect(buildEnhancePrompt({ dna, params: balanced })).toBe(prompt);
  });
});

describe("enhance contracts (ADR-035)", () => {
  const request = (enhance: EnhanceParams, providerId: string) => ({
    projectId: "PRJ_1",
    providerId,
    modelId: providerId === "local_upscale" ? "lanczos3" : "gemini",
    purpose: "enhance",
    prompt: {
      compilerVersion: "pc-1.8.0",
      positivePrompt: "",
      negativePrompt: "",
      referenceInstructions: "",
      preservationInstructions: "",
      metadata: {},
    },
    referenceAssetIds: ["AST_1"],
    params: {
      aspectRatio: null,
      imageSize: null,
      outputCount: 1,
      seed: null,
      quality: null,
      enhance,
    },
    cameraId: null,
  });
  const strict: EnhanceParams = {
    mode: "conservative",
    targetLongEdge: null,
    detailStrength: 40,
    architecturePreserve: true,
    preservationMode: "strict",
    upscale: { target: "uhd_3840x2160_contain", ifAlreadyLarger: "keep" },
  };

  it("strict is local only and may use an upscale target instead of targetLongEdge", () => {
    expect(GenerationSubmitRequestSchema.safeParse(request(strict, "local_upscale")).success).toBe(
      true,
    );
    const paid = GenerationSubmitRequestSchema.safeParse(request(strict, "hhtech"));
    expect(paid.success).toBe(false);
    expect(paid.error?.issues.map((issue) => issue.message)).toContain(
      'Strict enhancement requires providerId "local_upscale".',
    );
    expect(
      GenerationSubmitRequestSchema.safeParse(
        request({ ...strict, mode: "generative" }, "local_upscale"),
      ).success,
    ).toBe(false);
    expect(
      GenerationSubmitRequestSchema.safeParse(
        request({ ...strict, upscale: undefined }, "local_upscale"),
      ).success,
    ).toBe(false);
  });

  it("balanced and creative need a generative mode; batches share the same contract", () => {
    expect(
      GenerationSubmitRequestSchema.safeParse(
        request({ ...balanced, mode: "conservative", targetLongEdge: 2048 }, "local_upscale"),
      ).success,
    ).toBe(false);
    const batch = BatchCreateRequestSchema.safeParse({
      projectId: "PRJ_1",
      name: "Batch",
      providerId: "hhtech",
      modelId: "gemini",
      purpose: "enhance",
      items: [
        {
          cameraId: null,
          label: "one",
          prompt: request(strict, "hhtech").prompt,
          referenceAssetIds: ["AST_1"],
          params: request(strict, "hhtech").params,
        },
      ],
    });
    expect(batch.success).toBe(false);
    expect(batch.error?.issues.map((issue) => issue.message)).toContain(
      'Strict enhancement requires providerId "local_upscale".',
    );
  });

  it("strict items refuse a paid provider and skip sources the target says to skip", () => {
    expect(() =>
      buildEnhanceItems({
        sources: [source("AST_1", 1000, 800)],
        params: strict,
        providerId: "hhtech",
        model: LOCAL_MODEL,
      }),
    ).toThrow(/local_upscale/);
    const params: EnhanceParams = {
      ...strict,
      upscale: { target: "long_edge_2048", ifAlreadyLarger: "skip" },
    };
    const sources = [source("AST_1", 1000, 800), source("AST_2", 3000, 2000)];
    expect(planEnhanceSources(sources, params).map((plan) => plan.skip)).toEqual([false, true]);
    const items = buildEnhanceItems({
      sources,
      params,
      providerId: "local_upscale",
      model: LOCAL_MODEL,
    });
    expect(items.map((item) => item.referenceAssetIds)).toEqual([["AST_1"]]);
    expect(items[0]!.prompt.positivePrompt).toBe("");
  });

  it("the check DTO parses the Rust shape", () => {
    expect(
      EnhanceCheckSchema.parse({
        id: "ECK_1",
        version: "ec-1.0.0",
        preservationMode: "strict",
        status: "warn",
        reasons: ["registration_shift"],
        expectedSize: { width: 4096, height: 2731 },
        actualSize: { width: 4096, height: 2731 },
        content: { x: 0, y: 0, width: 4096, height: 2731 },
        aspectDelta: 0,
        registration: { dx: 12, dy: 0, shiftPx: 12 },
        lockedSsim: 0.91,
        lockedPct: 100,
        edgeDelta: 0.01,
        composited: false,
        sizeAction: "upscale",
      }).status,
    ).toBe("warn");
  });
});

describe("batch retry (AC-13)", () => {
  it("20 items with 2 failures keep 18 successes and retry exactly the 2 failures", () => {
    const jobs = Array.from({ length: 20 }, (_, index) => ({
      id: `JOB_${index}`,
      batchId: "BAT_1",
      status: index === 4 ? "failed" : index === 13 ? "interrupted" : "completed",
    }));
    jobs.push({ id: "JOB_other", batchId: "BAT_2", status: "failed" });
    jobs.push({ id: "JOB_skipped", batchId: "BAT_1", status: "cancelled" });
    expect(failedBatchJobIds(jobs, "BAT_1")).toEqual(["JOB_4", "JOB_13"]);
    expect(
      jobs.filter((job) => job.batchId === "BAT_1" && job.status === "completed"),
    ).toHaveLength(18);
  });
});
