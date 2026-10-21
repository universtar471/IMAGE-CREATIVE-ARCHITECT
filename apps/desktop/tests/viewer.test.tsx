import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AssetDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { ModeSwitch } from "../src/components/shell/ModeSwitch";
import { MediaViewer } from "../src/features/viewer/MediaViewer";
import { StudioPreview } from "../src/features/viewer/StudioPreview";
import { setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let commands: string[];

/** Commands that change data; none may run because something was viewed or selected. */
const WRITES = [
  "generation_submit",
  "dna_update",
  "asset_update_role",
  "asset_set_master",
  "asset_remove",
  "canvas_layout_save",
  "job_retry",
  "job_cancel",
  "workflow_confirm_step",
];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  commands = [];
  const base = createMockTransport(db, { generationDelayMs: 0 });
  const transport: Transport = async (command, args) => {
    commands.push(command);
    return base(command, args);
  };
  setTransport(transport);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    providers: null,
    run: null,
    jobs: [],
    viewer: null,
    selectedAssetId: null,
    canvasSelection: [],
    nodeViewport: {},
    workspaceMode: "studio",
    activeModule: "generate",
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTransport(null);
});

const clipOf = (projectId: string, id: string, over: Partial<AssetDTO> = {}) =>
  asset(projectId, id, {
    source: "ai_generated",
    role: "regular_image",
    mimeType: "video/webm",
    mediaKind: "video",
    durationMs: 3000,
    posterSource: "frame",
    widthPx: null,
    heightPx: null,
    operation: "video",
    originalName: `${id}.webm`,
    parentAssetId: "AST_B",
    ...over,
  });

async function openProject() {
  const p = await createProject({
    name: "Viewer house",
    projectType: "townhouse",
    subtype: "default",
    starter: { floors: 2 },
  });
  db.assets.AST_A = asset(p.id, "AST_A", { originalName: "a.jpg" });
  db.assets.AST_B = asset(p.id, "AST_B", {
    originalName: "b.jpg",
    source: "ai_generated",
    role: "regular_image",
    parentAssetId: "AST_A",
  });
  db.assets.AST_C = asset(p.id, "AST_C", { originalName: "c.jpg" });
  db.assets.AST_V = clipOf(p.id, "AST_V");
  await useStudio.getState().openProject(p.id);
  commands = [];
  return p;
}

function renderStudio() {
  return render(
    <>
      <StudioPreview />
      <MediaViewer />
    </>,
  );
}

