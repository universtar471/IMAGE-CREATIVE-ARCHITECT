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
  provider: ProviderDescriptorDTO | null;
  model: ModelCapabilities | null;
  purpose: GenerationPurpose;
  params: GenerationParams;
  /** Selected references, in submit order (= prompt "Image N" order). */
  referenceIds: string[];
  /** Every asset that could be a reference, in the same order; missing files included (disabled). */
  candidates: AssetDTO[];
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
  const referenceIds = draft.referenceAssetIds
    ? orderReferenceIds(draft.referenceAssetIds, ready)
    : model
      ? defaultReferenceIds(assets, model)
      : [];
  // Default aspect follows the master, else the first selected reference.
  const anchor =
    assets.find((a) => a.id === masterAssetId) ??
    assets.find((a) => a.id === referenceIds[0]) ??
    null;
  const params = !model
    ? FALLBACK_PARAMS
    : draft.params
      ? adaptGenerationParams(draft.params, model, anchor)
      : defaultGenerationParams(model, anchor);
  return {
    provider,
    model,
    // Variations need an approved master (ADR-022), so a project without one starts on Hero:
    // the first good hero image becomes the master.
    purpose: draft.purpose ?? "hero",
    params,
    referenceIds,
    candidates: orderReferences(assets),
  };
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
  if (!form.provider.configured)
    return t("generate.reasonNeedsKey", { provider: form.provider.label });
  if (ctx.dnaInvalid) return t("generate.reasonDnaInvalid");
  const issues = validateGenerationRequest(
    // The prompt is compiled at submit time from persisted DNA; it is never empty.
    { prompt: { positivePrompt: "-" }, referenceAssetIds: form.referenceIds, params: form.params },
    form.model,
    ctx.assets,
  );
  return issues[0] ? translateDomainMessage(issues[0].message) : null;
}
