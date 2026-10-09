import { useState } from "react";
import { Star, StarOff, Trash2 } from "lucide-react";
import { AssetRoleSchema, type AssetDTO, type AssetRole } from "@arch/domain";
import { attempt, selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { RoleBadge } from "../../components/common/StatusBadge";
import { EmptyState } from "../../components/common/states";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { SelectField } from "../../components/panels/fields";
import { call } from "../../lib/bridge";
import { formatBytes, formatDateTime, formatDimensions } from "../../lib/format";
import { useT } from "../../i18n";
import { fillNodes } from "../../i18n/nodes";

/** Right-panel properties for the selected asset (References module). */
export function AssetPropertyPanel() {
  const assets = useStudio((s) => s.workspace?.assets ?? []);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const asset = assets.find((a) => a.id === selectedId) ?? null;
  const t = useT();

  if (!asset) {
    return (
      <>
        <RoleSummary assets={assets} />
        <EmptyState title={t("assets.noneSelected")}>{t("assets.noneSelectedHint")}</EmptyState>
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
  const t = useT();
  const isMaster = asset.role === "master_architecture";
  const roleOptions = AssetRoleSchema.options.map((r) => ({
    value: r,
    label: t(`labels.assetRole.${r}`),
  }));

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
      notify("success", makeMaster ? t("assets.masterUpdated") : t("assets.masterCleared"));
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
      <SectionPanel title={t("assets.role")}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <RoleBadge role={asset.role} />
        </div>
        <SelectField
          label={t("assets.assetRole")}
          hint={t("assets.assetRoleHint")}
          options={roleOptions}
          allowEmpty={false}
          value={asset.role}
          disabled={readOnly}
          onChange={(r) => void setRole(r)}
        />
        {isMaster ? (
          <button className="btn" onClick={() => void setMaster(false)} disabled={readOnly}>
            <StarOff size={14} /> {t("assets.clearMaster")}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => void setMaster(true)}
            disabled={readOnly || asset.status !== "ready"}
          >
            <Star size={14} /> {t("assets.setMaster")}
          </button>
        )}
        <span className="field-hint">{t("assets.oneMaster")}</span>
      </SectionPanel>

      <SectionPanel title={t("assets.metadata")}>
        <dl className="kv">
          <dt>{t("assets.originalName")}</dt>
          <dd>{asset.originalName ?? "—"}</dd>
          <dt>{t("assets.source")}</dt>
          <dd>{t(`labels.assetSource.${asset.source}`)}</dd>
          <dt>{t("assets.dimensions")}</dt>
          <dd>{formatDimensions(asset.widthPx, asset.heightPx)}</dd>
          <dt>{t("assets.fileSize")}</dt>
          <dd>{formatBytes(asset.fileSizeBytes)}</dd>
          <dt>{t("assets.format")}</dt>
          <dd>{asset.mimeType ?? "—"}</dd>
          <dt>{t("assets.status")}</dt>
          <dd>{asset.status === "ready" ? t("assets.ready") : t("assets.missing")}</dd>
          <dt>{t("assets.imported")}</dt>
          <dd>{formatDateTime(asset.createdAt)}</dd>
          <dt>SHA-256</dt>
          <dd style={{ fontFamily: "var(--mono)", fontSize: 11 }}>
            {asset.sha256 ? `${asset.sha256.slice(0, 16)}…` : "—"}
          </dd>
          <dt>{t("assets.assetId")}</dt>
          <dd style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{asset.id}</dd>
        </dl>
      </SectionPanel>

      <SectionPanel title={t("assets.danger")} defaultOpen={false}>
        <button
          className="btn btn-danger"
          onClick={() => setConfirmRemove(true)}
          disabled={readOnly}
        >
          <Trash2 size={14} /> {t("assets.removeFromProject")}
        </button>
        <span className="field-hint">{t("assets.removeHint")}</span>
      </SectionPanel>

      {confirmRemove && (
        <ConfirmDialog
          title={t("assets.removeTitle")}
          danger
          confirmLabel={t("common.remove")}
          message={
            <>
              {fillNodes(t("assets.removeConfirm"), {
                name: <strong>{asset.originalName ?? asset.id}</strong>,
              })}
              {isMaster && ` ${t("assets.removeMasterNote")}`}
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
  const t = useT();
  return (
    <SectionPanel title={t("assets.byRole")}>
      {counts.length === 0 ? (
        <span className="field-hint">{t("assets.noReferences")}</span>
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
