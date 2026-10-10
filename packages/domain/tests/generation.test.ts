import { describe, expect, it } from "vitest";
import {
  adaptGenerationParams,
  closestAspectRatio,
  costHintText,
  estimateCostVnd,
  formatVnd,
  GenerationParamsSchema,
  COMPILER_VERSION,
  defaultGenerationParams,
  defaultReferenceIds,
  generationParentAssetId,
  GenerationDTOSchema,
  orderReferenceIds,
  validateGenerationRequest,
  type GenerationParams,
  type ModelCapabilities,
  type PromptBundle,
  type ReferenceCandidate,
} from "../src";

const model = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  id: "m",
  label: "Model",
  textToImage: true,
  imageToImage: true,
  maxReferenceImages: 3,
  maxOutputs: 4,
  aspectRatios: ["1:1", "16:9"],
  imageSizes: ["1K", "2K"],
  supportsNegativePrompt: true,
  supportsSeed: true,
  qualityOptions: ["low", "high"],
  priceHint: null,
  vision: false,
  ...over,
});

const prompt = (positivePrompt = "A villa"): PromptBundle => ({
  compilerVersion: COMPILER_VERSION,
  positivePrompt,
  negativePrompt: "",
  referenceInstructions: "",
  preservationInstructions: "",
  metadata: {},
});

const params = (over: Partial<GenerationParams> = {}): GenerationParams => ({
  aspectRatio: "16:9",
  imageSize: "1K",
  outputCount: 1,
  seed: null,
  quality: null,
  ...over,
});

const assets: ReferenceCandidate[] = [
  { id: "A_sketch", role: "structure_sketch", status: "ready" },
  { id: "A_mood", role: "mood_reference", status: "ready" },
  { id: "B_regular", role: "regular_image", status: "ready" },
  { id: "C_arch", role: "architecture_reference", status: "ready" },
  { id: "D_master", role: "master_architecture", status: "ready" },
  { id: "E_material_missing", role: "material_reference", status: "missing_file" },
  { id: "F_context", role: "context_reference", status: "ready" },
  { id: "B_arch", role: "architecture_reference", status: "ready" },
];

describe("default reference selection", () => {
  it("puts the master first, then roles in compiler order, ready assets only, capped", () => {
    expect(defaultReferenceIds(assets, model({ maxReferenceImages: 10 }))).toEqual([
      "D_master",
      "B_arch",
      "C_arch",
      "F_context",
      "A_mood",
    ]);
    expect(defaultReferenceIds(assets, model({ maxReferenceImages: 2 }))).toEqual([
      "D_master",
      "B_arch",
    ]);
  });

  it("selects nothing for a model without image-to-image", () => {
    expect(defaultReferenceIds(assets, model({ imageToImage: false }))).toEqual([]);
  });

  it("never auto-selects regular images (generated outputs)", () => {
    const only = [{ id: "X", role: "regular_image", status: "ready" }] as const;
    expect(defaultReferenceIds(only, model())).toEqual([]);
  });

  it("never auto-selects structure sketches", () => {
    const only = [{ id: "X", role: "structure_sketch", status: "ready" }] as const;
    expect(defaultReferenceIds(only, model())).toEqual([]);
  });

  it("orders a manual selection like the prompt compiler numbers images", () => {
    expect(orderReferenceIds(["A_mood", "B_regular", "D_master", "ghost"], assets)).toEqual([
      "D_master",
      "A_mood",
      "B_regular",
    ]);
  });
});

describe("default params", () => {
  it("derives from model capabilities", () => {
    expect(defaultGenerationParams(model())).toEqual({
      aspectRatio: "1:1",
      imageSize: "1K",
      outputCount: 1,
      seed: null,
      quality: null,
    });
    expect(defaultGenerationParams(model({ aspectRatios: [], imageSizes: [] }))).toEqual({
      aspectRatio: null,
      imageSize: null,
      outputCount: 1,
      seed: null,
      quality: null,
    });
  });

  it("adapts params to another model, keeping what is still supported", () => {
    const target = model({ aspectRatios: [], maxOutputs: 1, supportsSeed: false });
    expect(adaptGenerationParams(params({ outputCount: 4, seed: 7 }), target)).toEqual({
      aspectRatio: null,
      imageSize: "1K",
      outputCount: 1,
      seed: null,
      quality: null,
    });
    expect(adaptGenerationParams(params({ seed: 7 }), model())).toEqual(params({ seed: 7 }));
  });

  it("keeps an offered quality and drops one the model lacks", () => {
    expect(adaptGenerationParams(params({ quality: "high" }), model()).quality).toBe("high");
    expect(adaptGenerationParams(params({ quality: "medium" }), model()).quality).toBeNull();
    expect(
      adaptGenerationParams(params({ quality: "high" }), model({ qualityOptions: [] })).quality,
    ).toBeNull();
  });
});

