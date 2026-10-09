import { Camera, FileText, Image as ImageIcon, ImagePlus, LayoutGrid } from "lucide-react";
import { useEffect } from "react";
import { useStudio } from "../../app/store";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import { CompareCanvas } from "../../components/canvas/CompareCanvas";
import { ErrorState, FutureModulePlaceholder, LoadingState } from "../../components/common/states";
import { PropertyPanel } from "../../components/panels/PropertyPanel";
import { WorkspaceNav } from "../../components/shell/WorkspaceNav";
import { WorkspaceTopBar } from "../../components/shell/WorkspaceTopBar";
import { BottomTray } from "../assets/BottomTray";
import { CameraDirector } from "../camera/CameraDirector";
import { ContactSheet } from "../camera/ContactSheet";
import { PromptPreview } from "../prompt-preview/PromptPreview";
import { moduleById } from "./modules";
import { useT } from "../../i18n";
import { GradeCanvas } from "../mood/GradeCanvas";
import type { AssetDTO, ColorGradeDNA, GenerationDTO } from "@arch/domain";

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

  return (
    <div className="workspace" data-testid="workspace">
      <WorkspaceTopBar />
      <WorkspaceNav />
      <CenterArea />
      <PropertyPanel />
      <BottomTray />
    </div>
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
  const view = centerView === "director" && !isCamera ? "canvas" : centerView;

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
  const enhanceResult = submittedResult;
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
      <div className="center-tabs" role="tablist">
        {isCamera && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "director"}
            onClick={() => setCenterView("director")}
          >
            <Camera size={14} /> {t("workspace.tabDirector")}
          </button>
        )}
        <button
          className="center-tab"
          role="tab"
          aria-selected={view === "canvas"}
          onClick={() => setCenterView("canvas")}
        >
          <ImageIcon size={14} /> {isCamera ? t("workspace.tabImage") : t("workspace.tabCanvas")}
        </button>
        {(isCamera || hasBatches || view === "contact") && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "contact"}
            onClick={() => setCenterView("contact")}
          >
            <LayoutGrid size={14} /> {t("workspace.tabContact")}
          </button>
        )}
        <button
          className="center-tab"
          role="tab"
          aria-selected={view === "prompt"}
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
        ) : view === "prompt" ? (
          <PromptPreview />
        ) : view === "director" ? (
          <CameraDirector />
        ) : view === "contact" ? (
          <ContactSheet />
        ) : active === "mood_grade" ? (
          <GradeCanvas asset={asset} grade={grade} />
        ) : active === "enhance" ? (
          <CompareCanvas source={enhanceSource ?? asset} result={enhanceResult} />
        ) : (
          <WorkspaceCanvas
            mode={{ kind: "single", asset }}
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
