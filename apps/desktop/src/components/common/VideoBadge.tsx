import { Play } from "lucide-react";
import { formatClipDuration } from "../../lib/format";
import { useT } from "../../i18n";

/** ▶ and the clip length over a video thumbnail (ADR-043). */
export function VideoBadge({ durationMs }: { durationMs?: number | null }) {
  const t = useT();
  return (
    <span className="video-badge" aria-label={t("videoModule.player")} data-testid="video-badge">
      <Play size={10} />
      {formatClipDuration(durationMs)}
    </span>
  );
}
