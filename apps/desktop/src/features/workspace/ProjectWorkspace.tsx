import { Camera, FileText, Image as ImageIcon, ImagePlus, LayoutGrid, Orbit } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useStudio } from "../../app/store";
import { CompareCanvas } from "../../components/canvas/CompareCanvas";
import { ErrorState, FutureModulePlaceholder, LoadingState } from "../../components/common/states";
import { PropertyPanel } from "../../components/panels/PropertyPanel";
import { WorkspaceNav } from "../../components/shell/WorkspaceNav";
import { WorkspaceTopBar } from "../../components/shell/WorkspaceTopBar";
import { BottomTray } from "../assets/BottomTray";
import { ConnectedMultiAngleStudio } from "../camera/MultiAngleStudio";
import { CameraDirector } from "../camera/CameraDirector";
import { ContactSheet } from "../camera/ContactSheet";
import { PromptPreview } from "../prompt-preview/PromptPreview";
import { hasOwnCenter, moduleById } from "./modules";
import { WorkspaceLayoutContext, workspaceLayout } from "./layout";
import { useElementSize } from "../../lib/useElementSize";
import { useT } from "../../i18n";
import { GradeCanvas } from "../mood/GradeCanvas";
import type { AssetDTO, ColorGradeDNA, GenerationDTO } from "@arch/domain";
import { resolveEnhancePair } from "../enhance/enhance";
import { EnhanceCheckBadge } from "../enhance/EnhanceControls";
import { RegionCanvas } from "../regions/RegionCanvas";
import { DiagramCanvas } from "../diagram/DiagramCanvas";
import { PublishingStudio } from "../publishing/PublishingStudio";
import { BranchCanvas } from "../canvas/BranchCanvas";
import { VideoCanvas } from "../video/VideoCanvas";
import { MediaViewer } from "../viewer/MediaViewer";
import { StudioPreview } from "../viewer/StudioPreview";
import { navigateTabs } from "../../components/common/tabNavigation";

export function findSubmittedEnhanceResult(
  projectId: string,
  submission: { projectId: string; generationId: string } | null,
  generations: readonly GenerationDTO[],
  assets: readonly AssetDTO[],
): AssetDTO | null {
  if (!submission || submission.projectId !== projectId) return null;
  const generation = generations.find(
    (item) =>
      item.id === submission.generationId &&
      item.projectId === projectId &&
      item.purpose === "enhance" &&
      item.status === "completed",
  );
  return (
    generation?.outputAssetIds.map((id) => assets.find((asset) => asset.id === id)).find(Boolean) ??
    null
  );
}

export function findSubmittedRegionResult(
  projectId: string,
  selectedAssetId: string | null,
  generations: readonly GenerationDTO[],
  assets: readonly AssetDTO[],
): { source: AssetDTO; result: AssetDTO } | null {
  if (!selectedAssetId) return null;
  const generation = generations.find(
    (item) =>
      item.projectId === projectId &&
      item.status === "completed" &&
      (item.purpose as string) === "region_edit" &&
      item.referenceAssetIds.includes(selectedAssetId),
  );
  const result = generation?.outputAssetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .find(Boolean);
  const source = assets.find((asset) => asset.id === selectedAssetId);
  return source && result ? { source, result } : null;
}

/** Permanent four-zone workspace: top bar / nav | center | properties / bottom tray. */
export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const workspace = useStudio((s) => s.workspace);
  const loading = useStudio((s) => s.workspaceLoading);
  const error = useStudio((s) => s.workspaceError);
  const openProject = useStudio((s) => s.openProject);
  const goToHub = useStudio((s) => s.goToHub);
  const t = useT();

  if (loading) return <LoadingState label={t("workspace.opening")} />;
  if (error || !workspace) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <div>
          <ErrorState
            title={t("workspace.openFailed")}
            message={error ?? t("common.unknownError")}
            onRetry={() => void openProject(projectId)}
          />
          <div style={{ textAlign: "center" }}>
            <button className="btn btn-ghost" onClick={() => void goToHub()}>
              {t("workspace.backToHub")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <WorkspaceShell />;
}

