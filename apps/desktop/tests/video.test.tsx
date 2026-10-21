import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AssetDTO, GenerationSubmitRequest, ProviderDescriptorDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { AssetThumbnail } from "../src/features/assets/AssetThumbnail";
import { resolveGenerateForm } from "../src/features/generate/form";
import { VideoCanvas } from "../src/features/video/VideoCanvas";
import { VideoPanel } from "../src/features/video/VideoPanel";
import {
  defaultVideoSource,
  resolveVideoForm,
  videoDisabledReason,
  videoSources,
} from "../src/features/video/video";
import { WORKSPACE_MODULES } from "../src/features/workspace/modules";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport, MOCK_PROVIDERS } from "../src/lib/mockBackend";
import { asset, settled } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let submitted: GenerationSubmitRequest[];

const clip = (projectId: string, id: string, over: Partial<AssetDTO> = {}): AssetDTO =>
  asset(projectId, id, {
    source: "ai_generated",
    role: "regular_image",
    mimeType: "video/mp4",
    mediaKind: "video",
    durationMs: 5000,
    widthPx: null,
    heightPx: null,
    operation: "video",
    originalName: `${id}.mp4`,
    ...over,
  });

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [], providerKeys: { kling: true } };
  submitted = [];
  const base = createMockTransport(db, { generationDelayMs: 0 });
  const transport: Transport = async (command, args) => {
    if (command === "generation_submit")
      submitted.push((args as { request: GenerationSubmitRequest }).request);
    return base(command, args);
  };
  setTransport(transport);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    providers: null,
    run: null,
    jobs: [],
    selectedAssetId: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTransport(null);
});

async function openProject() {
  const p = await createProject({
    name: "Clip house",
    projectType: "townhouse",
    subtype: "default",
    starter: { floors: 3 },
  });
  db.assets.AST_FACADE = asset(p.id, "AST_FACADE", {
    role: "master_architecture",
    originalName: "facade.png",
    createdAt: "2026-01-02T00:00:00Z",
  });
  db.assets.AST_OLD = asset(p.id, "AST_OLD", { originalName: "old.png" });
  await useStudio.getState().openProject(p.id);
  await useStudio.getState().loadProviders();
  return p;
}

describe("video helpers (ADR-043)", () => {
  const providers = MOCK_PROVIDERS.map(
    (p) => ({ ...p, configured: !p.requiresApiKey, keySource: null }) as ProviderDescriptorDTO,
  );

  it("starts from the selected image, a clip's source, the master or the newest image", () => {
    const assets = [
      asset("P", "AST_A", { createdAt: "2026-01-01T00:00:00Z" }),
      asset("P", "AST_B", { createdAt: "2026-01-03T00:00:00Z" }),
      clip("P", "AST_V", { parentAssetId: "AST_A" }),
    ];
    expect(videoSources(assets).map((a) => a.id)).toEqual(["AST_B", "AST_A"]);
    expect(defaultVideoSource(assets, "AST_A", null)?.id).toBe("AST_A");
    expect(defaultVideoSource(assets, "AST_V", null)?.id).toBe("AST_A");
    expect(defaultVideoSource(assets, null, "AST_A")?.id).toBe("AST_A");
    expect(defaultVideoSource(assets, null, null)?.id).toBe("AST_B");
  });

  it("lists only video providers and picks a configured one with its durations", () => {
    const form = resolveVideoForm(providers, {
      providerId: null,
      modelId: null,
      durationSec: null,
      aspectRatio: null,
    });
    expect(form.providers.map((p) => p.id)).toEqual([
      "kling",
      "veo",
      "seedance",
      "comfy_cloud",
      "local_video_preview",
    ]);
    expect(form.provider?.id).toBe("local_video_preview");
    expect(form.durations).toEqual([5, 10]);
    const veo = resolveVideoForm(providers, {
      providerId: "veo",
      modelId: null,
      durationSec: 10,
      aspectRatio: "16:9",
    });
    expect([veo.durationSec, veo.aspectRatio]).toEqual([4, "16:9"]);
    expect(videoDisabledReason(veo, asset("P", "A"), { readOnly: false, submitting: false })).toBe(
      "reasonNoProvider",
    );
    expect(videoDisabledReason(form, null, { readOnly: false, submitting: false })).toBe(
      "reasonNoSource",
    );
  });

  it("keeps video providers and clips out of the image Generate form", () => {
    const form = resolveGenerateForm(
      { ...EMPTY_GENERATE_DRAFT, providerId: "kling" },
      providers,
      [asset("P", "AST_A"), clip("P", "AST_V")],
      null,
    );
    expect(form.provider?.outputKind).not.toBe("video");
    expect(form.candidates.map((a) => a.id)).not.toContain("AST_V");
  });

  it("has a Video module in the Video group", () => {
    expect(WORKSPACE_MODULES.find((m) => m.id === "video")).toMatchObject({
      group: "video",
      availableIn: null,
    });
  });
});

