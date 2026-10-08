import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ImagePlus, Lock } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import { ASSET_ROLE_LABELS, AssetRoleSchema, type AssetRole } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { EmptyState, FutureModulePlaceholder, LoadingState } from "../../components/common/states";
import { call, type VersionDTO } from "../../lib/bridge";
import { TRAY_TABS } from "../workspace/modules";
import { AssetThumbnail } from "./AssetThumbnail";
import { useAssetImport } from "./useAssetImport";

const ROLE_FILTERS = AssetRoleSchema.options;

export function BottomTray() {
  const trayTab = useStudio((s) => s.trayTab);
  const collapsed = useStudio((s) => s.trayCollapsed);
  const setTrayTab = useStudio((s) => s.setTrayTab);
  const toggleTray = useStudio((s) => s.toggleTray);
  const assetCount = useStudio((s) => s.workspace?.assets.length ?? 0);

  return (
    <section className="tray" aria-label="Production tray">
      <div className="tray-tabs" role="tablist">
        {TRAY_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            className={`tray-tab ${t.availableIn ? "is-future" : ""}`}
            aria-selected={trayTab === t.id && !collapsed}
            onClick={() => setTrayTab(t.id)}
            title={t.availableIn ? `Coming in Phase ${t.availableIn}` : undefined}
          >
            {t.label}
            {t.id === "assets" && <span className="badge badge-neutral">{assetCount}</span>}
            {t.availableIn && <Lock size={11} />}
          </button>
        ))}
        <span className="spacer" />
        <button
          className="btn btn-ghost btn-sm"
          onClick={toggleTray}
          aria-label={collapsed ? "Expand tray" : "Collapse tray"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {!collapsed && (
        <div className="tray-body" role="tabpanel">
          {trayTab === "assets" && <AssetsTab />}
          {trayTab === "versions" && <VersionsTab />}
          {(trayTab === "jobs" || trayTab === "history") && <FutureTab id={trayTab} />}
        </div>
      )}
    </section>
  );
}

function FutureTab({ id }: { id: "jobs" | "history" }) {
  const tab = TRAY_TABS.find((t) => t.id === id)!;
  return (
    <FutureModulePlaceholder
      compact
      title={tab.label}
      phase={tab.availableIn!}
      description={tab.note}
    />
  );
}

function AssetsTab() {
  const assets = useStudio((s) => s.workspace?.assets ?? []);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const selectAsset = useStudio((s) => s.selectAsset);
  const readOnly = useStudio(selectReadOnly);
  const [filter, setFilter] = useState<AssetRole | "all">("all");
  const [importRole, setImportRole] = useState<AssetRole>("regular_image");
  const [dropping, setDropping] = useState(false);
  const { busy, duplicate, importPaths, pickAndImport } = useAssetImport();

  const visible = useMemo(
    () => (filter === "all" ? assets : assets.filter((a) => a.role === filter)),
    [assets, filter],
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
          Show
        </label>
        <select
          id="tray-filter"
          className="select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as AssetRole | "all")}
        >
          <option value="all">All roles</option>
          {ROLE_FILTERS.map((r) => (
            <option key={r} value={r}>
              {ASSET_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <label className="field-label" htmlFor="tray-import-role">
          Import as
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
              {ASSET_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div className="asset-strip" role="listbox" aria-label="Project assets">
        <button
          className="asset-import-tile"
          onClick={() => void pickAndImport(importRole)}
          disabled={readOnly || !!busy}
        >
          <ImagePlus size={22} />
          {busy ? `Importing ${busy.done}/${busy.total}…` : "Import images"}
          <span className="field-hint">JPEG · PNG · WebP</span>
        </button>
        {visible.map((a) => (
          <AssetThumbnail
            key={a.id}
            asset={a}
            selected={a.id === selectedId}
            onSelect={selectAsset}
          />
        ))}
        {assets.length > 0 && visible.length === 0 && (
          <EmptyState title="No assets with this role">
            Change the filter to see other images.
          </EmptyState>
        )}
        {assets.length === 0 && !busy && (
          <div className="state" style={{ alignItems: "flex-start" }}>
            <p>
              {readOnly
                ? "This archived project has no images."
                : "No images yet. Import renders, photos or references — or drop files here."}
            </p>
          </div>
        )}
      </div>

      {duplicate && (
        <ConfirmDialog
          title="Duplicate image"
          message={
            <>
              <p style={{ marginTop: 0 }}>{duplicate.message}</p>
              <p className="field-hint">
                Keeping it creates a second logical asset that shares the same binary content.
              </p>
            </>
          }
          confirmLabel="Import anyway"
          onConfirm={() => duplicate.resolve(true)}
          onCancel={() => duplicate.resolve(false)}
        />
      )}
    </div>
  );
}

function VersionsTab() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const assets = useStudio((s) => s.workspace!.assets);
  const revision = useStudio((s) => s.dataRevision);
  const [versions, setVersions] = useState<VersionDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    call("version_list", { projectId })
      .then((v) => alive && (setVersions(v), setError(null)))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [projectId, revision]);

  if (error)
    return (
      <div className="state">
        <p>{error}</p>
      </div>
    );
  if (!versions) return <LoadingState />;
  if (!versions.length)
    return (
      <EmptyState title="No versions yet">Each imported image starts a version lineage.</EmptyState>
    );
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.originalName ?? id;
  return (
    <div className="list">
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Asset</th>
            <th>Operation</th>
            <th>Parent</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td style={{ fontFamily: "var(--mono)" }}>{v.id.slice(0, 12)}…</td>
              <td>{nameOf(v.assetId)}</td>
              <td>{v.operation}</td>
              <td>{v.parentVersionId ?? "— root —"}</td>
              <td>{new Date(v.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="field-hint" style={{ padding: "6px 8px" }}>
        Version tree view and derived branches arrive with generation in Phase 2.
      </p>
    </div>
  );
}
