import { Archive } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { NextStepBar } from "../../features/workflow/NextStepBar";
import { clampPanelWidth, PANEL_WIDTH_KEY, readPanelWidth } from "./PropertyPanelResize";

/** Contextual right panel: content depends on the active module / selection. */
export function PropertyPanel() {
  const active = useStudio((s) => s.activeModule);
  const readOnly = useStudio(selectReadOnly);
  const mod = moduleById(active);
  const t = useT();
  const isInterior = useStudio((s) => s.workspace?.project.projectType === "interior");
  const label =
    isInterior && mod.id === "design_dna" ? t("interior.space") : t(`modules.${mod.id}.label`);
  const activeIsStep = ["design_dna", "context", "references", "camera", "lighting"].includes(
    active,
  );
  const panelBody = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);

  useEffect(() => {
    const workspace = panelRef.current?.closest<HTMLElement>(".workspace");
    workspace?.style.setProperty("--panel-w", `${panelWidth}px`);
    try { globalThis.localStorage?.setItem(PANEL_WIDTH_KEY, String(panelWidth)); } catch { /* session-only resize */ }
  }, [panelWidth]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const move = (moveEvent: PointerEvent) => setPanelWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX));
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  useEffect(() => {
    if (panelBody.current) panelBody.current.scrollTop = 0;
  }, [active]);

  return (
    <aside className="panel" aria-label={t("workspace.properties")} ref={panelRef}>
      <div className="panel-resize-handle" role="separator" aria-label={t("workspace.resizePanel")} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={720} aria-valuenow={panelWidth} tabIndex={0} onPointerDown={startResize} onKeyDown={(event) => {
        if (event.key === "ArrowLeft") { event.preventDefault(); setPanelWidth((width) => clampPanelWidth(width + 16)); }
        if (event.key === "ArrowRight") { event.preventDefault(); setPanelWidth((width) => clampPanelWidth(width - 16)); }
      }} />
      <div className="panel-header">
        {label}
        <span className="spacer" />
        {active === "references" && (
          <span className="field-hint">{t("workspace.selectedAsset")}</span>
        )}
        {active !== "overview" && !activeIsStep && <NextStepBar compact />}
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