describe("Video module (ADR-043)", () => {
  it("creates a clip from the master behind the cost confirm, with a compiled video prompt", async () => {
    const p = await openProject();
    useStudio.getState().selectAsset("AST_FACADE");
    render(<VideoPanel />);
    expect(screen.getByTestId("video-cost").textContent).toMatch(/No price known/);
    expect(
      (screen.getByRole("combobox", { name: "Video provider" }) as HTMLSelectElement).value,
    ).toBe("kling");
    fireEvent.click(screen.getByRole("button", { name: "Orbit left" }));
    fireEvent.click(screen.getByTestId("video-create"));
    const dialog = await screen.findByRole("dialog", { name: "Confirm cost" });
    expect(within(dialog).getByText("5 s")).toBeTruthy();
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(submitted).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Create video" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    const req = submitted[0]!;
    expect(req).toMatchObject({
      providerId: "kling",
      modelId: "kling-v2-1",
      purpose: "video",
      referenceAssetIds: ["AST_FACADE"],
      params: { imageSize: "5s", outputCount: 1, aspectRatio: null },
    });
    expect(req.prompt.compilerVersion).toBe("vc-1.0.0");
    expect(req.prompt.positivePrompt).toMatch(/orbits slowly to the left/);
    const run = useStudio.getState().run;
    const generationId = run?.status === "tracking" ? run.generation.id : "";
    const done = await settled(p.id, generationId);
    expect(done.status).toBe("completed");
    const assets = await call("asset_list", { projectId: p.id });
    const video = assets.find((a) => a.id === done.outputAssetIds[0])!;
    expect(video).toMatchObject({
      mediaKind: "video",
      durationMs: 5000,
      parentAssetId: "AST_FACADE",
    });
  });

  it("the free local preview needs no confirm", async () => {
    await openProject();
    render(<VideoPanel />);
    expect(screen.getByRole("combobox", { name: "Model" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Video provider" }), {
      target: { value: "local_video_preview" },
    });
    fireEvent.click(screen.getByTestId("video-create"));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(submitted[0]!.providerId).toBe("local_video_preview");
  });

  it("cancelling the confirm sends nothing", async () => {
    await openProject();
    render(<VideoPanel />);
    fireEvent.click(screen.getByTestId("video-create"));
    const dialog = await screen.findByRole("dialog", { name: "Confirm cost" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(submitted).toHaveLength(0);
  });

  it("refuses a clip as the reference of an image or a video", async () => {
    const p = await openProject();
    db.assets.AST_CLIP = clip(p.id, "AST_CLIP");
    const request = (
      providerId: string,
      modelId: string,
      referenceAssetIds: string[],
    ): GenerationSubmitRequest => ({
      projectId: p.id,
      providerId,
      modelId,
      purpose: "video",
      referenceAssetIds,
      params: { aspectRatio: null, imageSize: "5s", outputCount: 1, seed: null, quality: null },
      cameraId: null,
      prompt: {
        compilerVersion: "vc-1.0.0",
        positivePrompt: "x",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
    });
    await expect(
      call("generation_submit", request("local_video_preview", "still-v1", ["AST_CLIP"])),
    ).rejects.toMatchObject({ message: expect.stringMatching(/is a video/) });
    await expect(
      call("generation_submit", request("local_preview", "placeholder-v1", ["AST_FACADE"])),
    ).rejects.toMatchObject({ message: expect.stringMatching(/makes images/) });
  });

  it("plays a selected clip next to its first frame and source image", async () => {
    const p = await openProject();
    db.assets.AST_CLIP = clip(p.id, "AST_CLIP", { parentAssetId: "AST_FACADE" });
    await useStudio.getState().openProject(p.id);
    useStudio.getState().selectAsset("AST_CLIP");
    const { container } = render(<VideoCanvas />);
    expect(screen.getByTestId("video-player")).toBeTruthy();
    expect(container.querySelector("video")?.getAttribute("poster")).toBe("data:AST_CLIP");
    // Unknown poster origin (stored before ADR-044): a neutral label, never "first frame".
    expect(screen.getByText("Poster")).toBeTruthy();
    expect(screen.queryByText("First frame of the clip")).toBeNull();
    expect(screen.getByAltText("Source image")).toBeTruthy();
  });

  it("calls the poster a first frame only when FFmpeg took it from the clip", async () => {
    const p = await openProject();
    db.assets.AST_F = clip(p.id, "AST_F", { parentAssetId: "AST_FACADE", posterSource: "frame" });
    db.assets.AST_S = clip(p.id, "AST_S", { parentAssetId: "AST_FACADE", posterSource: "source" });
    await useStudio.getState().openProject(p.id);
    useStudio.getState().selectAsset("AST_F");
    const { unmount } = render(<VideoCanvas />);
    expect(screen.getByText("First frame of the clip")).toBeTruthy();
    unmount();
    useStudio.getState().selectAsset("AST_S");
    render(<VideoCanvas />);
    expect(
      screen.getAllByText(/source image — not a frame extracted from the clip/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("First frame of the clip")).toBeNull();
  });

  it("marks clips in the tray with the play badge and length", () => {
    render(<AssetThumbnail asset={clip("P", "AST_V")} selected={false} onSelect={() => {}} />);
    expect(screen.getByTestId("video-badge").textContent).toContain("0:05");
  });
});
