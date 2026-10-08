import { FileText, Image as ImageIcon, ImagePlus } from "lucide-react";
import { useStudio } from "../../app/store";
import { WorkspaceCanvas } from "../../components/canvas/WorkspaceCanvas";
import { ErrorState, FutureModulePlaceholder, LoadingState } from "../../components/common/states";
import { PropertyPanel } from "../../components/panels/PropertyPanel";
import { WorkspaceNav } from "../../components/shell/WorkspaceNav";
import { WorkspaceTopBar } from "../../components/shell/WorkspaceTopBar";
import { BottomTray } from "../assets/BottomTray";
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
  const mod = moduleById(active);

  // Selected asset first; otherwise fall back to the master so DNA editing has a visual anchor.
  const asset =
    assets.find((a) => a.id === selectedId) ?? assets.find((a) => a.id === masterId) ?? null;

  return (
    <main className="center" aria-label="Workspace canvas">
      <div className="center-tabs" role="tablist">
        <button
          className="center-tab"
          role="tab"
          aria-selected={centerView === "canvas"}
          onClick={() => setCenterView("canvas")}
        >
          <ImageIcon size={14} /> Canvas
        </button>
        <button
          className="center-tab"
          role="tab"
          aria-selected={centerView === "prompt"}
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
        ) : centerView === "prompt" ? (
          <PromptPreview />
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
