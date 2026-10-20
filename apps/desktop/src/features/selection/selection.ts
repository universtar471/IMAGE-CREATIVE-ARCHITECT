/**
 * Normalised selection (UX V6.1, ADR-044). Every surface that reacts to "what is selected" —
 * the floating toolbar, the inspector, the centre preview and the media viewer — reads this one
 * value, so they can never point at different things.
 *
 * Studio mode selects an asset (`selectedAssetId`); Node mode selects graph nodes
 * (`canvasSelection`, ids from `buildBranchGraph`: `asset:<id>`, `gen:<id>`, `draft`). A clip is
 * an asset whose mediaKind is video, never an image. Pure: no store, no React, no backend.
 */
import {
  isQuickSourceImage,
  isVideoAsset,
  type AssetDTO,
  type AssetRole,
  type GenerationDTO,
} from "@arch/domain";

export type WorkspaceMode = "studio" | "node";

/** Asset roles that make an image a reference rather than a source or result. */
export const REFERENCE_ROLES: readonly AssetRole[] = [
  "architecture_reference",
  "material_reference",
  "context_reference",
  "landscape_reference",
  "lighting_reference",
  "mood_reference",
  "camera_reference",
];

export type ImageOrigin = "source" | "ai" | "import";
export type GenerationPhase = "pending" | "complete" | "failed";

export type Selection =
  | { kind: "none"; readOnly: boolean }
  | { kind: "image"; nodeId?: string; asset: AssetDTO; origin: ImageOrigin; readOnly: boolean }
  | { kind: "video"; nodeId?: string; asset: AssetDTO; readOnly: boolean }
  | {
      kind: "reference";
      nodeId?: string;
      asset: AssetDTO;
      /** Listed in the Generate draft's references right now. */
      inDraft: boolean;
      readOnly: boolean;
    }
  | {
      kind: "generation";
      nodeId?: string;
      generation: GenerationDTO;
      phase: GenerationPhase;
      readOnly: boolean;
    }
  | {
      kind: "draft";
      nodeId: string;
      sourceAssetId: string | null;
      presetIds: readonly string[];
      readOnly: boolean;
    }
  | { kind: "multi"; items: Exclude<Selection, { kind: "multi" | "none" }>[]; readOnly: boolean };

export type SelectionKind = Selection["kind"];

export type SelectionInput = {
  mode: WorkspaceMode;
  canvasSelection: readonly string[];
  selectedAssetId: string | null;
  assets: readonly AssetDTO[];
  generations: readonly GenerationDTO[];
  /** References the Generate draft would send (already resolved), for `inDraft`. */
  draftReferenceIds: readonly string[];
  draft: { sourceAssetId: string | null; presetIds: readonly string[] } | null;
  readOnly: boolean;
};

export function isReferenceAsset(asset: Pick<AssetDTO, "role">): boolean {
  return REFERENCE_ROLES.includes(asset.role);
}

export function generationPhase(status: GenerationDTO["status"]): GenerationPhase {
  if (status === "queued" || status === "running") return "pending";
  if (status === "completed") return "complete";
  return "failed";
}

function fromAsset(
  asset: AssetDTO,
  input: SelectionInput,
  nodeId?: string,
): Exclude<Selection, { kind: "multi" | "none" | "draft" | "generation" }> {
  const readOnly = input.readOnly;
  const node = nodeId ? { nodeId } : {};
  if (isVideoAsset(asset)) return { kind: "video", asset, readOnly, ...node };
  if (isReferenceAsset(asset))
    return {
      kind: "reference",
      asset,
      inDraft: input.draftReferenceIds.includes(asset.id),
      readOnly,
      ...node,
    };
  const origin: ImageOrigin =
    asset.source === "ai_generated" ? "ai" : isQuickSourceImage(asset) ? "source" : "import";
  return { kind: "image", asset, origin, readOnly, ...node };
}

function fromNode(
  id: string,
  input: SelectionInput,
): Exclude<Selection, { kind: "multi" | "none" }> | null {
  if (id.startsWith("asset:")) {
    const asset = input.assets.find((a) => a.id === id.slice("asset:".length));
    return asset ? fromAsset(asset, input, id) : null;
  }
  if (id.startsWith("gen:")) {
    const generation = input.generations.find((g) => g.id === id.slice("gen:".length));
    return generation
      ? {
          kind: "generation",
          nodeId: id,
          generation,
          phase: generationPhase(generation.status),
          readOnly: input.readOnly,
        }
      : null;
  }
  if (id === "draft" && input.draft)
    return {
      kind: "draft",
      nodeId: id,
      sourceAssetId: input.draft.sourceAssetId,
      presetIds: input.draft.presetIds,
      readOnly: input.readOnly,
    };
  return null;
}

export function resolveSelection(input: SelectionInput): Selection {
  const readOnly = input.readOnly;
  if (input.mode === "node") {
    const items = input.canvasSelection
      .map((id) => fromNode(id, input))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (items.length === 0) return { kind: "none", readOnly };
    if (items.length === 1) return items[0]!;
    return { kind: "multi", items, readOnly };
  }
  const asset = input.assets.find((a) => a.id === input.selectedAssetId);
  return asset ? fromAsset(asset, input) : { kind: "none", readOnly };
}

/** The asset a selection shows, if it shows exactly one. */
export function selectionAsset(selection: Selection): AssetDTO | null {
  return selection.kind === "image" || selection.kind === "video" || selection.kind === "reference"
    ? selection.asset
    : null;
}

/** Stable key of what is selected (ids only), for effects and tests. */
export function selectionKey(selection: Selection): string {
  switch (selection.kind) {
    case "none":
      return "none";
    case "image":
    case "video":
    case "reference":
      return `${selection.kind}:${selection.asset.id}`;
    case "generation":
      return `generation:${selection.generation.id}`;
    case "draft":
      return "draft";
    case "multi":
      return `multi:${selection.items.map(selectionKey).join(",")}`;
  }
}