/**
 * Responsive shell (ADR-044): measures itself and exposes the layout tier to CSS
 * (`data-tier`, `data-short`, `data-drawer`) and to components (WorkspaceLayoutContext). The
 * five areas stay mounted at every size, so a resize never drops form state or selection.
 */
function WorkspaceShell() {
  const ref = useRef<HTMLDivElement>(null);
  const size = useElementSize(ref);
  const layout = useMemo(() => workspaceLayout(size.width, size.height), [size.width, size.height]);
  const inspectorOpen = useStudio((s) => s.inspectorOpen);
  return (
    <WorkspaceLayoutContext.Provider value={layout}>
      <div
        className="workspace"
        data-testid="workspace"
        ref={ref}
        data-tier={layout.tier}
        data-short={layout.short || undefined}
        data-icon-nav={layout.iconNav || undefined}
        data-drawer={layout.drawer || undefined}
        data-inspector-open={(layout.drawer && inspectorOpen) || undefined}
      >
        <WorkspaceTopBar />
        <WorkspaceNav />
        <CenterArea />
        <PropertyPanel />
        <BottomTray />
      </div>
      <MediaViewer />
    </WorkspaceLayoutContext.Provider>
  );
}

function CenterArea() {
  const active = useStudio((s) => s.activeModule);
  const centerView = useStudio((s) => s.centerView);
  const setCenterView = useStudio((s) => s.setCenterView);
  const assets = useStudio((s) => s.workspace!.assets);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const masterId = useStudio((s) => s.workspace!.project.activeMasterAssetId);
  const setModule = useStudio((s) => s.setModule);
  const hasBatches = useStudio((s) => s.workspace!.batches.length > 0);
  const t = useT();
  const mod = moduleById(active);
  const isCamera = active === "camera";
  // The Camera Director only exists in the Camera module.
  // "branches" was the old centre tab of the graph; the graph is Node mode now (ADR-044).
  const view =
    ((centerView === "director" || centerView === "orbit") && !isCamera) ||
    centerView === "branches"
      ? "canvas"
      : centerView;
  const nodeMode = useStudio((s) => s.workspaceMode) === "node" && !hasOwnCenter(active);

  // Selected asset first; otherwise fall back to the master so DNA editing has a visual anchor.
  const asset =
    assets.find((a) => a.id === selectedId) ?? assets.find((a) => a.id === masterId) ?? null;
  const generations = useStudio((s) => s.workspace!.generations);
  const projectId = useStudio((s) => s.workspace!.project.id);
  const enhanceSubmission = useStudio((s) => s.enhanceSubmission);
  const submittedResult = findSubmittedEnhanceResult(
    projectId,
    enhanceSubmission,
    generations,
    assets,
  );
  const enhanceGeneration = enhanceSubmission
    ? generations.find((generation) => generation.id === enhanceSubmission.generationId)
    : undefined;
  const enhanceSource = enhanceGeneration
    ? (assets.find((item) => item.id === enhanceGeneration.referenceAssetIds[0]) ?? null)
    : null;
  const selectedEnhancePair = selectedId
    ? resolveEnhancePair(selectedId, generations, assets)
    : null;
  const enhanceSourceForView = selectedEnhancePair?.source ?? enhanceSource;
  const enhanceResult = selectedEnhancePair?.result ?? submittedResult;
  // ADR-035 local check of the shown result (absent for legacy enhance rows).
  const enhanceCheck =
    (selectedEnhancePair?.generation ?? (submittedResult ? enhanceGeneration : undefined))
      ?.enhanceCheck ?? null;
  const regionPair =
    active === "regions"
      ? findSubmittedRegionResult(projectId, selectedId, generations, assets)
      : null;
  const grade = (useStudio((s) => s.workspace!.draftDna.colorGrade) ?? {
    schemaVersion: 1,
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    clarity: 0,
    dehaze: 0,
  }) as ColorGradeDNA;

  useEffect(() => {
    if (active === "enhance" && enhanceResult && selectedId !== enhanceResult.id) {
      useStudio.getState().selectAsset(enhanceResult.id);
      setCenterView("canvas");
    }
  }, [active, enhanceResult, selectedId, setCenterView, projectId, enhanceSubmission]);

  return (
    <main className="center" aria-label={t("workspace.canvasLabel")}>
      <div
        className="center-tabs"
        role="tablist"
        hidden={active === "export" || nodeMode}
        onKeyDown={navigateTabs}
      >
        {isCamera && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "director"}
            tabIndex={view === "director" ? 0 : -1}
            onClick={() => setCenterView("director")}
          >
            <Camera size={14} /> {t("workspace.tabDirector")}
          </button>
        )}
        {isCamera && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "orbit"}
            tabIndex={view === "orbit" ? 0 : -1}
            onClick={() => setCenterView("orbit")}
          >
            <Orbit size={14} aria-hidden /> {t("multiAngle.tab")}
          </button>
        )}
        <button
          className="center-tab"
          role="tab"
          aria-selected={view === "canvas"}
          tabIndex={view === "canvas" ? 0 : -1}
          onClick={() => setCenterView("canvas")}
        >
          <ImageIcon size={14} /> {isCamera ? t("workspace.tabImage") : t("workspace.tabCanvas")}
        </button>
        {(isCamera || hasBatches || view === "contact") && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "contact"}
            tabIndex={view === "contact" ? 0 : -1}
            onClick={() => setCenterView("contact")}
          >
            <LayoutGrid size={14} /> {t("workspace.tabContact")}
          </button>
        )}
        <button
          className="center-tab"
          role="tab"
          aria-selected={view === "prompt"}
          tabIndex={view === "prompt" ? 0 : -1}
          onClick={() => setCenterView("prompt")}
        >
          <FileText size={14} /> {t("workspace.tabPrompt")}
        </button>
        <span className="spacer" />
      </div>
      <div className="center-body">
        {mod.availableIn !== null ? (
          <FutureModulePlaceholder
            title={t(`modules.${mod.id}.label`)}
            phase={mod.availableIn}
            description={t(`modules.${mod.id}.description`)}
          />
        ) : nodeMode ? (
          <BranchCanvas />
        ) : active === "export" ? (
          <PublishingStudio />
        ) : view === "prompt" ? (
          <PromptPreview />
        ) : view === "orbit" ? (
          <ConnectedMultiAngleStudio />
        ) : view === "director" ? (
          <CameraDirector />
        ) : view === "contact" ? (
          <ContactSheet />
        ) : active === "mood_grade" ? (
          <GradeCanvas asset={asset} grade={grade} />
        ) : active === "enhance" ? (
          <>
            {enhanceCheck && enhanceResult && (
              <div className="enhance-check-overlay">
                <EnhanceCheckBadge check={enhanceCheck} />
              </div>
            )}
            <CompareCanvas source={enhanceSourceForView ?? asset} result={enhanceResult} />
          </>
        ) : active === "diagram" ? (
          <DiagramCanvas />
        ) : active === "video" ? (
          <VideoCanvas />
        ) : active === "regions" ? (
          regionPair ? (
            <CompareCanvas source={regionPair.source} result={regionPair.result} />
          ) : (
            <RegionCanvas key={asset?.id} />
          )
        ) : (
          <StudioPreview
            emptyAction={
              <button className="btn" onClick={() => setModule("references")}>
                <ImagePlus size={14} /> {t("workspace.goToReferences")}
              </button>
            }
            emptyMessage={active === "generate" ? t("workspace.generateEmpty") : undefined}
          />
        )}
      </div>
    </main>
  );
}
