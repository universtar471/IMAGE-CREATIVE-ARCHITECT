import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { COMPILER_VERSION, type GenerationDTO, type ProviderDescriptorDTO } from "@arch/domain";
import { useStudio } from "../src/app/store";
import { ConfirmDialog, Dialog } from "../src/components/common/Dialog";
import { GenerationResult } from "../src/features/generate/GenerationResult";

afterEach(cleanup);

describe("dialog stacking", () => {
  it("Escape closes only the topmost dialog", () => {
    const closeOuter = vi.fn();
    const cancelInner = vi.fn();
    const { rerender } = render(
      <Dialog title="Outer" onClose={closeOuter}>
        <ConfirmDialog
          title="Inner"
          message="?"
          confirmLabel="OK"
          onConfirm={() => {}}
          onCancel={cancelInner}
        />
      </Dialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cancelInner).toHaveBeenCalledTimes(1);
    expect(closeOuter).not.toHaveBeenCalled();

    rerender(
      <Dialog title="Outer" onClose={closeOuter}>
        content
      </Dialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(closeOuter).toHaveBeenCalledTimes(1);
    expect(cancelInner).toHaveBeenCalledTimes(1);
  });
});

describe("failed generation card", () => {
  const generation = (error: GenerationDTO["error"], status: GenerationDTO["status"]) =>
    ({
      id: "GEN_1",
      projectId: "PRJ_1",
      providerId: "gemini",
      modelId: "gemini-nano-banana-2.1",
      purpose: "hero",
      status,
      prompt: {
        compilerVersion: COMPILER_VERSION,
        positivePrompt: "x",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
      referenceAssetIds: [],
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
      parentAssetId: null,
      outputAssetIds: [],
      error,
      cameraId: null,
      batchId: null,
      jobId: null,
      createdAt: "2026-10-08T00:00:00Z",
      startedAt: "2026-10-08T00:00:00Z",
      finishedAt: "2026-10-08T00:00:01Z",
      durationMs: 1000,
    }) satisfies GenerationDTO;

  const show = (g: GenerationDTO) => {
    useStudio.setState({
      run: null,
      workspace: {
        project: {
          id: "PRJ_1",
          name: "P",
          projectType: "villa",
          subtype: null,
          status: "draft",
          activeMasterAssetId: null,
          createdAt: "",
          updatedAt: "",
          archivedAt: null,
        },
        persistedDna: {} as never,
        draftDna: {} as never,
        assets: [],
        generations: [g],
        anchors: [],
        batches: [],
      },
      providers: [
        {
          id: "gemini",
          label: "Google Gemini",
          kind: "remote",
          requiresApiKey: true,
          configured: true,
          keySource: "keychain",
          models: [
            {
              id: "gemini-nano-banana-2.1",
              label: "Nano Banana",
              textToImage: true,
              imageToImage: true,
              maxReferenceImages: 14,
              maxOutputs: 4,
              aspectRatios: [],
              imageSizes: [],
              supportsNegativePrompt: false,
              supportsSeed: false,
              supportsMask: false,
              qualityOptions: [],
              priceHint: null,
              vision: false,
            },
          ],
        },
      ] satisfies ProviderDescriptorDTO[],
    });
    render(<GenerationResult />);
  };

  it("renders an unknown kind generically and offers Retry when retryable", () => {
    show(generation({ kind: "io", message: "Disk full.", retryable: true }, "failed"));
    expect(screen.getByText("io")).toBeTruthy();
    expect(screen.getByText(/Disk full\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeTruthy();
  });

  it("hides Retry when the error is not retryable", () => {
    show(
      generation(
        { kind: "interrupted", message: "Project archived mid-call.", retryable: false },
        "interrupted",
      ),
    );
    expect(screen.getByText(/Project archived mid-call\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.getByText(/cannot be retried/i)).toBeTruthy();
  });

  it("confirms spend before retrying a paid failed generation", async () => {
    const retryGeneration = vi.fn(async () => undefined);
    show(generation({ kind: "network", message: "Offline.", retryable: true }, "failed"));
    useStudio.setState({ retryGeneration });
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByRole("dialog", { name: "Confirm cost" })).toBeTruthy();
    expect(retryGeneration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(retryGeneration).not.toHaveBeenCalled();
  });
});
