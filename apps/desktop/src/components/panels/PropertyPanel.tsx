import { Archive } from "lucide-react";
import { useEffect, useRef } from "react";
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
import { LightingPanel } from "../../features/lighting/LightingPanel";
import { MoodGradePanel } from "../../features/mood/MoodGradePanel";
import { EnhancePanel } from "../../features/enhance/EnhancePanel";
import { PostStepFrame, StepFrame } from "../../features/workflow/StepFrame";
import { QcPanel } from "../../features/qc/QcPanel";
import { RegionPanel } from "../../features/regions/RegionPanel";

/** Contextual right panel: content depends on the active module / selection. */
export function PropertyPanel() {
  const active = useStudio((s) => s.activeModule);
  const readOnly = useStudio(selectReadOnly);
  const mod = moduleById(active);
  const t = useT();
  const label = t(`modules.${mod.id}.label`);
  const panelBody = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panelBody.current) panelBody.current.scrollTop = 0;
  }, [active]);

  return (
    <aside className="panel" aria-label={t("workspace.properties")}>
      <div className="panel-header">
        {label}
        <span className="spacer" />
        {active === "references" && (
          <span className="field-hint">{t("workspace.selectedAsset")}</span>
        )}
      </div>
      <div className="panel-body" ref={panelBody}>
        {readOnly && (
          <div className="readonly-banner">
            <Archive size={14} /> {t("workspace.readOnly")}
          </div>
        )}
        {active === "overview" && <OverviewPanel />}
        {active === "design_dna" && (
          <StepFrame stepId="dna.building">
            <BuildingDnaPanel />
          </StepFrame>
        )}
        {active === "context" && (
          <StepFrame stepId="dna.context">
            <ContextDnaPanel />
          </StepFrame>
        )}
        {active === "references" && (
          <StepFrame stepId="dna.references">
            <AssetPropertyPanel />
          </StepFrame>
        )}
        {active === "generate" && <GeneratePanel />}
        {active === "camera" && (
          <StepFrame stepId="dna.camera">
            <CameraPanel />
          </StepFrame>
        )}
        {active === "lighting" && (
          <StepFrame stepId="dna.lighting">
            <LightingPanel />
          </StepFrame>
        )}
        {active === "mood_grade" && (
          <PostStepFrame>
            <MoodGradePanel />
          </PostStepFrame>
        )}
        {active === "enhance" && <EnhancePanel />}
        {active === "qc" && <QcPanel />}
        {active === "regions" && <RegionPanel />}
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