describe("quality and cost", () => {
  const ok = { prompt: prompt(), referenceAssetIds: [] };

  it("accepts an offered quality and flags others", () => {
    expect(
      validateGenerationRequest({ ...ok, params: params({ quality: "low" }) }, model()),
    ).toEqual([]);
    const fields = (m: ModelCapabilities, quality: GenerationParams["quality"]) =>
      validateGenerationRequest({ ...ok, params: params({ quality }) }, m).map((i) => i.field);
    expect(fields(model(), "medium")).toEqual(["quality"]);
    expect(fields(model({ qualityOptions: [] }), "high")).toEqual(["quality"]);
  });

  it("parses params without quality as the provider default (older rows)", () => {
    const parsed = GenerationParamsSchema.parse({
      aspectRatio: null,
      imageSize: null,
      outputCount: 1,
      seed: null,
    });
    expect(parsed.quality).toBeNull();
    expect(() => GenerationParamsSchema.parse({ ...parsed, quality: "ultra" })).toThrow();
  });

  it("estimates the cost from the tier price list", () => {
    const priced = model({ priceHint: { "1K": 280, "2K": 600, "4K": 900 } });
    expect(estimateCostVnd(priced, "2K", 2)).toBe(1200);
    expect(estimateCostVnd(priced, null, 2)).toBeNull();
    expect(estimateCostVnd(model(), "1K", 1)).toBeNull();
    expect(costHintText(priced, "2K", 2)).toBe("≈ 1.200đ");
    expect(costHintText(priced, "4K", 4)).toBe("≈ 3.600đ");
    expect(costHintText(model({ priceHint: { "2K": 500 } }), "1K", 1)).toBe(
      "No published price for 1K",
    );
    expect(costHintText(model(), "1K", 1)).toBeNull();
    expect(formatVnd(280)).toBe("280đ");
    expect(formatVnd(1234567)).toBe("1.234.567đ");
  });
});

describe("client-side generation validation (§9)", () => {
  const ok = { prompt: prompt(), referenceAssetIds: ["D_master"], params: params() };
  const fields = (r: Parameters<typeof validateGenerationRequest>[0], m = model()) =>
    validateGenerationRequest(r, m, assets).map((i) => i.field);

  it("accepts a valid request", () => {
    expect(validateGenerationRequest(ok, model(), assets)).toEqual([]);
  });

  it.each([
    ["empty positive prompt", { ...ok, prompt: prompt("  ") }, model(), "prompt"],
    [
      "duplicate references",
      { ...ok, referenceAssetIds: ["D_master", "D_master"] },
      model(),
      "references",
    ],
    [
      "too many references",
      { ...ok, referenceAssetIds: ["D_master", "B_arch"] },
      model({ maxReferenceImages: 1 }),
      "references",
    ],
    [
      "outputCount above maxOutputs",
      { ...ok, params: params({ outputCount: 3 }) },
      model({ maxOutputs: 2 }),
      "outputCount",
    ],
    [
      "aspect ratio not offered",
      { ...ok, params: params({ aspectRatio: "4:5" }) },
      model(),
      "aspectRatio",
    ],
    [
      "image size not offered",
      { ...ok, params: params({ imageSize: "4K" }) },
      model(),
      "imageSize",
    ],
    [
      "seed without seed support",
      { ...ok, params: params({ seed: 1 }) },
      model({ supportsSeed: false }),
      "seed",
    ],
    ["references without image-to-image", ok, model({ imageToImage: false }), "references"],
    [
      "no references without text-to-image",
      { ...ok, referenceAssetIds: [] },
      model({ textToImage: false }),
      "references",
    ],
    [
      "missing reference file",
      { ...ok, referenceAssetIds: ["E_material_missing"] },
      model(),
      "references",
    ],
    ["unknown reference", { ...ok, referenceAssetIds: ["nope"] }, model(), "references"],
  ] as const)("rejects %s", (_name, req, m, field) => {
    expect(fields(req, m)).toContain(field);
  });

  // §9: an empty list means the provider decides, so the value must be null (review p2-ui #1).
  it("rejects a ratio/size when the model lists none", () => {
    const m = model({ aspectRatios: [], imageSizes: [] });
    expect(
      validateGenerationRequest(
        { ...ok, params: params({ aspectRatio: "4:5", imageSize: "8K" }) },
        m,
      ).map((i) => i.field),
    ).toEqual(["aspectRatio", "imageSize"]);
  });

  it("accepts null ratio/size when the model lists none", () => {
    const m = model({ aspectRatios: [], imageSizes: [] });
    expect(
      validateGenerationRequest(
        { ...ok, params: params({ aspectRatio: null, imageSize: null }) },
        m,
      ),
    ).toEqual([]);
  });
});

