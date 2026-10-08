import { Camera, FileText, Image as ImageIcon, ImagePlus, LayoutGrid } from "lucide-react";
import { useStudio } from "../../app/store";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import { ErrorState, FutureModulePlaceholder, LoadingState } from "../../components/common/states";
import { PropertyPanel } from "../../components/panels/PropertyPanel";
import { WorkspaceNav } from "../../components/shell/WorkspaceNav";
import { WorkspaceTopBar } from "../../components/shell/WorkspaceTopBar";
import { BottomTray } from "../assets/BottomTray";
import { CameraDirector } from "../camera/CameraDirector";
import { ContactSheet } from "../camera/ContactSheet";
import { PromptPreview } from "../prompt-preview/PromptPreview";
import { moduleById } from "./modules";

/** Permanent four-zone workspace: top bar / nav | center | properties / bottom tray. */
export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const workspace = useStudio((s) => s.workspace);
  const loading = useStudio((s) => s.workspaceLoading);
  const error = useStudio((s) => s.workspaceError);
  const openProject = useStudio((s) => s.openProject);
  const goToHub = useStudio((s) => s.goToHub);

  if (loading) return <LoadingState label="Opening project…" />;
  if (error || !workspace) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
        <div>
          <ErrorState
            title="Could not open the project"
            message={error ?? "Unknown error."}
            onRetry={() => void openProject(projectId)}
          />
          <div style={{ textAlign: "center" }}>
            <button className="btn btn-ghost" onClick={() => void goToHub()}>
              Back to Project Hub
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
  const mod = moduleById(active);
  const isCamera = active === "camera";
  // The Camera Director only exists in the Camera module.
  const view = centerView === "director" && !isCamera ? "canvas" : centerView;

  // Selected asset first; otherwise fall back to the master so DNA editing has a visual anchor.
  const asset =
    assets.find((a) => a.id === selectedId) ?? assets.find((a) => a.id === masterId) ?? null;

  return (
    <main className="center" aria-label="Workspace canvas">
      <div className="center-tabs" role="tablist">
        {isCamera && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "director"}
            onClick={() => setCenterView("director")}
          >
            <Camera size={14} /> Camera Director
          </button>
        )}
        <button
          className="center-tab"
          role="tab"
          aria-selected={view === "canvas"}
          onClick={() => setCenterView("canvas")}
        >
          <ImageIcon size={14} /> {isCamera ? "Image" : "Canvas"}
        </button>
        {(isCamera || hasBatches || view === "contact") && (
          <button
            className="center-tab"
            role="tab"
            aria-selected={view === "contact"}
            onClick={() => setCenterView("contact")}
          >
            <LayoutGrid size={14} /> Contact Sheet
          </button>
        )}
        <button
          className="center-tab"
          role="tab"
          aria-selected={view === "prompt"}
          onClick={() => setCenterView("prompt")}
        >
          <FileText size={14} /> Prompt Preview
        </button>
        <span className="spacer" />
      </div>
      <div className="center-body">
        {mod.availableIn !== null ? (
          <FutureModulePlaceholder
            title={mod.label}
            phase={mod.availableIn}
            description={mod.description}
          />
        ) : view === "prompt" ? (
          <PromptPreview />
        ) : view === "director" ? (
          <CameraDirector />
        ) : view === "contact" ? (
          <ContactSheet />
        ) : (
          <WorkspaceCanvas
            mode={{ kind: "single", asset }}
            emptyAction={
              <button className="btn" onClick={() => setModule("references")}>
                <ImagePlus size={14} /> Go to References
              </button>
            }
            emptyMessage={
              active === "generate"
                ? "Nothing to show yet. Generate an image with the panel on the right, or import a master in the Assets tray."
                : undefined
            }
          />
        )}
      </div>
    </main>
  );
}
