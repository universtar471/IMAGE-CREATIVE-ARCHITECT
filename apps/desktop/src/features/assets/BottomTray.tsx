import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Columns2, ImagePlus, Layers, Lock } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { AssetRoleSchema, type AssetRole } from "@arch/domain";
import { isTerminalJob, selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { EmptyState } from "../../components/common/states";
import { JobsTab } from "../jobs/JobsTab";
import { HistoryTab } from "../history/HistoryTab";
import { VersionsTab } from "../versions/VersionsTab";
import { TRAY_TABS } from "../workspace/modules";
import { AssetThumbnail } from "./AssetThumbnail";
import { useAssetImport } from "./useAssetImport";
import { useT } from "../../i18n";
import { EnhanceBatchDialog } from "../enhance/EnhanceBatchDialog";
import { resolveEnhancePair } from "../enhance/enhance";

const ROLE_FILTERS = AssetRoleSchema.options;

export function BottomTray() {
  const trayTab = useStudio((s) => s.trayTab);
  const collapsed = useStudio((s) => s.trayCollapsed);
  const setTrayTab = useStudio((s) => s.setTrayTab);
  const toggleTray = useStudio((s) => s.toggleTray);
  const assetCount = useStudio((s) => s.workspace?.assets.length ?? 0);
  const historyCount = useStudio((s) => s.workspace?.generations.length ?? 0);
  const activeJobs = useStudio((s) => s.jobs.filter((j) => !isTerminalJob(j)).length);
  const t = useT();

  return (
    <section className="tray" aria-label={t("tray.label")}>
      <div className="tray-tabs" role="tablist">
        {TRAY_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            className={`tray-tab ${tab.availableIn ? "is-future" : ""}`}
            aria-selected={trayTab === tab.id && !collapsed}
            onClick={() => setTrayTab(tab.id)}
            title={tab.availableIn ? t("tray.comingIn", { phase: tab.availableIn }) : undefined}
          >
            {t(`tray.${tab.id}`)}
            {tab.id === "assets" && <span className="badge badge-neutral">{assetCount}</span>}
            {tab.id === "jobs" && activeJobs > 0 && (
              <span className="badge badge-info">{activeJobs}</span>
            )}
            {tab.id === "history" && historyCount > 0 && (
              <span className="badge badge-neutral">{historyCount}</span>
            )}
            {tab.availableIn && <Lock size={11} />}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="btn btn-ghost btn-sm"
          onClick={toggleTray}
          aria-label={collapsed ? t("tray.expand") : t("tray.collapse")}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div className="tray-body" role="tabpanel">
          {trayTab === "assets" && <AssetsTab />}
          {trayTab === "versions" && <VersionsTab />}
          {trayTab === "history" && <HistoryTab />}
          {trayTab === "jobs" && <JobsTab />}
        </div>
      )}
    </section>
  );
}