describe("generation lineage anchor", () => {
  it("prefers the master, then the first reference", () => {
    expect(generationParentAssetId(["B_arch", "D_master"], assets)).toBe("D_master");
    expect(generationParentAssetId(["F_context", "B_arch"], assets)).toBe("F_context");
    expect(generationParentAssetId([], assets)).toBeNull();
  });
});

describe("GenerationDTO schema", () => {
  it("parses a failed generation", () => {
    const g = GenerationDTOSchema.parse({
      id: "GEN_1",
      projectId: "PRJ_1",
      providerId: "gemini",
      modelId: "m",
      purpose: "hero",
      status: "failed",
      prompt: prompt(),
      referenceAssetIds: [],
      params: params(),
      parentAssetId: null,
      outputAssetIds: [],
      error: { kind: "auth", message: "Key rejected.", retryable: false },
      cameraId: null,
      batchId: null,
      jobId: "JOB_1",
      createdAt: "2026-10-08T00:00:00Z",
      startedAt: "2026-10-08T00:00:00Z",
      finishedAt: "2026-10-08T00:00:01Z",
      durationMs: 1000,
    });
    expect(g.error?.kind).toBe("auth");
  });

  it("parses a queued generation (not started yet)", () => {
    const g = GenerationDTOSchema.parse({
      id: "GEN_2",
      projectId: "PRJ_1",
      providerId: "mock",
      modelId: "m",
      purpose: "anchor",
      status: "queued",
      prompt: prompt(),
      referenceAssetIds: ["AST_M"],
      params: params(),
      parentAssetId: "AST_M",
      outputAssetIds: [],
      error: null,
      cameraId: "CAM_1",
      batchId: "BAT_1",
      jobId: "JOB_2",
      createdAt: "2026-10-08T00:00:00Z",
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    });
    expect(g.status).toBe("queued");
    expect(g.startedAt).toBeNull();
  });
});

describe("aspect ratio from the anchor image", () => {
  const ratios = ["1:1", "3:2", "16:9", "9:16", "21:9"];

  it("picks the offered ratio closest to the image's shape", () => {
    expect(closestAspectRatio(ratios, 1600, 1000)).toBe("3:2");
    expect(closestAspectRatio(ratios, 1920, 1080)).toBe("16:9");
    expect(closestAspectRatio(ratios, 1080, 1920)).toBe("9:16");
    expect(closestAspectRatio(ratios, 3000, 1200)).toBe("21:9");
  });

  it("falls back to the first option without usable dimensions, null without options", () => {
    expect(closestAspectRatio(ratios, null, 1000)).toBe("1:1");
    expect(closestAspectRatio([], 1600, 1000)).toBeNull();
  });

  it("is used by the default params when an anchor is given", () => {
    const m = model({ aspectRatios: ratios });
    expect(defaultGenerationParams(m, { widthPx: 1920, heightPx: 1080 }).aspectRatio).toBe("16:9");
    expect(defaultGenerationParams(m).aspectRatio).toBe("1:1");
    expect(
      defaultGenerationParams(model({ aspectRatios: [] }), { widthPx: 10, heightPx: 5 })
        .aspectRatio,
    ).toBeNull();
  });
});
