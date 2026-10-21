/**
 * ADR-033: the image-scoring feature was removed. The `repair` purpose stays only so old
 * history rows still parse and display; new repair generations are rejected.
 */
import { describe, expect, it } from "vitest";
import {
  BatchCreateRequestSchema,
  GenerationDTOSchema,
  GenerationSubmitRequestSchema,
  isGenerationAllowed,
} from "../src";

const promptBundle = {
  compilerVersion: "pc-1.2.0",
  positivePrompt: "",
  negativePrompt: "",
  referenceInstructions: "",
  preservationInstructions: "",
  metadata: {},
};

const legacyParams = {
  aspectRatio: null,
  imageSize: null,
  outputCount: 1,
  seed: null,
  quality: null,
  repair: { qcReportId: "QC_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
};

describe("legacy repair generations", () => {
  it("still parses an old repair generation row", () => {
    const dto = GenerationDTOSchema.parse({
      id: "GEN_1",
      projectId: "PRJ_1",
      providerId: "provider",
      modelId: "model",
      purpose: "repair",
      status: "completed",
      prompt: promptBundle,
      referenceAssetIds: ["AST_1", "AST_2"],
      params: legacyParams,
      parentAssetId: "AST_1",
      outputAssetIds: ["AST_3"],
      error: null,
      cameraId: null,
      batchId: null,
      jobId: "JOB_1",
      createdAt: "2026-10-01T00:00:00Z",
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    });
    expect(dto.purpose).toBe("repair");
    expect(dto.params.repair).toEqual(legacyParams.repair);
  });

  it("rejects new repair submissions and batches", () => {
    expect(() =>
      GenerationSubmitRequestSchema.parse({
        projectId: "PRJ_1",
        providerId: "provider",
        modelId: "model",
        purpose: "repair",
        prompt: promptBundle,
        referenceAssetIds: ["AST_1", "AST_2"],
        params: legacyParams,
        cameraId: null,
      }),
    ).toThrow(/no longer be submitted/);
    expect(() =>
      BatchCreateRequestSchema.parse({
        projectId: "PRJ_1",
        name: "repair",
        providerId: "provider",
        modelId: "model",
        purpose: "repair",
        items: [
          {
            cameraId: null,
            label: "repair",
            prompt: promptBundle,
            referenceAssetIds: ["AST_1", "AST_2"],
            params: legacyParams,
          },
        ],
      }),
    ).toThrow(/no longer be submitted/);
  });

  it("keeps legacy purpose independent of workflow progress", () => {
    const facts = { anchorCameraIds: [], approvedAnchorCameraIds: [] };
    expect(isGenerationAllowed("repair", [], { ...facts, masterApproved: true })).toEqual({
      ok: true,
    });
    expect(isGenerationAllowed("repair", [], { ...facts, masterApproved: false })).toEqual({
      ok: true,
    });
  });
});