describe("large image viewer (ADR-044)", () => {
  it("enters real fullscreen, exits it on close, and reports rejected requests", async () => {
    await openProject();
    useStudio.getState().selectAsset("AST_B");
    let fullscreen: Element | null = null;
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreen,
    });
    const enter = vi.fn(async function (this: HTMLElement) {
      fullscreen = document.querySelector('[data-testid="media-viewer"]');
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exit = vi.fn(async () => {
      fullscreen = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: enter,
    });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
    renderStudio();
    fireEvent.click(screen.getByTestId("preview-expand"));
    fireEvent.click(await screen.findByRole("button", { name: "Enter fullscreen" }));
    await screen.findByRole("button", { name: "Exit fullscreen" });
    expect(enter).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId("viewer-close"));
    await waitFor(() => expect(exit).toHaveBeenCalledOnce());
    expect(fullscreen).toBeNull();

    enter.mockRejectedValueOnce(new Error("Denied"));
    fireEvent.click(screen.getByTestId("preview-expand"));
    fireEvent.click(await screen.findByRole("button", { name: "Enter fullscreen" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Fullscreen is unavailable");
    // A failed fullscreen request must leave the in-app viewer usable.
    expect(screen.getByTestId("media-viewer")).toBeTruthy();
    expect(commands.filter((c) => WRITES.includes(c))).toEqual([]);
    delete (HTMLElement.prototype as Partial<HTMLElement>).requestFullscreen;
    delete (document as Partial<Document>).exitFullscreen;
    Reflect.deleteProperty(document, "fullscreenEnabled");
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("opens from View large, zooms with keys, steps through the set and closes with Esc", async () => {
    await openProject();
    useStudio.getState().selectAsset("AST_B");
    renderStudio();
    const expand = screen.getByTestId("preview-expand");
    expand.focus();
    fireEvent.click(expand);
    const viewer = await screen.findByTestId("media-viewer");
    expect(viewer.getAttribute("aria-modal")).toBe("true");
    const image = within(viewer).getByTestId("image-viewer");
    expect(image.dataset.fitted).toBe("true");
    fireEvent.keyDown(image, { key: "1" });
    expect(image.dataset.zoom).toBe("100");
    fireEvent.keyDown(image, { key: "+" });
    expect(image.dataset.zoom).toBe("125");
    for (let i = 0; i < 12; i++) fireEvent.keyDown(image, { key: "+" });
    expect(image.dataset.zoom).toBe("400"); // capped at 400 %
    fireEvent.keyDown(image, { key: "0" });
    expect(within(viewer).getByTestId("image-viewer").dataset.fitted).toBe("true");

    // ← / → stay inside the set (the project's images) and stop at both ends.
    expect(screen.getByTestId("viewer-position").textContent).toBe("2 / 3");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(screen.getByTestId("viewer-position").textContent).toBe("3 / 3");
    fireEvent.keyDown(viewer, { key: "ArrowRight" });
    expect(screen.getByTestId("viewer-position").textContent).toBe("3 / 3");

    fireEvent.keyDown(viewer, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("media-viewer")).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId("preview-expand"));
    // Viewing changed nothing: same selection, no write command.
    expect(useStudio.getState().selectedAssetId).toBe("AST_B");
    expect(commands.filter((c) => WRITES.includes(c))).toEqual([]);
  });

  it("offers a compare with the source image only for images", async () => {
    await openProject();
    useStudio.getState().selectAsset("AST_B");
    renderStudio();
    fireEvent.click(screen.getByTestId("preview-expand"));
    const viewer = await screen.findByTestId("media-viewer");
    fireEvent.click(within(viewer).getByRole("button", { name: "Compare with source" }));
    expect(useStudio.getState().viewer?.compareWithId).toBe("AST_A");
    fireEvent.click(within(viewer).getByRole("button", { name: "Back to the image" }));
    expect(useStudio.getState().viewer?.compareWithId).toBeNull();
  });

  it("keeps the prompt draft and isolates keys from the app behind it", async () => {
    await openProject();
    useStudio.getState().setGenerateDraft({ extraPrompt: "warm evening light" });
    useStudio.getState().selectAsset("AST_A");
    const behind = vi.fn();
    window.addEventListener("keydown", behind);
    renderStudio();
    fireEvent.click(screen.getByTestId("preview-expand"));
    const viewer = await screen.findByTestId("media-viewer");
    fireEvent.keyDown(viewer, { key: "Delete" });
    expect(behind).not.toHaveBeenCalled();
    fireEvent.keyDown(viewer, { key: "Escape" });
    window.removeEventListener("keydown", behind);
    expect(useStudio.getState().generateDraft.extraPrompt).toBe("warm evening light");
  });
});

describe("large video viewer (ADR-044)", () => {
  it("keeps a playable source after StrictMode's effect cleanup and setup", async () => {
    await openProject();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    useStudio.getState().openViewer({ assetIds: ["AST_V"], index: 0 });
    render(
      <StrictMode>
        <MediaViewer />
      </StrictMode>,
    );
    const video = await screen.findByLabelText("Video player");
    expect(video.getAttribute("src")).toBe("blob:AST_V");
  });

  it("pauses the workspace player when the large viewer opens", async () => {
    await openProject();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    useStudio.getState().selectAsset("AST_V");
    renderStudio();
    const background = screen.getByLabelText("Video player");
    pause.mockClear();
    fireEvent.click(screen.getByTestId("preview-expand"));
    await screen.findByTestId("media-viewer");
    expect(pause.mock.contexts).toContain(background);
  });

  it("shows the real player without autoplay and stops it on close", async () => {
    await openProject();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    useStudio.getState().selectAsset("AST_V");
    renderStudio();
    fireEvent.click(screen.getByTestId("preview-expand"));
    const viewer = await screen.findByTestId("media-viewer");
    expect(viewer.dataset.kind).toBe("video");
    const video = within(viewer).getByLabelText("Video player") as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(within(viewer).getByText("Poster: first frame of the clip")).toBeTruthy();
    expect(play).not.toHaveBeenCalled();
    pause.mockClear();
    fireEvent.click(within(viewer).getByTestId("viewer-close"));
    await waitFor(() => expect(screen.queryByTestId("media-viewer")).toBeNull());
    expect(pause).toHaveBeenCalled();
    expect(commands.filter((c) => WRITES.includes(c))).toEqual([]);
  });

  it("says when the poster is the source image, not a frame of the clip", async () => {
    const p = await openProject();
    db.assets.AST_V2 = clipOf(p.id, "AST_V2", { posterSource: "source" });
    await useStudio.getState().openProject(p.id);
    useStudio.getState().openViewer({ assetIds: ["AST_V2"], index: 0 });
    render(<MediaViewer />);
    expect(
      await screen.findByText("Poster: source image — not a frame extracted from the clip"),
    ).toBeTruthy();
  });
});

describe("Studio / Node switch (ADR-044)", () => {
  it("keeps the draft, the graph selection and the canvas transform, and sends nothing", async () => {
    const p = await openProject();
    useStudio.getState().setGenerateDraft({ extraPrompt: "keep me" });
    useStudio.getState().setCanvasSelection(["asset:AST_B"]);
    useStudio.getState().setNodeViewport(p.id, { x: 12, y: -40, zoom: 0.8 });
    render(<ModeSwitch />);
    fireEvent.click(screen.getByTestId("mode-node"));
    expect(useStudio.getState().workspaceMode).toBe("node");
    fireEvent.click(screen.getByTestId("mode-studio"));
    const s = useStudio.getState();
    expect(s.workspaceMode).toBe("studio");
    expect(s.generateDraft.extraPrompt).toBe("keep me");
    expect(s.canvasSelection).toEqual(["asset:AST_B"]);
    expect(s.nodeViewport[p.id]).toEqual({ x: 12, y: -40, zoom: 0.8 });
    expect(commands.filter((c) => WRITES.includes(c))).toEqual([]);
  });

  it("keeps Studio for modules with their own work surface", async () => {
    await openProject();
    useStudio.setState({ activeModule: "regions" });
    render(<ModeSwitch />);
    expect((screen.getByTestId("mode-node") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("mode-studio").getAttribute("aria-pressed")).toBe("true");
  });
});
