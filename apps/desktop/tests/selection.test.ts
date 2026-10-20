import { describe, expect, it } from "vitest";
import type { AssetDTO, GenerationDTO } from "@arch/domain";
import { actionsFor, splitActions } from "../src/features/selection/actions";
import { nodeScreenRect, placeToolbar } from "../src/features/selection/placement";
import {
  resolveSelection,
  selectionKey,
  type SelectionInput,
} from "../src/features/selection/selection";
import { viewerSetFor } from "../src/features/selection/viewerSet";
import { asset } from "./helpers";

const P = "PRJ_S";
const source = asset(P, "AST_SRC", { role: "structure_sketch", source: "sketchup" });
const imported = asset(P, "AST_IMP", { role: "regular_image" });
const ai = asset(P, "AST_AI", { source: "ai_generated", role: "regular_image" });
const ai2 = asset(P, "AST_AI2", { source: "ai_generated", role: "regular_image" });
const ref = asset(P, "AST_REF", { role: "material_reference" });
const clip = asset(P, "AST_CLIP", {
  source: "ai_generated",
  role: "regular_image",
  mimeType: "video/mp4",
  mediaKind: "video",
  parentAssetId: "AST_AI",
});
const assets: AssetDTO[] = [source, imported, ai, ai2, ref, clip];

const gen = (id: string, status: GenerationDTO["status"], outputs: string[] = []) =>
  ({
    id,
    projectId: P,
    providerId: "local_preview",
    modelId: "m",
    purpose: "hero",
    status,
    prompt: {
      compilerVersion: "pc",
      positivePrompt: "p",
      negativePrompt: "",
      referenceInstructions: "",
      preservationInstructions: "",
      metadata: {},
      shotIntent: { presetIds: ["time.night"] },
    },
    referenceAssetIds: ["AST_SRC"],
    params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
    parentAssetId: "AST_SRC",
    outputAssetIds: outputs,
    error: status === "failed" ? { kind: "network", message: "x", retryable: true } : null,
    cameraId: null,
    batchId: null,
    jobId: `JOB_${id}`,
    createdAt: "2026-01-01T00:00:00Z",
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  }) as unknown as GenerationDTO;

const generations = [
  gen("GEN_RUN", "running"),
  gen("GEN_DONE", "completed", ["AST_AI", "AST_AI2"]),
];

const input = (over: Partial<SelectionInput>): SelectionInput => ({
  mode: "node",
  canvasSelection: [],
  selectedAssetId: null,
  assets,
  generations,
  draftReferenceIds: [],
  draft: { sourceAssetId: "AST_SRC", presetIds: ["time.night"] },
  readOnly: false,
  ...over,
});
const node = (ids: string[], over: Partial<SelectionInput> = {}) =>
  resolveSelection(input({ canvasSelection: ids, ...over }));
const ids = (sel: ReturnType<typeof node>) => actionsFor(sel).map((a) => a.action.id);

describe("normalised selection (ADR-044)", () => {
  it("tells image, clip, reference, job and draft nodes apart", () => {
    expect(selectionKey(node(["asset:AST_SRC"]))).toBe("image:AST_SRC");
    expect(node(["asset:AST_SRC"])).toMatchObject({ kind: "image", origin: "source" });
    expect(node(["asset:AST_IMP"])).toMatchObject({ kind: "image", origin: "import" });
    expect(node(["asset:AST_AI"])).toMatchObject({ kind: "image", origin: "ai" });
    expect(node(["asset:AST_CLIP"]).kind).toBe("video");
    expect(node(["asset:AST_REF"])).toMatchObject({ kind: "reference", inDraft: false });
    expect(node(["asset:AST_REF"], { draftReferenceIds: ["AST_REF"] })).toMatchObject({
      inDraft: true,
    });
    expect(node(["gen:GEN_RUN"])).toMatchObject({ kind: "generation", phase: "pending" });
    expect(node(["gen:GEN_DONE"])).toMatchObject({ phase: "complete" });
    expect(node(["draft"])).toMatchObject({ kind: "draft", sourceAssetId: "AST_SRC" });
    expect(node(["asset:AST_AI", "asset:AST_CLIP"]).kind).toBe("multi");
    expect(node([]).kind).toBe("none");
    expect(node(["asset:GONE"]).kind).toBe("none");
  });

  it("uses the selected asset in Studio mode and ignores graph nodes there", () => {
    const studio = resolveSelection(
      input({ mode: "studio", selectedAssetId: "AST_CLIP", canvasSelection: ["gen:GEN_RUN"] }),
    );
    expect(selectionKey(studio)).toBe("video:AST_CLIP");
    expect(resolveSelection(input({ mode: "studio" })).kind).toBe("none");
  });
});

