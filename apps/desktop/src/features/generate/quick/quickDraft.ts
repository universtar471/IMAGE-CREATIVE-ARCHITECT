/**
 * Quick generate (ADR-040, UI-3): the source, faithfulness and request choices of the
 * quick-generate screen, expressed as the existing Generate draft. Nothing here adds a
 * generation setting: the screen only fills `source`, `purpose` and `referenceAssetIds`, so
 * the compiled prompt, the gate and the submit are exactly those of the Generate panel.
 * Pure (no store, no React).
 */
import {
  orderReferenceIds,
  type AssetDTO,
  type AssetRole,
  type ModelCapabilities,
} from "@arch/domain";
import type { GenerateDraft } from "../../../app/store";

/**
 * - `existing`: an image the compiler treats as the authoritative design
 *   (`master_architecture`: "match its massing, proportions … exactly").
 * - `sketch`: a `structure_sketch` (the Generate panel's sketch source).
 * - `text`: no source image; the Design DNA plus the wish (the panel's DNA source).
 */
export type QuickSource = "existing" | "sketch" | "text";
export const QUICK_SOURCES: readonly QuickSource[] = ["existing", "sketch", "text"];

/** How far the result may move from the source image. */
export type Faithfulness = "keep" | "balanced" | "creative";
export const FAITHFULNESS_LEVELS: readonly Faithfulness[] = ["keep", "balanced", "creative"];

/** The reference role each image source is sent with. */
export const SOURCE_ROLE: Record<Exclude<QuickSource, "text">, AssetRole> = {
  existing: "master_architecture",
  sketch: "structure_sketch",
};

/**
 * Faithfulness is the set of extra references sent next to the source, by role:
 * - keep: the source alone;
 * - balanced: plus the setting references (materials, context, landscape, light, mood, camera);
 * - creative: plus the architecture references, whose design language may then be borrowed.
 */
const BALANCED_ROLES: readonly AssetRole[] = [
  "material_reference",
  "context_reference",
  "landscape_reference",
  "lighting_reference",
  "mood_reference",
  "camera_reference",
];
export const FAITHFULNESS_ROLES: Record<Faithfulness, readonly AssetRole[]> = {
  keep: [],
  balanced: BALANCED_ROLES,
  creative: ["architecture_reference", ...BALANCED_ROLES],
};

export type QuickChoice = {
  source: QuickSource;
  /** Chosen source image (existing / sketch); ignored for `text`. */
  sourceAssetId: string | null;
  faithfulness: Faithfulness;
};

/**
 * Sources the current pipeline can serve with this model: both image sources need
 * image-to-image references; a text-only model offers `text` alone.
 */
export function availableQuickSources(model: ModelCapabilities | null): QuickSource[] {
  if (!model) return ["text"];
  return model.imageToImage && model.maxReferenceImages > 0 ? [...QUICK_SOURCES] : ["text"];
}

/** Ready images that can be the source, the project's active master first, then newest. */
export function sourceCandidates(
  source: QuickSource,
  assets: readonly AssetDTO[],
  masterAssetId: string | null,
): AssetDTO[] {
  if (source === "text") return [];
  const role = SOURCE_ROLE[source];
  return assets
    .filter((a) => a.status === "ready" && a.role === role)
    .sort(
      (a, b) =>
        Number(b.id === masterAssetId) - Number(a.id === masterAssetId) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
}

/** The chosen source asset when it is still a candidate, else the first candidate. */
export function resolveSourceAsset(
  choice: QuickChoice,
  assets: readonly AssetDTO[],
  masterAssetId: string | null,
): AssetDTO | null {
  const candidates = sourceCandidates(choice.source, assets, masterAssetId);
  return candidates.find((a) => a.id === choice.sourceAssetId) ?? candidates[0] ?? null;
}

/** The source plus the faithfulness references, in prompt order, within the model's cap. */
export function faithfulnessReferenceIds(
  sourceId: string,
  faithfulness: Faithfulness,
  assets: readonly AssetDTO[],
  cap: number,
): string[] {
  const roles = FAITHFULNESS_ROLES[faithfulness];
  const extras = orderReferenceIds(
    assets.filter((a) => a.status === "ready" && roles.includes(a.role)).map((a) => a.id),
    assets,
  ).filter((id) => id !== sourceId);
  return [sourceId, ...extras].slice(0, Math.max(1, cap));
}

/**
 * The Generate draft that represents a quick-generate choice. The wish, the parameters,
 * the provider and the accepted exceptions stay as they are in `draft`; the quick screen
 * always makes a Hero image.
 */
export function quickDraft(
  draft: GenerateDraft,
  choice: QuickChoice,
  assets: readonly AssetDTO[],
  masterAssetId: string | null,
  model: ModelCapabilities | null,
): GenerateDraft {
  if (choice.source === "text") {
    // The panel's DNA source with its default references (the master leads when set).
    return { ...draft, source: "dna", purpose: "hero", referenceAssetIds: null };
  }
  const asset = resolveSourceAsset(choice, assets, masterAssetId);
  const cap = model?.maxReferenceImages ?? 1;
  const referenceAssetIds = asset
    ? faithfulnessReferenceIds(asset.id, choice.faithfulness, assets, cap)
    : [];
  return {
    ...draft,
    source: choice.source === "sketch" ? "sketch" : "dna",
    purpose: "hero",
    referenceAssetIds,
  };
}

/**
 * The quick choice when the screen opens. A given source asset (e.g. "use as source" from the
 * library) picks the source that matches its role; otherwise the panel's sketch source stays
 * sketch and everything else starts on the existing image.
 */
export function initialQuickChoice(
  draft: GenerateDraft,
  model: ModelCapabilities | null,
  assets: readonly AssetDTO[],
  sourceAssetId: string | null = null,
): QuickChoice {
  const sources = availableQuickSources(model);
  const given = assets.find((a) => a.id === sourceAssetId);
  const wanted: QuickSource =
    given?.role === "structure_sketch"
      ? "sketch"
      : given?.role === "master_architecture"
        ? "existing"
        : draft.source === "sketch"
          ? "sketch"
          : "existing";
  return {
    source: sources.includes(wanted) ? wanted : "text",
    sourceAssetId: given ? given.id : null,
    faithfulness: "balanced",
  };
}

/** Read-only "Thiết kế cần giữ" facts from the DNA (labels are added by the caller). */
export type KeepFacts = {
  style: string | null;
  floors: number | null;
  roof: string | null;
  materials: string[];
  locked: Array<"building" | "context" | "camera" | "lighting" | "weather" | "mood">;
};

export function keepFacts(dna: {
  building: {
    architecturalStyle?: string;
    floors?: number;
    roof: { type?: string };
    materials: ReadonlyArray<{ zone: string; description: string }>;
  };
  locks: Record<"building" | "context" | "camera" | "lighting" | "weather" | "mood", boolean>;
}): KeepFacts {
  const b = dna.building;
  return {
    style: b.architecturalStyle?.trim() || null,
    floors: b.floors ?? null,
    roof: b.roof.type?.trim() || null,
    // Guard against a draft that is mid-edit and not yet schema-valid.
    materials: Array.isArray(b.materials)
      ? b.materials.map((m) => `${m.zone}: ${m.description}`)
      : [],
    locked: (["building", "context", "camera", "lighting", "weather", "mood"] as const).filter(
      (key) => dna.locks[key],
    ),
  };
}
