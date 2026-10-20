/**
 * Studio centre preview (ADR-044): the one main preview of the selection. Images show in the
 * zoomable canvas, clips in the real player; the contextual toolbar floats over the top edge,
 * and "View large" opens the large viewer. Inspector and tray only show thumbnails.
 */
import { Maximize2 } from "lucide-react";
import type { ReactNode } from "react";
import { isVideoAsset } from "@arch/domain";
import { useStudio } from "../../app/store";
import { VideoPlayer } from "../../components/canvas/VideoPlayer";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import { useT } from "../../i18n";
import { ContextualToolbar } from "../selection/ContextualToolbar";
import { selectionAsset } from "../selection/selection";
import { useSelection } from "../selection/useSelection";
import { viewerSetFor } from "../selection/viewerSet";
import { useWorkspaceLayout } from "../workspace/layout";

export function openViewerFor(assetId: string) {
  const s = useStudio.getState();
  const ws = s.workspace;
  if (!ws) return;
  const assetIds = viewerSetFor(assetId, ws.assets, ws.generations);
  s.openViewer({ assetIds, index: Math.max(0, assetIds.indexOf(assetId)), compareWithId: null });
}

export function StudioPreview({
  emptyAction,
  emptyMessage,
}: {
  emptyAction?: ReactNode;
  emptyMessage?: string;
}) {
  const t = useT();
  const masterId = useStudio((s) => s.workspace!.project.activeMasterAssetId);
  const selection = useSelection(masterId);
  const layout = useWorkspaceLayout();
  const asset = selectionAsset(selection);
  const expand = asset ? (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => openViewerFor(asset.id)}
      aria-label={t("selectionActions.expand")}
      title={t("selectionActions.expand")}
      data-testid="preview-expand"
    >
      <Maximize2 size={14} />
    </button>
  ) : null;
  return (
    <div className="studio-preview" data-testid="studio-preview" data-kind={selection.kind}>
      <div className="preview-toolbar-slot">
        <ContextualToolbar
          selection={selection}
          maxVisible={layout.tier === "wide" ? 4 : layout.tier === "regular" ? 3 : 2}
        />
      </div>
      {asset && isVideoAsset(asset) ? (
        <VideoPlayer key={asset.id} asset={asset} extra={expand} />
      ) : (
        <WorkspaceCanvas
          mode={{ kind: "single", asset }}
          extraTools={expand}
          emptyAction={emptyAction}
          emptyMessage={emptyMessage}
        />
      )}
    </div>
  );
}
