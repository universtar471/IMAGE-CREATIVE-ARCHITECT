import { KeyRound, Sparkles } from "lucide-react";
import { useStudio } from "../../app/store";

/** Top-bar provider state: how many providers are ready. Opens settings. (The queue indicator shows jobs.) */
export function ProviderChip() {
  const providers = useStudio((s) => s.providers);
  const open = useStudio((s) => s.openProviderDialog);
  const ready = providers?.filter((p) => p.configured) ?? [];
  const needsKey = providers?.filter((p) => !p.configured) ?? [];

  return (
    <button
      className="btn btn-ghost btn-sm provider-chip"
      onClick={() => open(needsKey[0]?.id ?? null)}
      title="Image provider settings"
      data-testid="provider-chip"
    >
      <Sparkles size={14} />
      {providers ? `${ready.length}/${providers.length} providers ready` : "Providers"}
      {needsKey.length > 0 && (
        <span className="badge badge-warning">
          <KeyRound size={10} /> Set API key
        </span>
      )}
    </button>
  );
}
