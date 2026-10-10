/**
 * Derive the effective Generate form from the user's draft + provider capabilities +
 * project assets. Pure (no store, no React), so it is derived during render and unit-tested.
 */
import {
  adaptGenerationParams,
  defaultGenerationParams,
  defaultReferenceIds,
  orderReferenceIds,
  orderReferences,
  validateGenerationRequest,
  type AssetDTO,
  type GenerationParams,
  type GenerationPurpose,
  type ModelCapabilities,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import type { GenerateDraft } from "../../app/store";
import { t } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";

export type GenerateForm = {
  source: "dna" | "sketch";
  sketch: AssetDTO | null;
  structureSketches: AssetDTO[];
  provider: ProviderDescriptorDTO | null;
  model: ModelCapabilities | null;
  purpose: GenerationPurpose;
  params: GenerationParams;
  /** Selected references, in submit order (= prompt "Image N" order). */
  referenceIds: string[];
  /** Every asset that could be a reference, in the same order; missing files included (disabled). */
  candidates: AssetDTO[];
  /**
   * References the user cannot untick. A variation always carries the master as image 1:
   * without it the model only sees text and draws a different building.
   */
  pinnedIds: string[];
};

const FALLBACK_PARAMS: GenerationParams = {
  aspectRatio: null,
  imageSize: null,
  outputCount: 1,
  seed: null,
  quality: null,
};

export function resolveGenerateForm(
  draft: GenerateDraft,
  providers: readonly ProviderDescriptorDTO[],
  assets: readonly AssetDTO[],
  masterAssetId: string | null,
): GenerateForm {
  const provider =
    providers.find((p) => p.id === draft.providerId) ??
    providers.find((p) => p.configured) ??
    providers[0] ??
    null;
  const model = provider
    ? (provider.models.find((m) => m.id === draft.modelId) ?? provider.models[0] ?? null)
    : null;
  const ready = assets.filter((a) => a.status === "ready");
  const source = draft.source ?? "dna";
  // Variations need an approved master (ADR-022), so a project without one starts on Hero:
  // the first good hero image becomes the master.
  const purpose = source === "sketch" ? "hero" : (draft.purpose ?? "hero");
  const readySketches = ready
    .filter((asset) => asset.role === "structure_sketch")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const requestedSketch = draft.referenceAssetIds
    ?.map((id) => readySketches.find((asset) => asset.id === id))
    .find((asset): asset is AssetDTO => asset !== undefined);
  const sketch = source === "sketch" ? (requestedSketch ?? readySketches[0] ?? null) : null;
  const chosen = draft.referenceAssetIds
    ? orderReferenceIds(draft.referenceAssetIds, ready)
    : model
      ? defaultReferenceIds(assets, model)
      : [];
  const master = ready.find((a) => a.id === masterAssetId) ?? null;
  const pinnedIds = sketch
    ? [sketch.id]
    : purpose === "variation" && master && model?.imageToImage
      ? [master.id]
      : [];
  const sketchChosen = chosen.filter((id) => {
    const asset = ready.find((candidate) => candidate.id === id);
    return asset?.role !== "master_architecture" && asset?.role !== "structure_sketch";
  });
  const referenceIds = sketch
    ? [sketch.id, ...sketchChosen.slice(0, Math.max(0, (model?.maxReferenceImages ?? 0) - 1))]
    : pinnedIds.length
      ? withPinned(chosen, pinnedIds, ready, model!.maxReferenceImages)
      : chosen;
  // Sketch mode follows the sketch; otherwise the master, then the first selected reference.
  const anchor =
    sketch ??
    assets.find((a) => a.id === masterAssetId) ??
    assets.find((a) => a.id === referenceIds[0]) ??
    null;
  const params = !model
    ? FALLBACK_PARAMS
    : draft.params
      ? adaptGenerationParams(draft.params, model, anchor)
      : defaultGenerationParams(model, anchor);
  return {
    source,
    sketch,
    structureSketches: readySketches,
    provider,
    model,
    purpose,
    params,
    referenceIds,
    candidates:
      source === "sketch"
        ? orderReferences(
            assets.filter(
              (asset) =>
                asset.role !== "master_architecture" &&
                (asset.role !== "structure_sketch" || asset.id === sketch?.id),
            ),
          )
        : orderReferences(assets),
    pinnedIds,
  };
}

/** `chosen` plus `pinned`, in reference order, dropping unpinned ones past the model cap. */
function withPinned(
  chosen: readonly string[],
  pinned: readonly string[],
  ready: readonly AssetDTO[],
  cap: number,
): string[] {
  const ordered = orderReferenceIds([...pinned, ...chosen], ready);
  const room = Math.max(0, cap - pinned.length);
  const rest = ordered.filter((id) => !pinned.includes(id)).slice(0, room);
  return ordered.filter((id) => pinned.includes(id) || rest.includes(id));
}

export type GenerateContext = {
  readOnly: boolean;
  /** The previous request is still being compiled/enqueued. */
  submitting: boolean;
  dnaInvalid: boolean;
  assets: readonly AssetDTO[];
};

/** Why Generate is disabled, as text for the user; null when it can run. */
export function generateDisabledReason(form: GenerateForm, ctx: GenerateContext): string | null {
  if (ctx.readOnly) return t("generate.reasonArchived");
  if (ctx.submitting) return t("generate.reasonSubmitting");
  if (!form.provider || !form.model) return t("generate.reasonNoProvider");
  if (form.source === "sketch" && !form.sketch) return t("generate.reasonNoSketch");
  if (form.source === "sketch" && !form.model.imageToImage)
    return t("generate.reasonSketchNeedsRefs", { model: form.model.label });
  if (!form.provider.configured)
    return t("generate.reasonNeedsKey", { provider: form.provider.label });
  if (ctx.dnaInvalid) return t("generate.reasonDnaInvalid");
  if (form.purpose === "variation" && !form.model.imageToImage)
    return t("generate.reasonVariationNeedsRefs", { model: form.model.label });
  const issues = validateGenerationRequest(
    // The prompt is compiled at submit time from persisted DNA; it is never empty.
    { prompt: { positivePrompt: "-" }, referenceAssetIds: form.referenceIds, params: form.params },
    form.model,
    ctx.assets,
  );
  return issues[0] ? translateDomainMessage(issues[0].message) : null;
}
