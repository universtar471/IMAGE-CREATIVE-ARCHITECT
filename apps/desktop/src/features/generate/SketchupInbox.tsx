import { useCallback, useEffect, useState } from "react";
import { ImageOff, MonitorDown, RefreshCw } from "lucide-react";
import { useStudio } from "../../app/store";
import { call, toBridgeError, type SketchupInboxListing } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";

/**
 * Views sent by the SketchUp extension (ADR-040). Nothing is imported until the user picks a
 * view; the imported view becomes a `structure_sketch` and is selected as the source. Sending
 * the same view twice returns the asset that already exists.
 */
export function SketchupInbox({
  disabled,
  onImported,
}: {
  disabled: boolean;
  onImported: (assetId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<SketchupInboxListing | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setListing(await call("sketchup_inbox_list", {}));
    } catch (e) {
      setError(toBridgeError(e).message);
    }
  }, []);

  // The count on the button: one quiet listing when the panel mounts.
  useEffect(() => {
    let alive = true;
    call("sketchup_inbox_list", {}).then(
      (result) => alive && setListing(result),
      (e: unknown) => alive && setError(toBridgeError(e).message),
    );
    return () => {
      alive = false;
    };
  }, []);

  const importView = async (fileName: string) => {
    const ws = useStudio.getState().workspace;
    if (!ws) return;
    const { notify, adoptAssets } = useStudio.getState();
    setBusy(fileName);
    setError(null);
    try {
      const result = await call("sketchup_inbox_import", {
        projectId: ws.project.id,
        fileNames: [fileName],
      });
      const assets = await call("asset_list", { projectId: ws.project.id });
      await adoptAssets(ws.project.id, assets);
      const asset = result.assets[0];
      if (asset) onImported(asset.id);
      notify(
        "success",
        t(result.duplicates ? "sketchup.alreadyImported" : "sketchup.imported", {
          name: fileName,
        }),
      );
      await refresh();
    } catch (e) {
      setError(toBridgeError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const count = listing?.entries.length ?? 0;
  return (
    <div className="sketchup-inbox" data-testid="sketchup-inbox">
      <button
        type="button"
        className="btn btn-sm"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen(!open);
          if (!open) void refresh();
        }}
      >
        <MonitorDown size={13} /> {t("sketchup.receive", { count })}
      </button>
      {open && (
        <div className="sketchup-inbox-panel">
          <div className="sketchup-inbox-head">
            <span className="field-hint" title={listing?.path}>
              {t("sketchup.folder")} <code>{listing?.path ?? "…"}</code>
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              aria-label={t("sketchup.refresh")}
              title={t("sketchup.refresh")}
              onClick={() => void refresh()}
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {count === 0 ? (
            <span className="field-hint">{t("sketchup.empty")}</span>
          ) : (
            <ul className="ref-list" aria-label={t("sketchup.listLabel")}>
              {listing!.entries.map((entry) => {
                const thumb = fileUrl(entry.absolutePath);
                const size =
                  entry.width && entry.height ? `${entry.width}×${entry.height}` : undefined;
                return (
                  <li className="ref-row" key={entry.fileName}>
                    <span className="ref-thumb">
                      {thumb ? (
                        <img src={thumb} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <ImageOff size={14} />
                      )}
                    </span>
                    <span className="ref-meta">
                      <span className="ref-name" title={entry.model ?? entry.fileName}>
                        {entry.scene ?? entry.fileName}
                      </span>
                      <span className="field-hint">
                        {[size, entry.model?.split(/[\\/]/).pop()].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={disabled || busy !== null}
                      onClick={() => void importView(entry.fileName)}
                    >
                      {busy === entry.fileName ? t("sketchup.importing") : t("sketchup.import")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {error && (
        <span className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
