import { KeyRound, Sparkles } from "lucide-react";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";

/** Top-bar provider state: how many providers are ready. Opens settings. (The queue indicator shows jobs.) */
export function ProviderChip() {
  const providers = useStudio((s) => s.providers);
  const open = useStudio((s) => s.openProviderDialog);
  const ready = providers?.filter((p) => p.configured) ?? [];
  const needsKey = providers?.filter((p) => !p.configured) ?? [];
  const t = useT();

  return (
    <button
      className="btn btn-ghost btn-sm provider-chip"
      onClick={() => open(needsKey[0]?.id ?? null)}
      title={t("providers.chipTitle")}
      data-testid="provider-chip"
    >
      <Sparkles size={14} />
      {providers
        ? t("providers.ready", { ready: ready.length, total: providers.length })
        : t("providers.providers")}
      {needsKey.length > 0 && (
        <span className="badge badge-warning">
          <KeyRound size={10} /> {t("providers.setApiKey")}
        </span>
      )}
    </button>
  );
}
