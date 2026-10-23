import { Fragment } from "react";
import { AlertTriangle, Check, Circle, LockKeyhole, Minus } from "lucide-react";
import { useStudio } from "../../app/store";
import { WORKSPACE_MODULES, type ModuleId } from "../../features/workspace/modules";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS } from "../../lib/workflow";
import { PremiumIcon, type PremiumIconId } from "../common/PremiumIcon";
import { useWorkspaceLayout } from "../../features/workspace/layout";
import { useEditableSource } from "../../features/assets/useEditableSource";

const MODULE_PREMIUM_ICONS: Record<ModuleId, PremiumIconId> = {
  style: "preset-grid",
  rooms: "townhouse",
  overview: "preset-grid",
  generate: "create-image",
  video: "video",
  design_dna: "townhouse",
  context: "resort",
  references: "composite",
  camera: "view",
  lighting: "day",
  detail: "closeup",
  scene_objects: "car",
  effects: "atmosphere",
  mood_grade: "color",
  enhance: "enhance",
  regions: "edit",
  diagram: "isometric",
  export: "portfolio",
};

/** Shared icon-first navigation. Hidden legacy routes remain readable for old projects. */
export function WorkspaceNav() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  const setInspectorOpen = useStudio((s) => s.setInspectorOpen);
  const layout = useWorkspaceLayout();
  const t = useT();
  const workflow = useStudio((s) => s.workflowView);
  const editableSource = useEditableSource();
  const isInterior = useStudio((s) => s.workspace?.project.projectType === "interior");
  const visible = WORKSPACE_MODULES.filter(
    (m) =>
      m.id !== "scene_objects" &&
      m.id !== "context" &&
      !(isInterior && m.id === "references") &&
      m.id !== "rooms" &&
      !(isInterior && m.id === "detail"),
  );
  // Keep the familiar overview / create entry points, followed by the design controls.
  const order = [
    "overview",
    "generate",
    "design_dna",
    "style",
    "rooms",
    "context",
    "references",
    "camera",
    "lighting",
    "effects",
    "regions",
    "mood_grade",
    "enhance",
    "detail",
    "video",
    "diagram",
    "export",
  ];
  visible.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return (
    <nav className="nav" aria-label={t("modules.navLabel")}>
      {visible.map((m, i) => {
        const label =
          isInterior && m.id === "design_dna" ? t("interior.space") : t(`modules.${m.id}.label`);
        const step = WORKFLOW_STEPS.find((item) => item.moduleId === m.id);
        const status =
          step?.id === "post.grade" && editableSource
            ? "available"
            : workflow?.steps.find((s) => s.id === step?.id)?.status;
        return (
          <Fragment key={m.id}>
            {i > 0 && visible[i - 1]?.group !== m.group && (
              <div className="nav-group-sep" role="separator" />
            )}
            <button
              className="nav-item"
              aria-current={active === m.id ? "page" : undefined}
              aria-label={label}
              title={`${label}: ${t(`modules.${m.id}.description`)}`}
              data-module={m.id}
              onClick={() => {
                setModule(m.id);
                if (layout.drawer) setInspectorOpen(true);
              }}
            >
              <PremiumIcon id={MODULE_PREMIUM_ICONS[m.id]} size={22} />
              <span className="nav-label">{label}</span>
              {step && status && (
                <span
                  className="nav-status"
                  data-testid={`workflow-status-${step.id}`}
                  title={t(`workflow.status.${status}`)}
                >
                  {statusIcon(status)}
                </span>
              )}
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}

function statusIcon(status: string) {
  if (status === "locked") return <LockKeyhole size={12} />;
  if (status === "confirmed" || status === "done") return <Check size={12} />;
  if (status === "needs_review") return <AlertTriangle size={12} />;
  if (status === "skipped") return <Minus size={12} />;
  return <Circle size={12} />;
}
