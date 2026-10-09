/**
 * Center workspace surface. Phase 1 shows the selected asset (or master) in the
 * ImageViewer; future modes (compare, contact sheet, mask, QC overlay) become
 * additional `mode`s here without changing the shell.
 */
import { Images } from "lucide-react";
import { useState } from "react";
import type { AssetDTO } from "@arch/domain";
import { fileUrl } from "../../lib/files";
import { formatDimensions } from "../../lib/format";
import { RoleBadge } from "../common/StatusBadge";
import { EmptyState, ErrorState } from "../common/states";
import { ImageViewer } from "./ImageViewer";
import { useT } from "../../i18n";

export type CanvasMode = { kind: "single"; asset: AssetDTO | null };

export function WorkspaceCanvas({
  mode,
  emptyAction,
  emptyMessage,
}: {
  mode: CanvasMode;
  emptyAction?: React.ReactNode;
  emptyMessage?: string;
}) {
  const asset = mode.asset;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const t = useT();

  if (!asset) {
    return (
      <EmptyState icon={<Images size={32} />} title={t("canvas.noImage")} action={emptyAction}>
        {emptyMessage ?? t("canvas.noImageHint")}
      </EmptyState>
    );
  }
  const src = fileUrl(asset.absolutePath);
  if (asset.status === "missing_file" || !src || failedSrc === src) {
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
    <ImageViewer
      key={asset.id}
      src={src}
      alt={asset.originalName ?? asset.id}
      naturalWidth={asset.widthPx}
      naturalHeight={asset.heightPx}
      onError={() => setFailedSrc(src)}
      info={
        <>
          <RoleBadge role={asset.role} />
          <span>{asset.originalName}</span>
          <span style={{ color: "var(--c-text-2)" }}>
            {formatDimensions(asset.widthPx, asset.heightPx)}
          </span>
        </>
      }
    />
  );
}
