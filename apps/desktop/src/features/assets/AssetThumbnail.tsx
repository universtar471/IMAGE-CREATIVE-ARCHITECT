import { memo } from "react";
import { ImageOff, Star } from "lucide-react";
import type { AssetDTO } from "@arch/domain";
import { RoleBadge } from "../../components/common/StatusBadge";
import { fileUrl } from "../../lib/files";
import { formatDimensions } from "../../lib/format";
import { useT } from "../../i18n";
import { QcBadge } from "../qc/QcBadge";

/** Tray tile. Uses the small thumbnail only — never the original. */
export const AssetThumbnail = memo(function AssetThumbnail({
  asset,
  selected,
  onSelect,
}: {
  asset: AssetDTO;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const thumb = fileUrl(asset.thumbnailPath);
  const isMaster = asset.role === "master_architecture";
  return (
    <button
      className="asset-thumb"
      role="option"
      aria-selected={selected}
      onClick={() => onSelect(asset.id)}
      title={asset.originalName ?? asset.id}
      data-testid="asset-thumb"
    >
      <div className="asset-thumb-img">
        {asset.status === "missing_file" ? (
          <ImageOff size={20} aria-label={t("assets.fileMissing")} />
        ) : thumb ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <ImageOff size={20} aria-label={t("assets.noThumbnail")} />
        )}
      </div>
      {isMaster && (
        <span className="badge badge-accent badge-master">
          <Star size={10} /> {t("common.master")}
        </span>
      )}
      <div className="asset-thumb-meta">
        <span className="name">{asset.originalName ?? asset.id}</span>
        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {!isMaster && <RoleBadge role={asset.role} short />}
          <QcBadge assetId={asset.id} projectId={asset.projectId} />
          <span style={{ color: "var(--c-text-3)" }}>
            {formatDimensions(asset.widthPx, asset.heightPx)}
          </span>
        </span>
      </div>
    </button>
  );
});
