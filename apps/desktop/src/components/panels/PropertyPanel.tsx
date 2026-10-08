import { Archive } from "lucide-react";
import { selectReadOnly, useStudio } from "../../app/store";
import { AssetPropertyPanel } from "../../features/assets/AssetPropertyPanel";
import { BuildingDnaPanel } from "../../features/dna/BuildingDnaPanel";
import { ContextDnaPanel } from "../../features/dna/ContextDnaPanel";
import { OverviewPanel } from "../../features/overview/OverviewPanel";
import { moduleById } from "../../features/workspace/modules";
import { FutureModulePlaceholder } from "../common/states";

/** Contextual right panel: content depends on the active module / selection. */
export function PropertyPanel() {
  const active = useStudio((s) => s.activeModule);
  const readOnly = useStudio(selectReadOnly);
  const mod = moduleById(active);

  return (
    <aside className="panel" aria-label="Properties">
      <div className="panel-header">
        {mod.label}
        <span className="spacer" />
        {active === "references" && <span className="field-hint">Selected asset</span>}
      </div>
      <div className="panel-body">
        {readOnly && (
          <div className="readonly-banner">
            <Archive size={14} /> Archived — read-only. Restore to edit.
          </div>
        )}
        {active === "overview" && <OverviewPanel />}
        {active === "design_dna" && <BuildingDnaPanel />}
        {active === "context" && <ContextDnaPanel />}
        {active === "references" && <AssetPropertyPanel />}
        {mod.availableIn !== null && (
          <FutureModulePlaceholder
            compact
            title={mod.label}
            phase={mod.availableIn}
            description={mod.description}
          />
        )}
      </div>
    </aside>
  );
}
