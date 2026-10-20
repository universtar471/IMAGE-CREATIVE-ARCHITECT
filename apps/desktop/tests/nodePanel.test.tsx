import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { PropertyPanel } from "../src/components/panels/PropertyPanel";
import { WorkspaceLayoutContext, workspaceLayout } from "../src/features/workspace/layout";
import { MediaViewer } from "../src/features/viewer/MediaViewer";
import { createMockTransport } from "../src/lib/mockBackend";
import { setTransport } from "../src/lib/bridge";
import { asset } from "./helpers";

const db = { projects: {}, dna: {}, assets: {}, versions: [] } as NonNullable<
  Parameters<typeof createMockTransport>[0]
>;
let commands: string[];
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(async () => {
  commands = [];
  const transport = createMockTransport(db);
  setTransport(async (command, args) => {
    commands.push(command);
    return transport(command, args);
  });
  useStudio.setState({
    workspaceMode: "node",
    activeModule: "generate",
    canvasSelection: [],
    viewer: null,
    workspace: null,
    providers: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
  const p = await createProject({
    name: "Panel routing",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  db.assets ??= {};
  db.assets.AST_IMG = asset(p.id, "AST_IMG", { role: "regular_image" });
  db.assets.AST_REF = asset(p.id, "AST_REF", { role: "material_reference" });
  db.assets.AST_CLIP = asset(p.id, "AST_CLIP", {
    role: "regular_image",
    mediaKind: "video",
    mimeType: "video/mp4",
    parentAssetId: "AST_IMG",
  });
  await useStudio.getState().openProject(p.id);
  useStudio.setState({ workspaceMode: "node", activeModule: "generate" });
  commands = [];
});

afterEach(() => {
  cleanup();
  setTransport(null);
});

it("routes image, video and reference node selection to the right editing panel without writes", async () => {
  render(<PropertyPanel />);
  useStudio.getState().setGenerateDraft({ extraPrompt: "keep my image draft" });
  act(() => useStudio.getState().setCanvasSelection(["asset:AST_CLIP"]));
  expect(useStudio.getState().activeModule).toBe("video");
  expect(await screen.findByTestId("video-panel")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Create Hero image/ })).toBeNull();
  const note = screen.getByRole("textbox");
  fireEvent.change(note, { target: { value: "slow camera motion" } });
  act(() => useStudio.getState().setCanvasSelection(["asset:AST_REF"]));
  expect(useStudio.getState().activeModule).toBe("references");
  act(() => useStudio.getState().setCanvasSelection(["asset:AST_IMG"]));
  expect(useStudio.getState().activeModule).toBe("generate");
  expect(useStudio.getState().generateDraft.extraPrompt).toBe("keep my image draft");
  act(() => useStudio.getState().setCanvasSelection(["asset:AST_CLIP"]));
  expect(
    screen.getByRole("textbox").getAttribute("value") ??
      (screen.getByRole("textbox") as HTMLTextAreaElement).value,
  ).toBe("slow camera motion");
  expect(
    commands.filter((c) =>
      /^(generation_submit|dna_update|asset_|job_|canvas_layout_save)/.test(c),
    ),
  ).toEqual([]);
});

it("keeps inspector scroll, selection and draft through resize and a viewer round trip", async () => {
  act(() => useStudio.getState().setCanvasSelection(["asset:AST_IMG"]));
  const view = (width: number) => (
    <WorkspaceLayoutContext.Provider value={workspaceLayout(width, 720)}>
      <PropertyPanel />
      <MediaViewer />
    </WorkspaceLayoutContext.Provider>
  );
  const { rerender } = render(view(1920));
  const panel = screen.getByTestId("property-panel");
  const body = panel.querySelector(".panel-body")!;
  body.scrollTop = 240;
  rerender(view(800));
  rerender(view(1920));
  expect(body.scrollTop).toBe(240);
  const thumb = within(panel).getByTestId("inspector-thumb");
  thumb.focus();
  fireEvent.click(thumb);
  fireEvent.click(await screen.findByTestId("viewer-close"));
  expect(body.scrollTop).toBe(240);
  expect(document.activeElement).toBe(thumb);
  expect(useStudio.getState().canvasSelection).toEqual(["asset:AST_IMG"]);
});
