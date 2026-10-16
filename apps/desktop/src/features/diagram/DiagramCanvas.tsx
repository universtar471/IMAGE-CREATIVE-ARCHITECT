/**
 * Center view of the Diagram module: the vector sheet exactly as it will be exported
 * (same `layoutDiagramSheet` call), with smaller embedded images for speed.
 */
import { useEffect, useMemo, useState } from "react";
import { layoutDiagramSheet, type DiagramSheetOptions } from "@arch/domain";
import { useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { useT } from "../../i18n";
import { diagramSourceId } from "./DiagramPanel";
import { sheetImages, svgDataUrl } from "./raster";
import { useDiagram } from "./useDiagram";

const PREVIEW_EDGE = 1024;

export function DiagramCanvas() {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const { plan, config, projectId } = useDiagram();
  const current = projectId === ws.project.id ? plan : null;
  const sourceId = diagramSourceId(
    ws.assets,
    config.sourceAssetId,
    selectedAssetId,
    ws.project.activeMasterAssetId,
  );
  const imageKey = current
    ? [sourceId, ...current.steps.map((s) => s.frameAssetId ?? "")].join("|")
    : "";
  const [images, setImages] = useState<{ key: string; value: DiagramSheetOptions } | null>(null);

  useEffect(() => {
    if (!current) return;
    let live = true;
    void sheetImages(ws.project.id, current, sourceId, PREVIEW_EDGE).then((value) => {
      if (live) setImages({ key: imageKey, value });
    });
    return () => {
      live = false;
    };
    // Only a different source or frame set needs new pixels; text edits reuse them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, ws.project.id]);

  const svg = useMemo(
    () =>
      current
        ? layoutDiagramSheet(current.steps, config.layout, config.lang, {
            type: current.type,
            title: ws.project.name,
            ...(images?.key === imageKey ? images.value : {}),
          })
        : null,
    [current, config.layout, config.lang, ws.project.name, images, imageKey],
  );

  if (!svg) {
    return (
      <div className="diagram-canvas" data-testid="diagram-canvas">
        <EmptyState title={t("diagram.preview")}>{t("diagram.previewEmpty")}</EmptyState>
      </div>
    );
  }
  return (
    <div className="diagram-canvas" data-testid="diagram-canvas">
      {images?.key !== imageKey && (
        <p className="field-hint" role="status">
          {t("diagram.loadingImages")}
        </p>
      )}
      <img className="diagram-sheet" src={svgDataUrl(svg)} alt={t("diagram.previewAlt")} />
    </div>
  );
}