describe("action registry", () => {
  it("offers image actions for images and only video actions for clips", () => {
    expect(ids(node(["asset:AST_SRC"]))).toEqual(
      expect.arrayContaining(["create_from_source", "references", "camera", "expand"]),
    );
    expect(ids(node(["asset:AST_AI"]))).toEqual(
      expect.arrayContaining(["continue_from_ai", "detail", "grade", "enhance", "make_video"]),
    );
    const video = ids(node(["asset:AST_CLIP"]));
    expect(video).toEqual(["play", "view_source", "remake_video"]);
    for (const imageOnly of ["grade", "enhance", "detail", "expand", "compare", "analyse"])
      expect(video).not.toContain(imageOnly);
  });

  it("never offers a reference as the master and lets it be toggled in the draft", () => {
    const refActions = ids(node(["asset:AST_REF"]));
    expect(refActions).toEqual(expect.arrayContaining(["reference_role", "toggle_reference"]));
    expect(refActions).not.toContain("create_from_source");
    const toggle = actionsFor(node(["asset:AST_REF"], { draftReferenceIds: ["AST_REF"] })).find(
      (a) => a.action.id === "toggle_reference",
    )!;
    expect(
      toggle.action.labelFor?.(node(["asset:AST_REF"], { draftReferenceIds: ["AST_REF"] })),
    ).toBe("selectionActions.excludeReference");
  });

  it("matches the job state and marks Retry as paid", () => {
    expect(ids(node(["gen:GEN_RUN"]))).toEqual(
      expect.arrayContaining(["copy_prompt", "cancel_job"]),
    );
    expect(ids(node(["gen:GEN_RUN"]))).not.toContain("show_outputs");
    expect(ids(node(["gen:GEN_DONE"]))).toContain("show_outputs");
    const failed = resolveSelection(
      input({ canvasSelection: ["gen:GEN_F"], generations: [gen("GEN_F", "failed")] }),
    );
    const retry = actionsFor(failed).find((a) => a.action.id === "retry")!;
    expect(retry.action.risk).toBe("paid");
  });

  it("compares exactly two images and refuses clips with a reason", () => {
    const two = actionsFor(node(["asset:AST_AI", "asset:AST_AI2"])).find(
      (a) => a.action.id === "compare",
    )!;
    expect(two.disabledReason).toBeNull();
    const withClip = actionsFor(node(["asset:AST_AI", "asset:AST_CLIP"])).find(
      (a) => a.action.id === "compare",
    )!;
    expect(withClip.disabledReason).toBe("selectionActions.reason.compareImagesOnly");
    const three = actionsFor(node(["asset:AST_AI", "asset:AST_AI2", "asset:AST_IMP"])).find(
      (a) => a.action.id === "compare",
    )!;
    expect(three.disabledReason).toBe("selectionActions.reason.compareTwo");
  });

  it("keeps viewing in read-only projects and disables every change", () => {
    const sel = node(["asset:AST_AI"], { readOnly: true });
    const resolved = actionsFor(sel);
    expect(resolved.find((a) => a.action.id === "continue_from_ai")!.disabledReason).toBe(
      "selectionActions.reason.readOnly",
    );
    expect(resolved.find((a) => a.action.id === "expand")!.disabledReason).toBeNull();
    for (const a of resolved)
      if (a.action.risk !== "view") expect(a.disabledReason, a.action.id).not.toBeNull();
  });

  it("offers adding and creating when nothing is selected", () => {
    expect(ids(node([]))).toEqual(["add_image", "open_generate", "open_library"]);
    const { shown, more } = splitActions(actionsFor(node(["asset:AST_AI"])), 4);
    expect(shown).toHaveLength(4);
    expect(more.length).toBeGreaterThan(0);
  });
});

describe("toolbar placement", () => {
  const container = { width: 800, height: 600 };
  const toolbar = { width: 200, height: 40 };

  it("sits above the node, falls back below near the top, and stays inside", () => {
    expect(
      placeToolbar({ left: 300, top: 200, width: 100, height: 80 }, toolbar, container),
    ).toEqual({ left: 250, top: 150, side: "above" });
    expect(
      placeToolbar({ left: 300, top: 20, width: 100, height: 80 }, toolbar, container).side,
    ).toBe("below");
    const atEdge = placeToolbar(
      { left: 760, top: 200, width: 100, height: 80 },
      toolbar,
      container,
    );
    expect(atEdge.left).toBe(800 - 200 - 8);
    const zoomed = placeToolbar(
      { left: -100, top: -50, width: 1200, height: 900 },
      toolbar,
      container,
    );
    expect(zoomed).toMatchObject({ side: "inside", top: 8, left: 400 });
  });

  it("follows the canvas pan and zoom", () => {
    expect(nodeScreenRect({ x: 100, y: 50 }, { width: 200, height: 100 }, [10, 20, 0.5])).toEqual({
      left: 60,
      top: 45,
      width: 100,
      height: 50,
    });
  });
});

describe("viewer navigation set", () => {
  it("steps through one run's outputs, else same-kind assets of the project", () => {
    expect(viewerSetFor("AST_AI2", assets, generations)).toEqual(["AST_AI", "AST_AI2"]);
    const images = viewerSetFor("AST_SRC", assets, generations);
    expect(images).toContain("AST_SRC");
    expect(images).not.toContain("AST_CLIP");
    expect(viewerSetFor("AST_CLIP", assets, generations)).toEqual(["AST_CLIP"]);
  });
});
