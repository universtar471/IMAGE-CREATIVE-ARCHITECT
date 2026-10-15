import { describe, expect, it } from "vitest";
import {
  EnhanceParamsSchema,
  GenerationParamsSchema,
  GenerationSubmitRequestSchema,
  buildEnhanceItems,
  buildEnhancePrompt,
  createInitialDNA,
  isGenerationAllowed,
  type EnhanceParams,
  type GenerationParams,
} from "../src";

const dna = createInitialDNA({ projectType: "custom", pack: null });

const params = (
  enhance: Partial<EnhanceParams> & Pick<EnhanceParams, "mode" | "targetLongEdge">,
): GenerationParams => ({
  aspectRatio: null,
  imageSize: null,
  outputCount: 1,
  seed: null,
  quality: null,
  enhance: EnhanceParamsSchema.parse(enhance),
});

const promptRequest = (over: Record<string, unknown> = {}) => ({
  projectId: "PRJ_1",
  providerId: "local_upscale",
  modelId: "lanczos3",
  purpose: "enhance",
  prompt: {
    compilerVersion: "pc-1.2.0",
    positivePrompt: "",
    negativePrompt: "",
    referenceInstructions: "",
    preservationInstructions: "",
    metadata: {},
  },
  referenceAssetIds: ["AST_1"],
  params: params({ mode: "conservative", targetLongEdge: 4096 }),
  cameraId: null,
  ...over,
});

describe("phase 5 enhancement domain", () => {
  it("defaults enhancement params exactly as the contract specifies", () => {
    expect(EnhanceParamsSchema.parse({ mode: "generative", targetLongEdge: null })).toEqual({
      mode: "generative",
      targetLongEdge: null,
      detailStrength: 40,
      architecturePreserve: true,
    });
    expect(
      GenerationParamsSchema.parse(params({ mode: "generative", targetLongEdge: null })),
    ).toEqual(params({ mode: "generative", targetLongEdge: null }));
  });

  it("requires enhance params for enhance requests and validates conservative provider/target", () => {
    expect(() =>
      GenerationSubmitRequestSchema.parse(
        promptRequest({
          params: { ...params({ mode: "conservative", targetLongEdge: 4096 }), enhance: undefined },
        }),
      ),
    ).toThrow(/params\.enhance.*enhance/i);
    expect(() =>
      GenerationSubmitRequestSchema.parse(promptRequest({ providerId: "gemini" })),
    ).toThrow(/local_upscale/i);
    expect(() =>
      GenerationSubmitRequestSchema.parse(
        promptRequest({ params: params({ mode: "conservative", targetLongEdge: null }) }),
      ),
    ).toThrow(/targetLongEdge/i);
  });

  it.each([
    [0, "low"],
    [33, "low"],
    [34, "medium"],
    [66, "medium"],
    [67, "high"],
    [100, "high"],
  ] as const)("uses the %s detail bucket at strength %s", (strength, bucket) => {
    const text = buildEnhancePrompt({
      dna,
      params: {
        mode: "generative",
        targetLongEdge: 4096,
        detailStrength: strength,
        architecturePreserve: true,
      },
    });
    expect(text).toContain(`detail level: ${bucket}`);
  });

  it("preserves the building and includes a deterministic material summary", () => {
    const withMaterial = structuredClone(dna);
    withMaterial.building.materials = [
      { zone: "facade", description: "warm brick" },
      { zone: "roof", description: "standing seam metal" },
    ];
    const text = buildEnhancePrompt({
      dna: withMaterial,
      params: {
        mode: "generative",
        targetLongEdge: null,
        detailStrength: 40,
        architecturePreserve: true,
      },
    });
    expect(text).toContain("Architecture Preserve");
    expect(text).toContain("Materials: facade: warm brick; roof: standing seam metal.");
    expect(text).toContain("Never change the building.");
    expect(text).toMatchInlineSnapshot(`
      "Enhance this architectural image with detail level: medium.
      Architecture Preserve: keep geometry, openings, proportions, materials, camera and composition exactly; add only fine detail and texture, and fix soft or noisy areas.
      Materials: facade: warm brick; roof: standing seam metal.
      Never change the building."
    `);
    const richer = buildEnhancePrompt({
      dna: withMaterial,
      params: {
        mode: "generative",
        targetLongEdge: null,
        detailStrength: 40,
        architecturePreserve: false,
      },
    });
    expect(richer).toContain("Allow richer generative detail");
    expect(richer).toContain("Never change the building.");
    expect(richer).not.toContain("Architecture Preserve");
  });

  it("builds one reference-only item per source and rejects models without references", () => {
    const model = {
      id: "m",
      label: "Model",
      textToImage: true,
      imageToImage: true,
      maxReferenceImages: 1,
      maxOutputs: 1,
      aspectRatios: [],
      imageSizes: [],
      supportsNegativePrompt: false,
      supportsSeed: false,
      qualityOptions: [],
      priceHint: null,
    };
    const items = buildEnhanceItems({
      sources: [
        { id: "AST_1", role: "regular_image", status: "ready", originalName: "front.png" },
        { id: "AST_2", role: "regular_image", status: "ready" },
      ],
      params: params({ mode: "conservative", targetLongEdge: 2048 }),
      providerId: "local_upscale",
      model,
      dna,
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      label: "Enhance — front.png",
      referenceAssetIds: ["AST_1"],
      prompt: {
        positivePrompt: "",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
      },
    });
    expect(items[1]?.label).toBe("Enhance — AST_2");
    expect(() =>
      buildEnhanceItems({
        sources: [{ id: "AST_1", role: "regular_image", status: "ready" }],
        params: params({ mode: "generative", targetLongEdge: null }),
        providerId: "gemini",
        model: { ...model, imageToImage: false, maxReferenceImages: 0 },
        dna,
      }),
    ).toThrow(/reference/i);
  });

  it("gates enhancement like variation", () => {
    expect(
      isGenerationAllowed("enhance", [], {
        masterApproved: true,
        anchorCameraIds: [],
        approvedAnchorCameraIds: [],
      }),
    ).toEqual({ ok: true });
    expect(
      isGenerationAllowed("enhance", [], {
        masterApproved: false,
        anchorCameraIds: [],
        approvedAnchorCameraIds: [],
      }),
    ).toEqual({ ok: false, blockedBy: "generate.master" });
  });
});
