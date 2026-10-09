import { Archive } from "lucide-react";
import { selectReadOnly, useStudio } from "../../app/store";
import { AssetPropertyPanel } from "../../features/assets/AssetPropertyPanel";
import { CameraPanel } from "../../features/camera/CameraPanel";
import { BuildingDnaPanel } from "../../features/dna/BuildingDnaPanel";
import { ContextDnaPanel } from "../../features/dna/ContextDnaPanel";
import { GeneratePanel } from "../../features/generate/GeneratePanel";
import { OverviewPanel } from "../../features/overview/OverviewPanel";
import { moduleById } from "../../features/workspace/modules";
import { FutureModulePlaceholder } from "../common/states";
import { useT } from "../../i18n";

/** Contextual right panel: content depends on the active module / selection. */
export function PropertyPanel() {
  const active = useStudio((s) => s.activeModule);
  const readOnly = useStudio(selectReadOnly);
  const mod = moduleById(active);
  const t = useT();
  const label = t(`modules.${mod.id}.label`);

  return (
    <aside className="panel" aria-label={t("workspace.properties")}>
      <div className="panel-header">
        {label}
        <span className="spacer" />
        {active === "references" && (
          <span className="field-hint">{t("workspace.selectedAsset")}</span>
        )}
      </div>
      <div className="panel-body">
        {readOnly && (
          <div className="readonly-banner">
            <Archive size={14} /> {t("workspace.readOnly")}
          </div>
        )}
        {active === "overview" && <OverviewPanel />}
        {active === "design_dna" && <BuildingDnaPanel />}
        {active === "context" && <ContextDnaPanel />}
        {active === "references" && <AssetPropertyPanel />}
        {active === "generate" && <GeneratePanel />}
        {active === "camera" && <CameraPanel />}
        {mod.availableIn !== null && (
          <FutureModulePlaceholder
            compact
            title={label}
            phase={mod.availableIn}
            description={t(`modules.${mod.id}.description`)}
          />
        )}
      </div>
    </aside>
  );
}
