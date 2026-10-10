import { costHintText, type GenerationDTO, type ProviderDescriptorDTO } from "@arch/domain";
import type { SpendRequest } from "../components/common/SpendConfirm";
import type { TFunction } from "../i18n";
import { translateDomainMessage } from "../i18n/domain";

export function spendRequestForGeneration(
  generation: Pick<GenerationDTO, "providerId" | "modelId" | "params">,
  providers: readonly ProviderDescriptorDTO[] | null | undefined,
  t: TFunction,
): SpendRequest {
  const provider = providers?.find((item) => item.id === generation.providerId);
  const model = provider?.models.find((item) => item.id === generation.modelId);
  const count = generation.params.outputCount;
  const unit = generation.params.imageSize
    ? model?.priceHint?.[generation.params.imageSize]
    : undefined;
  return {
    providerId: generation.providerId,
    provider: provider?.label ?? generation.providerId,
    model: model?.label ?? generation.modelId,
    imageCount: count,
    costText: model
      ? translateDomainMessage(costHintText(model, generation.params.imageSize, count) ?? "", t)
      : null,
    estimatedTotal: unit === undefined ? null : unit * count,
  };
}
