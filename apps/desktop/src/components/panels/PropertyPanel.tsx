import { StylePanel } from "../../features/style/StylePanel";
import { RoomsPanel } from "../../features/rooms/RoomsPanel";
import { ModuleAssist } from "../../features/assist/ModuleAssist";
import { HelpPopover } from "../common/HelpPopover";
import { Archive, X } from "lucide-react";
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
import { RegionPanel } from "../../features/regions/RegionPanel";
import { PublishingPanel } from "../../features/publishing/PublishingPanel";
import { SceneObjectsPanel } from "../../features/sceneObjects/SceneObjectsPanel";
import { DetailPanel } from "../../features/detail/DetailPanel";
import { DiagramPanel } from "../../features/diagram/DiagramPanel";
import { VideoPanel } from "../../features/video/VideoPanel";
import { EffectsPanel } from "../../features/effects/EffectsPanel";
import { SelectionInspector } from "../../features/selection/SelectionInspector";
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  PANEL_WIDTH_KEY,
  readPanelWidth,
} from "./PropertyPanelResize";
import { effectivePanelWidth, useWorkspaceLayout } from "../../features/workspace/layout";

/** Contextual right panel: content depends on the active module / selection. */
export function PropertyPanel() {
  const active = useStudio((s) => s.activeModule);
  const regionSourceId = useStudio(
    (s) => s.selectedAssetId ?? s.workspace?.project.activeMasterAssetId,
  );
  const variationSource = useStudio((s) =>
    s.activeModule === "generate" && s.generateDraft.purpose === "variation"
      ? s.generateDraft.referenceAssetIds?.[0]
      : undefined,
  );
  const readOnly = useStudio(selectReadOnly);
  const mod = moduleById(active);
  const t = useT();
  const isInterior = useStudio((s) => s.workspace?.project.projectType === "interior");
  const label =
    isInterior && mod.id === "design_dna" ? t("interior.space") : t(`modules.${mod.id}.label`);
  const panelBody = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const layout = useWorkspaceLayout();
  const drawerOpen = useStudio((s) => s.inspectorOpen);
  const setDrawerOpen = useStudio((s) => s.setInspectorOpen);
  // The stored width is the user's choice; the shell only caps what fits right now, so a
  // window that grows again gets the chosen width back (ADR-044).
  const shownWidth = effectivePanelWidth(panelWidth, layout);

  useEffect(() => {
    const workspace = panelRef.current?.closest<HTMLElement>(".workspace");
    workspace?.style.setProperty("--panel-w", `${shownWidth}px`);
  }, [shownWidth]);

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    } catch {
      /* session-only resize */
    }
  }, [panelWidth]);

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = shownWidth;
    const move = (moveEvent: PointerEvent) =>
      setPanelWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX));
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  useEffect(() => {
    if (panelBody.current) panelBody.current.scrollTop = 0;
  }, [active, variationSource]);

  return (
    <aside
      className="panel"
      aria-label={t("workspace.properties")}
      ref={panelRef}
      data-testid="property-panel"
      // A closed drawer stays mounted (form state survives) but is out of the tab order.
      inert={layout.drawer && !drawerOpen ? true : undefined}
      onKeyDown={(event) => {
        if (layout.drawer && event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          setDrawerOpen(false);
        }
      }}
    >
      <div
        className="panel-resize-handle"
        role="separator"
        aria-label={t("workspace.resizePanel")}
        aria-orientation="vertical"
        aria-valuemin={320}
        aria-valuemax={720}
        aria-valuenow={shownWidth}
        tabIndex={0}
        title={t("workspace.resizePanelHint")}
        onPointerDown={startResize}
        onDoubleClick={() => setPanelWidth(DEFAULT_PANEL_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            setPanelWidth(clampPanelWidth(shownWidth + 16));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            setPanelWidth(clampPanelWidth(shownWidth - 16));
          }
          if (event.key === "Home") {
            event.preventDefault();
            setPanelWidth(320);
          }
          if (event.key === "End") {
            event.preventDefault();
            setPanelWidth(720);
          }
        }}
      />
      <div className="panel-header">
        {label}
        <HelpPopover topic={label}>{t(`modules.${mod.id}.description`)}</HelpPopover>
        <span className="spacer" />
        {active === "references" && (
          <span className="field-hint">{t("workspace.selectedAsset")}</span>
        )}
        {layout.drawer && (
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon panel-drawer-close"
            aria-label={t("workspace.closeInspector")}
            title={t("workspace.closeInspector")}
            onClick={() => setDrawerOpen(false)}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <div className="panel-body" ref={panelBody}>
        {readOnly && (
          <div className="readonly-banner">
            <Archive size={14} /> {t("workspace.readOnly")}
          </div>
        )}
        {/* References has its own full asset panel; elsewhere the selection block leads. */}
        {active !== "references" && <SelectionInspector />}
        {active === "style" && <StylePanel />}
        {active === "rooms" && <RoomsPanel />}
        {active === "camera" && <ModuleAssist scope="camera" stepId="dna.camera" />}
        {active === "mood_grade" && <ModuleAssist scope="mood" />}
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
        {active === "video" && <VideoPanel />}
        {active === "camera" && (
          <StepFrame stepId="dna.camera">
            <CameraPanel />
          </StepFrame>
        )}
        {active === "detail" && <DetailPanel />}
        {active === "scene_objects" && <SceneObjectsPanel />}
        {active === "effects" && <EffectsPanel />}
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
        {active === "regions" && <RegionPanel key={regionSourceId} />}
        {active === "diagram" && <DiagramPanel />}
        {active === "export" && <PublishingPanel />}
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
