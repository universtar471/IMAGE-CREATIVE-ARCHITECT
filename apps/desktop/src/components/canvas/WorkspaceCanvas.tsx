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

export type CanvasMode = { kind: "single"; asset: AssetDTO | null };

export function WorkspaceCanvas({
  mode,
  emptyAction,
}: {
  mode: CanvasMode;
  emptyAction?: React.ReactNode;
}) {
  const asset = mode.asset;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!asset) {
    return (
      <EmptyState icon={<Images size={32} />} title="No image selected" action={emptyAction}>
        Import images into the Assets tray below, then select one to view it here.
      </EmptyState>
    );
  }
  const src = fileUrl(asset.absolutePath);
  if (asset.status === "missing_file" || !src || failedSrc === src) {
    return (
      <ErrorState
        title="Image file unavailable"
        message={`The managed copy of '${asset.originalName ?? asset.id}' could not be loaded. The record is kept; re-import the image or restore the file at ${asset.managedRelPath}.`}
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
