import type { GenerationStatus } from "@arch/domain";
import { GENERATION_STATUS_LABELS, GENERATION_STATUS_TONE } from "./labels";

export function GenerationStatusBadge({ status }: { status: GenerationStatus }) {
  return (
    <span className={`badge ${GENERATION_STATUS_TONE[status]}`}>
      {GENERATION_STATUS_LABELS[status]}
    </span>
  );
}
