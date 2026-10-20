/**
 * Branch canvas (M3, ADR-041): the graph of a project's image branches, derived from data that
 * already exists. Every generation records its references, its lineage parent and its
 * outputs, so the canvas needs no graph table of its own: images → generation → outputs.
 * Runs stay immutable generation records; only node positions are stored (`CanvasLayout`).
 *
 * The builder is pure and deterministic: identical input gives an identical graph.
 */
import { z } from "zod";
import type { AssetDTO } from "../schemas/dto";
import type { GenerationDTO } from "../schemas/generation";

export type ImageNode = {
  id: string;
  kind: "image";
  assetId: string;
  role: AssetDTO["role"];
  source: AssetDTO["source"];
  label: string;
  createdAt: string;
  depth: number;
  /** AI images in a row on the primary lineage chain ending here (0 for a non-AI image). */
  aiDepth: number;
};

export type GenerationNode = {
  id: string;
  kind: "generation";
  generationId: string;
  status: GenerationDTO["status"];
  purpose: GenerationDTO["purpose"];
  providerId: string;
  modelId: string;
  presetIds: string[];
  createdAt: string;
  depth: number;
};

/** What the Generate button would send now: shown dashed, never run from the canvas. */
export type DraftNode = {
  id: typeof DRAFT_NODE_ID;
  kind: "draft";
  sourceAssetId: string;
  presetIds: string[];
  depth: number;
};

export type BranchNode = ImageNode | GenerationNode | DraftNode;

export type BranchEdge = {
  id: string;
  from: string;
  to: string;
  /** The lineage parent of a generation, or a generation's output. */
  primary: boolean;
};

export type BranchGraph = { nodes: BranchNode[]; edges: BranchEdge[] };

export const DRAFT_NODE_ID = "draft";
/** From this many AI images in a row, the canvas suggests going back to the original source. */
export const AI_CHAIN_WARNING_DEPTH = 3;

export const imageNodeId = (assetId: string) => `asset:${assetId}`;
export const generationNodeId = (generationId: string) => `gen:${generationId}`;

const byTimeThenId = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  a.createdAt < b.createdAt
    ? -1
    : a.createdAt > b.createdAt
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

export function buildBranchGraph(input: {
  assets: readonly AssetDTO[];
  generations: readonly GenerationDTO[];
  draft?: { sourceAssetId: string; presetIds: readonly string[] } | null;
}): BranchGraph {
  const assets = new Map(input.assets.map((a) => [a.id, a]));
  const generations = [...input.generations].sort(byTimeThenId);
  const nodes = new Map<string, BranchNode>();
  const edges: BranchEdge[] = [];

  const imageNode = (asset: AssetDTO): ImageNode => {
    const id = imageNodeId(asset.id);
    let node = nodes.get(id) as ImageNode | undefined;
    if (!node) {
      node = {
        id,
        kind: "image",
        assetId: asset.id,
        role: asset.role,
        source: asset.source,
        label: asset.originalName ?? asset.id,
        createdAt: asset.createdAt,
        depth: 0,
        aiDepth: asset.source === "ai_generated" ? 1 : 0,
      };
      nodes.set(id, node);
    }
    return node;
  };

  // Every imported asset is visible immediately, including ordinary images and references.
  // The generation loop below reuses these nodes and assigns outputs their lineage depth.
  for (const asset of [...assets.values()].sort(byTimeThenId)) {
    imageNode(asset);
  }

  for (const g of generations) {
    const id = generationNodeId(g.id);
    const references = g.referenceAssetIds.flatMap((rid) => {
      const asset = assets.get(rid);
      return asset ? [imageNode(asset)] : [];
    });
    const node: GenerationNode = {
      id,
      kind: "generation",
      generationId: g.id,
      status: g.status,
      purpose: g.purpose,
      providerId: g.providerId,
      modelId: g.modelId,
      presetIds: [...(g.prompt.shotIntent?.presetIds ?? [])],
      createdAt: g.createdAt,
      depth: references.reduce((d, r) => Math.max(d, r.depth + 1), 1),
    };
    nodes.set(id, node);
    for (const ref of references) {
      edges.push({
        id: `${ref.id}->${id}`,
        from: ref.id,
        to: id,
        primary: ref.assetId === g.parentAssetId,
      });
    }
    const parent = g.parentAssetId ? nodes.get(imageNodeId(g.parentAssetId)) : undefined;
    const parentAiDepth = parent?.kind === "image" ? parent.aiDepth : 0;
    for (const outputId of g.outputAssetIds) {
      const asset = assets.get(outputId);
      if (!asset) continue;
      const out = imageNode(asset);
      out.depth = Math.max(out.depth, node.depth + 1);
      if (asset.source === "ai_generated") out.aiDepth = parentAiDepth + 1;
      edges.push({ id: `${id}->${out.id}`, from: id, to: out.id, primary: true });
    }
  }

  const draftSource = input.draft ? nodes.get(imageNodeId(input.draft.sourceAssetId)) : undefined;
  const draftAsset = input.draft ? assets.get(input.draft.sourceAssetId) : undefined;
  const source = draftSource ?? (draftAsset ? imageNode(draftAsset) : undefined);
  if (input.draft && source) {
    nodes.set(DRAFT_NODE_ID, {
      id: DRAFT_NODE_ID,
      kind: "draft",
      sourceAssetId: input.draft.sourceAssetId,
      presetIds: [...input.draft.presetIds],
      depth: source.depth + 1,
    });
    edges.push({
      id: `${source.id}->${DRAFT_NODE_ID}`,
      from: source.id,
      to: DRAFT_NODE_ID,
      primary: true,
    });
  }

  const order = (n: BranchNode) => ("createdAt" in n ? n.createdAt : "￿");
  const sorted = [...nodes.values()].sort(
    (a, b) =>
      a.depth - b.depth ||
      (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return { nodes: sorted, edges };
}

// ---------------------------------------------------------------- layout

export type CanvasPosition = { x: number; y: number };

export const CanvasLayoutSchema = z.object({
  version: z.literal(1),
  positions: z.record(z.string(), z.object({ x: z.number().finite(), y: z.number().finite() })),
});
export type CanvasLayout = z.infer<typeof CanvasLayoutSchema>;
export const EMPTY_CANVAS_LAYOUT: CanvasLayout = { version: 1, positions: {} };

export const CANVAS_COLUMN_WIDTH = 280;
export const CANVAS_ROW_HEIGHT = 190;

/**
 * Positions for every node: saved positions win; the others are placed in columns by depth
 * (left to right) and rows in graph order.
 */
export function layoutBranchGraph(
  graph: BranchGraph,
  layout: CanvasLayout = EMPTY_CANVAS_LAYOUT,
): Record<string, CanvasPosition> {
  const rows = new Map<number, number>();
  const out: Record<string, CanvasPosition> = {};
  for (const node of graph.nodes) {
    const row = rows.get(node.depth) ?? 0;
    rows.set(node.depth, row + 1);
    out[node.id] = layout.positions[node.id] ?? {
      x: node.depth * CANVAS_COLUMN_WIDTH,
      y: row * CANVAS_ROW_HEIGHT,
    };
  }
  return out;
}

/** Image nodes whose primary chain has too many AI images in a row (ADR-041). */
export function deepAiChain(node: BranchNode): boolean {
  return node.kind === "image" && node.aiDepth >= AI_CHAIN_WARNING_DEPTH;
}
