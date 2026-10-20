import { describe, expect, it } from "vitest";
import {
  AI_CHAIN_WARNING_DEPTH,
  CANVAS_COLUMN_WIDTH,
  CanvasLayoutSchema,
  DRAFT_NODE_ID,
  buildBranchGraph,
  deepAiChain,
  generationNodeId,
  imageNodeId,
  layoutBranchGraph,
  type AssetDTO,
  type GenerationDTO,
} from "../src";

const asset = (id: string, at: string, extra: Partial<AssetDTO> = {}): AssetDTO =>
  ({
    id,
    projectId: "PRJ_1",
    source: "ai_generated",
    role: "regular_image",
    status: "ready",
    originalName: `${id}.png`,
    managedRelPath: `assets/original/${id}.png`,
    absolutePath: `/x/${id}.png`,
    thumbnailPath: null,
    mimeType: "image/png",
    fileSizeBytes: 1,
    widthPx: 10,
    heightPx: 10,
    sha256: null,
    parentAssetId: null,
    operation: "generate",
    createdAt: at,
    updatedAt: at,
    ...extra,
  }) as AssetDTO;

const generation = (
  id: string,
  at: string,
  refs: string[],
  outputs: string[],
  presetIds?: string[],
): GenerationDTO =>
  ({
    id,
    projectId: "PRJ_1",
    providerId: "local_preview",
    modelId: "placeholder-v1",
    purpose: "hero",
    status: "succeeded",
    prompt: { ...(presetIds ? { shotIntent: { projectType: "villa", presetIds } } : {}) },
    referenceAssetIds: refs,
    params: {},
    parentAssetId: refs[0] ?? null,
    outputAssetIds: outputs,
    error: null,
    cameraId: null,
    batchId: null,
    jobId: null,
    createdAt: at,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  }) as unknown as GenerationDTO;

const sketch = asset("AST_SK", "t01", { source: "sketchup", role: "structure_sketch" });
const mood = asset("AST_MOOD", "t02", { source: "external", role: "mood_reference" });
const loose = asset("AST_LOOSE", "t03", { source: "external", role: "regular_image" });

const sample = () => ({
  assets: [
    sketch,
    mood,
    loose,
    asset("AST_A1", "t11"),
    asset("AST_A2", "t12"),
    asset("AST_B1", "t21"),
  ],
  generations: [
    // Out of order on purpose: the builder sorts by time.
    generation("GEN_B", "t20", ["AST_A1"], ["AST_B1"], ["time.night"]),
    generation("GEN_A", "t10", ["AST_SK", "AST_MOOD"], ["AST_A1", "AST_A2"], ["time.golden_hour"]),
  ],
});

describe("branch graph (ADR-041)", () => {
  it("derives images, generations and edges from lineage", () => {
    const graph = buildBranchGraph(sample());
    expect(graph.nodes.map((n) => n.id)).toEqual([
      imageNodeId("AST_SK"),
      imageNodeId("AST_MOOD"),
      generationNodeId("GEN_A"),
      imageNodeId("AST_A1"),
      imageNodeId("AST_A2"),
      generationNodeId("GEN_B"),
      imageNodeId("AST_B1"),
    ]);
    expect(graph.nodes.some((n) => n.id === imageNodeId("AST_LOOSE"))).toBe(false);
    const gen = graph.nodes.find((n) => n.id === generationNodeId("GEN_A"));
    expect(gen).toMatchObject({ kind: "generation", presetIds: ["time.golden_hour"], depth: 1 });
    expect(graph.edges).toContainEqual({
      id: `${imageNodeId("AST_SK")}->${generationNodeId("GEN_A")}`,
      from: imageNodeId("AST_SK"),
      to: generationNodeId("GEN_A"),
      primary: true,
    });
    expect(
      graph.edges.find((e) => e.from === imageNodeId("AST_MOOD"))?.primary,
      "a mood reference is not the lineage parent",
    ).toBe(false);
    expect(graph.nodes.find((n) => n.id === imageNodeId("AST_B1"))?.depth).toBe(4);
  });

  it("is deterministic and acyclic", () => {
    const a = buildBranchGraph(sample());
    const b = buildBranchGraph({
      assets: [...sample().assets].reverse(),
      generations: [...sample().generations].reverse(),
    });
    expect(a).toEqual(b);
    const depth = new Map(a.nodes.map((n) => [n.id, n.depth]));
    for (const e of a.edges) expect(depth.get(e.to)!).toBeGreaterThan(depth.get(e.from)!);
  });

  it("adds a dashed draft after the chosen source, never a run", () => {
    const graph = buildBranchGraph({
      ...sample(),
      draft: { sourceAssetId: "AST_B1", presetIds: ["weather.after_rain"] },
    });
    const draft = graph.nodes.find((n) => n.id === DRAFT_NODE_ID);
    expect(draft).toMatchObject({ kind: "draft", sourceAssetId: "AST_B1", depth: 5 });
    expect(graph.edges.at(-1)).toMatchObject({ from: imageNodeId("AST_B1"), to: DRAFT_NODE_ID });
    expect(
      buildBranchGraph({ ...sample(), draft: { sourceAssetId: "nope", presetIds: [] } }).nodes,
    ).not.toContainEqual(expect.objectContaining({ kind: "draft" }));
  });

  it("counts AI images in a row and warns from the threshold", () => {
    const assets = [sketch, ...["1", "2", "3"].map((n, i) => asset(`AST_C${n}`, `t3${i}`))];
    const generations = [
      generation("GEN_1", "t29", ["AST_SK"], ["AST_C1"]),
      generation("GEN_2", "t30a", ["AST_C1"], ["AST_C2"]),
      generation("GEN_3", "t31a", ["AST_C2"], ["AST_C3"]),
    ];
    const graph = buildBranchGraph({ assets, generations });
    const ai = (id: string) => graph.nodes.find((n) => n.id === imageNodeId(id))!;
    expect(ai("AST_SK")).toMatchObject({ aiDepth: 0 });
    expect(ai("AST_C2")).toMatchObject({ aiDepth: 2 });
    expect(ai("AST_C3")).toMatchObject({ aiDepth: AI_CHAIN_WARNING_DEPTH });
    expect(deepAiChain(ai("AST_C2"))).toBe(false);
    expect(deepAiChain(ai("AST_C3"))).toBe(true);
  });
});

describe("canvas layout", () => {
  it("places nodes in depth columns and lets saved positions win", () => {
    const graph = buildBranchGraph(sample());
    const auto = layoutBranchGraph(graph);
    expect(auto[imageNodeId("AST_SK")]).toEqual({ x: 0, y: 0 });
    expect(auto[imageNodeId("AST_MOOD")]).toEqual({ x: 0, y: 190 });
    expect(auto[generationNodeId("GEN_A")]).toEqual({ x: CANVAS_COLUMN_WIDTH, y: 0 });
    const saved = CanvasLayoutSchema.parse({
      version: 1,
      positions: { [generationNodeId("GEN_A")]: { x: 5, y: 7 }, "gen:gone": { x: 1, y: 1 } },
    });
    const placed = layoutBranchGraph(graph, saved);
    expect(placed[generationNodeId("GEN_A")]).toEqual({ x: 5, y: 7 });
    expect(placed["gen:gone"]).toBeUndefined();
    expect(
      CanvasLayoutSchema.safeParse({ version: 1, positions: { a: { x: Infinity, y: 0 } } }).success,
    ).toBe(false);
  });
});
