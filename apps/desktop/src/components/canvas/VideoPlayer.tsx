/** Plays a clip (ADR-043) with its poster; falls back to the poster when it cannot play. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AssetDTO } from "@arch/domain";
import { fileUrl } from "../../lib/files";
import { formatClipDuration } from "../../lib/format";
import { ErrorState } from "../common/states";
import { useT } from "../../i18n";

export function VideoPlayer({ asset, extra }: { asset: AssetDTO; extra?: ReactNode }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);
  const src = fileUrl(asset.absolutePath);
  // Leaving the clip (another selection, module or mode) stops it: no sound in the background.
  useEffect(() => {
    const el = ref.current;
    return () => el?.pause();
  }, [asset.id]);
  const poster = fileUrl(asset.thumbnailPath) ?? undefined;
  if (asset.status === "missing_file" || !src) {
    return (
      <ErrorState
        title={t("canvas.unavailable")}
        message={t("canvas.unavailableMessage", {
          name: asset.originalName ?? asset.id,
          path: asset.managedRelPath,
        })}
      />
    );
  }
  return (
    <figure className="video-player" data-testid="video-player">
      {failed ? (
        <>
          {poster && <img src={poster} alt={asset.originalName ?? asset.id} />}
          <figcaption className="field-hint">{t("videoModule.playError")}</figcaption>
        </>
      ) : (
        <video
          key={asset.id}
          ref={ref}
          src={src}
          poster={poster}
          controls
          preload="metadata"
          playsInline
          aria-label={t("videoModule.player")}
          onError={() => setFailed(true)}
        />
      )}
      <figcaption className="video-caption">
        <span>{asset.originalName ?? asset.id}</span>
        {asset.durationMs != null && <span>{formatClipDuration(asset.durationMs)}</span>}
        {asset.posterSource === "source" && <span>{t("viewer.posterSource")}</span>}
        {extra}
      </figcaption>
    </figure>
  );
}
