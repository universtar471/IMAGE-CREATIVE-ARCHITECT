import { describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { assetPreview } from "../src/lib/bridge";
import { asset } from "./helpers";
import { findSubmittedEnhanceResult } from "../src/features/workspace/ProjectWorkspace";
import type { GenerationDTO } from "@arch/domain";
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
  it("ignores a completed result after switching projects", () => {
    const generation = {
      id: "gen-old",
      projectId: "project-old",
      purpose: "enhance",
      status: "completed",
      outputAssetIds: ["result-old"],
    } as GenerationDTO;
    expect(
      findSubmittedEnhanceResult(
        "project-new",
        { projectId: "project-old", generationId: "gen-old" },
        [generation],
        [asset("project-old", "result-old")],
      ),
    ).toBeNull();
  });

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
    expect(generative.prompt.positivePrompt).toContain("detail level");
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

  it("clears the old pair immediately and revokes a late preview URL", async () => {
    const { CompareCanvas } = await import("../src/components/canvas/CompareCanvas");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    let resolvePreview!: (blob: Blob) => void;
    vi.mocked(assetPreview).mockReset();
    vi.mocked(assetPreview).mockImplementation(({ projectId }) =>
      projectId === "p"
        ? new Promise<Blob>((resolve) => (resolvePreview = resolve))
        : Promise.resolve(new Blob(["new"], { type: "image/png" })),
    );
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:late");
    const first = render(
      <CompareCanvas source={asset("p", "source")} result={asset("p", "result")} />,
    );
    await waitFor(() => expect(assetPreview).toHaveBeenCalled());
    await act(async () => {
      first.rerender(
        <CompareCanvas source={asset("p2", "new-source")} result={asset("p2", "new-result")} />,
      );
      await Promise.resolve();
    });
    expect(first.container.querySelectorAll('img[alt="Before"]')).toHaveLength(1);
    await act(async () => resolvePreview(new Blob(["late"], { type: "image/png" })));
    expect(revoke).toHaveBeenCalledWith("blob:late");
    create.mockRestore();
    revoke.mockRestore();
  });
});
