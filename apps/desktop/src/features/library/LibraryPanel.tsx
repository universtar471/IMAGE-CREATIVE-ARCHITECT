import { useState } from "react";
import { Download, Pencil, Sparkles } from "lucide-react";
import { useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { useT } from "../../i18n";
import { AssetPropertyPanel } from "../assets/AssetPropertyPanel";
import { HistoryTab } from "../history/HistoryTab";
import { VersionsTab } from "../versions/VersionsTab";
import {
  actionTargets,
  applyAsSource,
  downloadAssets,
  libraryStateFor,
  openInEdit,
  useLibrary,
} from "./library";

/**
 * "Ảnh của tôi" right panel: actions on the selected images, then the selected asset's
 * details through the existing assets, versions and history components.
 */
export function LibraryPanel() {
  const t = useT();
  return (
    <aside className="panel" aria-label={t("workspace.properties")}>
      <div className="panel-header">{t("library.details")}</div>
      <div className="panel-body">
        <LibraryActions />
        <AssetPropertyPanel />
        <SectionPanel title={t("library.versions")} defaultOpen={false}>
          <div className="library-panel-tray">
            <VersionsTab />
          </div>
        </SectionPanel>
        <SectionPanel title={t("library.history")} defaultOpen={false}>
          <div className="library-panel-tray">
            <HistoryTab />
          </div>
        </SectionPanel>
      </div>
    </aside>
  );
}

export function LibraryActions() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const assets = useStudio((s) => s.workspace!.assets);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const notify = useStudio((s) => s.notify);
  const notifyError = useStudio((s) => s.notifyError);
  const { checkedIds } = libraryStateFor(useLibrary(), projectId);
  const [downloading, setDownloading] = useState(false);
  const t = useT();
  const targets = actionTargets(assets, checkedIds, selectedId);
  const ready = targets.filter((asset) => asset.status === "ready");
  const primary = ready[0] ?? null;

  const download = async () => {
    setDownloading(true);
    try {
      const result = await downloadAssets(projectId, ready);
      if (result.saved) notify("success", t("library.downloaded", { count: result.paths.length }));
    } catch (err) {
      notifyError(err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SectionPanel
      title={t("library.actions")}
      aside={
        checkedIds.length > 0 ? (
          <span className="badge badge-info">
            {t("library.selected", { count: checkedIds.length })}
          </span>
        ) : undefined
      }
    >
      {targets.length === 0 ? (
        <span className="field-hint">{t("library.noneSelected")}</span>
      ) : (
        <div className="library-actions">
          <button className="btn" disabled={!primary} onClick={() => openInEdit(primary!.id)}>
            <Pencil size={14} /> {t("library.openInEdit")}
          </button>
          <button
            className="btn btn-primary"
            disabled={!primary}
            onClick={() => applyAsSource(ready)}
          >
            <Sparkles size={14} /> {t("library.useAsSource")}
          </button>
          <button
            className="btn"
            disabled={!primary || downloading}
            onClick={() => void download()}
          >
            <Download size={14} /> {downloading ? t("library.downloading") : t("library.download")}
          </button>
          <span className="field-hint">{t("library.downloadHint")}</span>
        </div>
      )}
    </SectionPanel>
  );
}