function AssetsTab() {
  const assets = useStudio((s) => s.workspace?.assets ?? []);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const generations = useStudio((s) => s.workspace?.generations ?? []);
  const selectAsset = useStudio((s) => s.selectAsset);
  const setModule = useStudio((s) => s.setModule);
  const readOnly = useStudio(selectReadOnly);
  const [filter, setFilter] = useState<AssetRole | "all">("all");
  const [importRole, setImportRole] = useState<AssetRole>("regular_image");
  const [dropping, setDropping] = useState(false);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const { busy, duplicate, importPaths, pickAndImport } = useAssetImport();
  const t = useT();

  const visible = useMemo(
    () => (filter === "all" ? assets : assets.filter((a) => a.role === filter)),
    [assets, filter],
  );
  const batchSources = assets.filter(
    (asset) => batchIds.includes(asset.id) && asset.status === "ready",
  );

  // Native file drag & drop onto the window (Tauri provides real paths).
  useEffect(() => {
    if (!isTauri() || readOnly) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
      getCurrentWebview()
        .onDragDropEvent((event) => {
          const p = event.payload;
          if (p.type === "enter" || p.type === "over") setDropping(true);
          else if (p.type === "leave") setDropping(false);
          else if (p.type === "drop") {
            setDropping(false);
            void importPaths(p.paths, importRole);
          }
        })
        .then((fn) => (cancelled ? fn() : (unlisten = fn))),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [importPaths, importRole, readOnly]);

  return (
    <div style={{ display: "flex", height: "100%" }} className={dropping ? "is-dropping" : ""}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: 8,
          width: 190,
          borderRight: "1px solid var(--c-border)",
        }}
      >
        <label className="field-label" htmlFor="tray-filter">
          {t("assets.show")}
        </label>
        <select
          id="tray-filter"
          className="select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as AssetRole | "all")}
        >
          <option value="all">{t("assets.allRoles")}</option>
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {t(`labels.assetRole.${r}`)}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="tray-import-role">
          {t("assets.importAs")}
        </label>
        <select
          id="tray-import-role"
          className="select"
          value={importRole}
          disabled={readOnly}
          onChange={(e) => setImportRole(e.target.value as AssetRole)}
        >
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {t(`labels.assetRole.${r}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="asset-strip" role="listbox" aria-label={t("assets.listLabel")}>
        <button
          className="asset-import-tile"
          onClick={() => void pickAndImport(importRole)}
          disabled={readOnly || !!busy}
        >
          <ImagePlus size={22} />
          {busy
            ? t("assets.importing", { done: busy.done, total: busy.total })
            : t("assets.importImages")}
          <span className="field-hint">JPEG · PNG · WebP</span>
        </button>
        {visible.map((a) => (
          <div className="asset-select-wrap" key={a.id}>
            <label className="asset-select-check">
              <input
                type="checkbox"
                checked={batchIds.includes(a.id)}
                disabled={a.status !== "ready"}
                onChange={(event) =>
                  setBatchIds((current) =>
                    event.target.checked ? [...current, a.id] : current.filter((id) => id !== a.id),
                  )
                }
              />
              {t("assets.batchSelect")}
            </label>
            <AssetThumbnail asset={a} selected={a.id === selectedId} onSelect={selectAsset} />
            {resolveEnhancePair(a.id, generations, assets) && (
              <button
                type="button"
                className="btn btn-sm"
                title={t("enhance.compareSource")}
                onClick={() => {
                  selectAsset(a.id);
                  setModule("enhance");
                }}
              >
                <Columns2 size={12} /> {t("enhance.compareSource")}
              </button>
            )}
          </div>
        ))}
        {assets.length > 0 && visible.length === 0 && (
          <EmptyState title={t("assets.noneWithRole")}>{t("assets.changeFilter")}</EmptyState>
        )}
        {assets.length === 0 && !busy && (
          <div className="state" style={{ alignItems: "flex-start" }}>
            <p>{readOnly ? t("assets.archivedEmpty") : t("assets.empty")}</p>
          </div>
        )}
      </div>

      {batchIds.length >= 2 && (
        <button className="btn btn-primary btn-sm" onClick={() => setBatchOpen(true)}>
          <Layers size={13} /> {t("enhance.batch")} ({batchIds.length})
        </button>
      )}
      {batchOpen && batchSources.length >= 2 && (
        <EnhanceBatchDialog sources={batchSources} onClose={() => setBatchOpen(false)} />
      )}

      {duplicate && (
        <ConfirmDialog
          title={t("assets.duplicateTitle")}
          message={
            <>
              <p style={{ marginTop: 0 }}>
                {t("assets.duplicateLead", { file: duplicate.fileName })}
              </p>
              <p className="field-hint">{duplicate.message}</p>
              <p className="field-hint">{t("assets.duplicateHint")}</p>
            </>
          }
          confirmLabel={t("assets.importAnyway")}
          onConfirm={() => duplicate.resolve(true)}
          onCancel={() => duplicate.resolve(false)}
        />
      )}
    </div>
  );
}
