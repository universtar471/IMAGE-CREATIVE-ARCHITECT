import {
  adaptGenerationParams,
  defaultGenerationParams,
  generationInputRequired,
  resolveGenerationConflicts,
  type AssetDTO,
  type InteriorGenerationState,
  type ProviderDescriptorDTO,
} from "@arch/domain";
import type { GenerateDraft } from "../../../app/store";
import { t } from "../../../i18n";
import { resolveGenerateForm } from "../form";

export function resolveInteriorGenerateForm(
  draft: GenerateDraft,
  providers: readonly ProviderDescriptorDTO[],
  assets: readonly AssetDTO[],
  masterId: string | null,
  state: InteriorGenerationState,
) {
  const referenceIds = [state.input.assetId, state.reference?.assetId].filter(
    (id): id is string => !!id,
  );
  const source = state.input.assetId ? ("sketch" as const) : ("dna" as const);
  const base = resolveGenerateForm(
    {
      ...draft,
      source,
      referenceAssetIds: referenceIds,
      purpose: state.goal === "variations" ? "variation" : "hero",
    },
    providers,
    assets,
    masterId,
  );
  const inputImage =
    assets.find((a) => a.id === state.input.assetId && a.status === "ready") ?? null;
  const params = base.model
    ? draft.params
      ? adaptGenerationParams(draft.params, base.model, inputImage)
      : defaultGenerationParams(base.model, inputImage)
    : base.params;
  return {
    ...base,
    source,
    sketch: inputImage,
    params,
    referenceIds,
    pinnedIds: state.input.assetId ? [state.input.assetId] : [],
  };
}
export function interiorGenerateDisabledReason(
  state: InteriorGenerationState,
  assets: readonly AssetDTO[],
): string | null {
  if (resolveGenerationConflicts(state).length) return t("interiorFlow.resolveLocks");
  if (generationInputRequired(state) && !state.input.assetId)
    return t("interiorFlow.sourceRequired");
  if (
    [state.input.assetId, state.reference?.assetId].some(
      (id) => id && !assets.some((a) => a.id === id && a.status === "ready"),
    )
  )
    return t("interiorFlow.imageUnavailable");
  if (state.input.assetId && state.input.assetId === state.reference?.assetId)
    return t("interiorFlow.differentReference");
  return null;
}
