/**
 * Center view of the Video module (ADR-043). A selected clip plays with its poster; under it
 * the clip's first frame (the poster) sits next to the source image, so warped architecture
 * is easy to spot. A selected image is shown as the first frame to come.
 */
import { isVideoAsset } from "@arch/domain";
import { useStudio } from "../../app/store";
import { VideoPlayer } from "../../components/canvas/VideoPlayer";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";
import { defaultVideoSource } from "./video";

export function VideoCanvas() {
  const assets = useStudio((s) => s.workspace!.assets);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const masterId = useStudio((s) => s.workspace!.project.activeMasterAssetId);
  const t = useT();
  const selected = assets.find((a) => a.id === selectedId) ?? null;
  const clip = selected && isVideoAsset(selected) ? selected : null;
  if (!clip) {
    const source = defaultVideoSource(assets, selectedId, masterId);
    return (
      <div className="video-canvas">
        <WorkspaceCanvas mode={{ kind: "single", asset: source }} />
        <p className="field-hint video-canvas-hint">
          {source ? t("videoModule.sourcePreviewHint") : t("videoModule.noSource")}
        </p>
      </div>
    );
  }
  const parent = assets.find((a) => a.id === clip.parentAssetId) ?? null;
  const poster = fileUrl(clip.thumbnailPath);
  const parentSrc = parent ? fileUrl(parent.thumbnailPath ?? parent.absolutePath) : null;
  return (
    <div className="video-canvas">
      <VideoPlayer asset={clip} />
      {parent && (
        <section className="video-compare" aria-label={t("videoModule.compareHint")}>
          <figure>
            {poster && <img src={poster} alt={t("videoModule.firstFrame")} />}
            <figcaption>{t("videoModule.firstFrame")}</figcaption>
          </figure>
          <figure>
            {parentSrc && <img src={parentSrc} alt={t("videoModule.sourceFrame")} />}
            <figcaption>{t("videoModule.sourceFrame")}</figcaption>
          </figure>
          <p className="field-hint">{t("videoModule.compareHint")}</p>
        </section>
      )}
    </div>
  );
}
