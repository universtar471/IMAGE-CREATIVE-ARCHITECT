import { useState } from "react";
import { Star, StarOff, Trash2 } from "lucide-react";
import {
  ASSET_ROLE_LABELS,
  ASSET_SOURCE_LABELS,
  AssetRoleSchema,
  type AssetDTO,
  type AssetRole,
} from "@arch/domain";
import { attempt, selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { RoleBadge } from "../../components/common/StatusBadge";
import { EmptyState } from "../../components/common/states";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { call } from "../../lib/bridge";
import { formatBytes, formatDimensions } from "../../lib/format";

const ROLE_OPTIONS = AssetRoleSchema.options.map((r) => ({
  value: r,
  label: ASSET_ROLE_LABELS[r],
}));

/** Right-panel properties for the selected asset (References module). */
export function AssetPropertyPanel() {
  const assets = useStudio((s) => s.workspace?.assets ?? []);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const asset = assets.find((a) => a.id === selectedId) ?? null;

  if (!asset) {
    return (
      <>
        <RoleSummary assets={assets} />
        <EmptyState title="No asset selected">
          Select an image in the Assets tray to see its metadata and role.
        </EmptyState>
      </>
    );
  }
  return <AssetDetails key={asset.id} asset={asset} />;
}

function AssetDetails({ asset }: { asset: AssetDTO }) {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const readOnly = useStudio(selectReadOnly);
  const adoptAssets = useStudio((s) => s.adoptAssets);
  const selectAsset = useStudio((s) => s.selectAsset);
  const notify = useStudio((s) => s.notify);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isMaster = asset.role === "master_architecture";

  const setRole = async (role: AssetRole | undefined) => {
    if (!role || role === asset.role) return;
    const assets = await attempt(() =>
      call("asset_update_role", { projectId, assetId: asset.id, role }),
    );
    if (assets) await adoptAssets(projectId, assets);
  };

  const setMaster = async (makeMaster: boolean) => {
    const assets = await attempt(() =>
      call("asset_set_master", { projectId, assetId: makeMaster ? asset.id : null }),
    );
    if (assets) {
      await adoptAssets(projectId, assets);
      notify("success", makeMaster ? "Master architecture image updated." : "Master cleared.");
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    const res = await attempt(() => call("asset_remove", { projectId, assetId: asset.id }));
    if (!res) return;
    if (res.fileCleanupWarning) notify("warning", res.fileCleanupWarning);
    const assets = await attempt(() => call("asset_list", { projectId }));
    if (assets) {
      await adoptAssets(projectId, assets);
      selectAsset(null);
    }
  };

  return (
    <>
      <SectionPanel title="Role">
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <RoleBadge role={asset.role} />
        </div>
        <SelectField
          label="Asset role"
          hint="How this image is used when compiling prompts."
          options={ROLE_OPTIONS}
          allowEmpty={false}
          value={asset.role}
          disabled={readOnly}
          onChange={(r) => void setRole(r)}
        />
        {isMaster ? (
          <button className="btn" onClick={() => void setMaster(false)} disabled={readOnly}>
            <StarOff size={14} /> Clear master
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => void setMaster(true)}
            disabled={readOnly || asset.status !== "ready"}
          >
            <Star size={14} /> Set as master architecture
          </button>
        )}
        <span className="field-hint">
          Only one master per project. Choosing a new master turns the previous one into an
          architecture reference.
        </span>
      </SectionPanel>

      <SectionPanel title="Metadata">
        <dl className="kv">
          <dt>Original name</dt>
          <dd>{asset.originalName ?? "—"}</dd>
          <dt>Source</dt>
          <dd>{ASSET_SOURCE_LABELS[asset.source]}</dd>
          <dt>Dimensions</dt>
          <dd>{formatDimensions(asset.widthPx, asset.heightPx)}</dd>
          <dt>File size</dt>
          <dd>{formatBytes(asset.fileSizeBytes)}</dd>
          <dt>Format</dt>
          <dd>{asset.mimeType ?? "—"}</dd>
          <dt>Status</dt>
          <dd>{asset.status === "ready" ? "Ready" : "File missing — re-import or restore it"}</dd>
          <dt>Imported</dt>
          <dd>{new Date(asset.createdAt).toLocaleString()}</dd>
          <dt>SHA-256</dt>
          <dd style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
            {asset.sha256 ? `${asset.sha256.slice(0, 16)}…` : "—"}
          </dd>
          <dt>Asset ID</dt>
          <dd style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{asset.id}</dd>
        </dl>
      </SectionPanel>

      <SectionPanel title="Danger zone" defaultOpen={false}>
        <button
          className="btn btn-danger"
          onClick={() => setConfirmRemove(true)}
          disabled={readOnly}
        >
          <Trash2 size={14} /> Remove from project
        </button>
        <span className="field-hint">
          Deletes the app's managed copy only. Your original file on disk is never touched.
        </span>
      </SectionPanel>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove asset?"
          danger
          confirmLabel="Remove"
          message={
            <>
              Remove <strong>{asset.originalName ?? asset.id}</strong> from this project?
              {isMaster && " It is the current master; the project will have no master afterwards."}
            </>
          }
          onConfirm={() => void remove()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </>
  );
}

function RoleSummary({ assets }: { assets: AssetDTO[] }) {
  const counts = AssetRoleSchema.options
    .map((r) => [r, assets.filter((a) => a.role === r).length] as const)
    .filter(([, n]) => n > 0);
  return (
    <SectionPanel title="References by role">
      {counts.length === 0 ? (
        <span className="field-hint">No references yet.</span>
      ) : (
        <ul className="checklist">
          {counts.map(([role, n]) => (
            <li key={role}>
              <RoleBadge role={role} /> × {n}
            </li>
          ))}
        </ul>
      )}
    </SectionPanel>
  );
}
