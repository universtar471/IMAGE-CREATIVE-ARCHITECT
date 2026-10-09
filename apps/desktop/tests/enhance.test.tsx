import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { assetPreview } from "../src/lib/bridge";
import { asset } from "./helpers";
import {
  buildEnhanceItems,
  buildEnhanceRequest,
  disabledEnhanceTargets,
  validateEnhanceParams,
} from "../src/features/enhance/enhance";

vi.mock("../src/lib/bridge", () => ({
  assetPreview: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
}));

describe("enhance UI contract", () => {
  it("disables targets below the source long edge", () => {
    expect(disabledEnhanceTargets(3000)).toEqual({ 2048: true, 3072: false, 4096: false });
    expect(disabledEnhanceTargets(4096)).toEqual({ 2048: true, 3072: true, 4096: false });
  });

  it("validates conservative and generative params", () => {
    expect(
      validateEnhanceParams({
        mode: "conservative",
        targetLongEdge: null,
        detailStrength: 40,
        architecturePreserve: true,
      }),
    ).toContain("targetLongEdge");
    expect(
      validateEnhanceParams({
        mode: "generative",
        targetLongEdge: null,
        detailStrength: 40,
        architecturePreserve: true,
      }),
    ).toBeNull();
    expect(
      validateEnhanceParams({
        mode: "generative",
        targetLongEdge: 2048,
        detailStrength: 101,
        architecturePreserve: true,
      }),
    ).toContain("detailStrength");
  });

  it("builds one exact enhance item per selected asset", () => {
    const params = {
      mode: "conservative" as const,
      targetLongEdge: 4096 as const,
      detailStrength: 40,
      architecturePreserve: true,
    };
    const items = buildEnhanceItems({ projectId: "p", assetIds: ["a", "b"], params });
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.referenceAssetIds)).toEqual([["a"], ["b"]]);
    expect(items.every((item) => item.params.enhance === params && item.cameraId === null)).toBe(
      true,
    );
  });

  it("builds exact submit payloads for both modes", () => {
    const base = {
      mode: "conservative" as const,
      targetLongEdge: 4096 as const,
      detailStrength: 40,
      architecturePreserve: true,
    };
    const conservative = buildEnhanceRequest({
      projectId: "p",
      providerId: "local_upscale",
      modelId: "lanczos3",
      sourceAssetId: "a",
      params: base,
    });
    expect(conservative).toMatchObject({
      purpose: "enhance",
      providerId: "local_upscale",
      modelId: "lanczos3",
      referenceAssetIds: ["a"],
      params: { enhance: base },
      prompt: { positivePrompt: "", negativePrompt: "", preservationInstructions: "" },
    });
    const generative = buildEnhanceRequest({
      projectId: "p",
      providerId: "hhtech",
      modelId: "gemini-3-pro-image",
      sourceAssetId: "a",
      params: { ...base, mode: "generative" },
    });
    expect(generative.purpose).toBe("enhance");
    expect(generative.prompt.positivePrompt).toContain("detail strength");
    expect(generative.params.enhance.mode).toBe("generative");
  });
});

describe("CompareCanvas", () => {
  it("loads each side through assetPreview once", async () => {
    const { CompareCanvas } = await import("../src/components/canvas/CompareCanvas");
    render(<CompareCanvas source={asset("p", "source")} result={asset("p", "result")} />);
    await waitFor(() => expect(assetPreview).toHaveBeenCalledTimes(2));
    expect(assetPreview).toHaveBeenNthCalledWith(1, {
      projectId: "p",
      assetId: "source",
      maxEdge: 1600,
    });
    expect(assetPreview).toHaveBeenNthCalledWith(2, {
      projectId: "p",
      assetId: "result",
      maxEdge: 1600,
    });
  });
});
