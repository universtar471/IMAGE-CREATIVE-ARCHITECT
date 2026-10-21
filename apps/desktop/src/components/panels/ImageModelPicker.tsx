import type { ModelCapabilities, ProviderDescriptorDTO } from "@arch/domain";
import { Settings2 } from "lucide-react";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { SectionPanel } from "./SectionPanel";
import { SelectField } from "./fields";
import { isImageProvider } from "@arch/domain";

export function useImageModelChoice() {
  const all = useStudio((s) => s.providers);
  const draft = useStudio((s) => s.generateDraft);
  const providers = (all ?? []).filter((p) => isImageProvider(p) && p.id !== "local_upscale");
  const provider =
    providers.find((p) => p.id === draft.providerId) ??
    providers.find((p) => p.configured) ??
    providers[0];
  const model = provider?.models.find((m) => m.id === draft.modelId) ?? provider?.models[0];
  return {
    providers,
    provider,
    model,
    onProvider: (providerId: string) =>
      useStudio.getState().setGenerateDraft({ providerId, modelId: null }),
    onModel: (modelId: string) => useStudio.getState().setGenerateDraft({ modelId }),
  };
}

export function ImageModelPicker({
  providers,
  provider,
  model,
  onProvider,
  onModel,
  disabled = false,
}: {
  providers: readonly ProviderDescriptorDTO[];
  provider: ProviderDescriptorDTO | null | undefined;
  model: ModelCapabilities | null | undefined;
  onProvider: (id: string) => void;
  onModel: (id: string) => void;
  disabled?: boolean;
}) {
  const t = useT();
  const open = useStudio((s) => s.openProviderDialog);
  return (
    <SectionPanel
      title={t("generate.model")}
      aside={
        <button
          type="button"
          className="btn btn-sm btn-icon"
          aria-label={t("generate.providerSettings")}
          onClick={(e) => {
            e.preventDefault();
            open(provider?.id ?? null);
          }}
        >
          <Settings2 size={14} />
        </button>
      }
    >
      <SelectField
        label={t("generate.provider")}
        allowEmpty={false}
        value={provider?.id}
        disabled={disabled}
        options={providers.map((p) => ({
          value: p.id,
          label: p.configured ? p.label : t("generate.needsKeyOption", { label: p.label }),
        }))}
        onChange={(id) => id && onProvider(id)}
      />
      <SelectField
        label={t("generate.model")}
        allowEmpty={false}
        value={model?.id}
        disabled={disabled}
        options={(provider?.models ?? []).map((m) => ({ value: m.id, label: m.label }))}
        onChange={(id) => id && onModel(id)}
      />
    </SectionPanel>
  );
}
