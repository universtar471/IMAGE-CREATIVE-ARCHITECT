import { useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import type { AssetDTO } from "@arch/domain";
import { call, toBridgeError } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";

/** Saves managed originals, including videos; the native side owns the folder picker. */
export function DownloadAssets({
  assets,
  compact = false,
}: {
  assets: AssetDTO[];
  compact?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ready = assets.filter((asset) => asset.status === "ready");
  const label = t("assets.download", { count: ready.length });
  const download = async () => {
    if (!ready.length || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (isTauri()) {
        const paths = await call("asset_download", {
          projectId: ready[0]!.projectId,
          assetIds: ready.map((a) => a.id),
        });
        if (paths.length) setMessage(t("assets.downloaded", { count: paths.length }));
      } else {
        for (const asset of ready) {
          const href = fileUrl(asset.absolutePath);
          if (!href) continue;
          const link = document.createElement("a");
          link.href = href;
          link.download = asset.originalName ?? asset.id;
          document.body.append(link);
          link.click();
          link.remove();
        }
        setMessage(t("assets.downloaded", { count: ready.length }));
      }
    } catch (error) {
      setMessage(toBridgeError(error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span
      className="asset-download nodrag nopan"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy || !ready.length}
        title={label}
        aria-label={label}
        onClick={() => void download()}
      >
        {busy ? <LoaderCircle size={13} className="node-spinner" /> : <Download size={13} />}
        {!compact && label}
      </button>
      {message && (
        <span className="asset-download-status" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
