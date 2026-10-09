import type { GenerationStatus } from "@arch/domain";
import { useT } from "../../i18n";
import { GENERATION_STATUS_TONE } from "./labels";

export function GenerationStatusBadge({ status }: { status: GenerationStatus }) {
  const t = useT();
  return (
    <span className={`badge ${GENERATION_STATUS_TONE[status]}`}>
      {t(`labels.generationStatus.${status}`)}
    </span>
  );
}
