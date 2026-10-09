import { Lock, Unlock } from "lucide-react";
import { useDnaLock, type DnaLockSection } from "./DnaFields";
import { useT } from "../../i18n";

export function LockToggle({ section }: { section: DnaLockSection }) {
  const { locked, readOnly, toggle } = useDnaLock(section);
  const t = useT();
  return (
    <button
      className={`btn btn-sm ${locked ? "btn-primary" : "btn-ghost"}`}
      onClick={toggle}
      disabled={readOnly}
      aria-pressed={locked}
      title={locked ? t("dna.lockedTitle") : t("dna.lockTitle")}
    >
      {locked ? <Lock size={13} /> : <Unlock size={13} />}
      {locked ? t("dna.locked") : t("dna.lock")}
    </button>
  );
}
