import { Fragment, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Circle, Dna, LockKeyhole, Minus } from "lucide-react";
import { useStudio } from "../../app/store";
import { WORKSPACE_MODULES, type ModuleId } from "../../features/workspace/modules";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS } from "../../lib/workflow";
import { PremiumIcon, type PremiumIconId } from "../common/PremiumIcon";
import { useWorkspaceLayout } from "../../features/workspace/layout";

const MODULE_PREMIUM_ICONS: Record<ModuleId, PremiumIconId> = {
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

const ADVANCED_KEY = "arch.navAdvancedOpen";
const DNA_STEP_COUNT = WORKFLOW_STEPS.filter((step) => step.stage === "dna").length;

function readAdvancedOpen() {
  try {
    return globalThis.localStorage?.getItem(ADVANCED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAdvancedOpen(open: boolean) {
  try {
    globalThis.localStorage?.setItem(ADVANCED_KEY, open ? "1" : "0");
  } catch {
    /* session-only preference */
  }
}

/**
 * Permanent left navigation (four groups since V6.1, ADR-044: Create image, Edit, Video,
 * Publish). The DNA steps sit in a collapsible "Advanced DNA" part of Create; it opens by
 * itself while one of them is active, so a workflow step is never hidden. Order and grouping are product architecture (regrouped once in
 * ADR-039 around the preset-first Studio) — do not reorder without an ADR.
 */
export function WorkspaceNav() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  const setInspectorOpen = useStudio((s) => s.setInspectorOpen);
  const layout = useWorkspaceLayout();
  const t = useT();
  const workflow = useStudio((s) => s.workflowView);
  const isInterior = useStudio((s) => s.workspace?.project.projectType === "interior");
  const [advancedPref, setAdvancedPref] = useState(readAdvancedOpen);
  // The DNA steps open by themselves while one of them is the active module.
  const activeIsAdvanced = WORKSPACE_MODULES.some((m) => m.id === active && m.advanced);
  const advancedOpen = advancedPref || activeIsAdvanced;
  const toggleAdvanced = () => {
    const next = !advancedOpen;
    setAdvancedPref(next);
    writeAdvancedOpen(next);
  };
  const confirmedSteps =
    workflow?.steps.filter((s) => s.stage === "dna" && s.status === "confirmed").length ?? 0;
  return (
    <nav className="nav" aria-label={t("modules.navLabel")}>
      {WORKSPACE_MODULES.map((m, i) => {
        const prev = WORKSPACE_MODULES[i - 1];
        const label =
          isInterior && m.id === "design_dna" ? t("interior.space") : t(`modules.${m.id}.label`);
        const firstAdvanced = m.advanced && !prev?.advanced;
        return (
          <Fragment key={m.id}>
            {prev && prev.group !== m.group && <div className="nav-group-sep" role="separator" />}
            {(!prev || prev.group !== m.group) && (
              <div className="nav-group-label" data-group={m.group}>
                {t(`modules.groups.${m.group}`)}
              </div>
            )}
            {firstAdvanced && (
              <button
                type="button"
                className="nav-advanced-toggle"
                aria-expanded={advancedOpen}
                aria-controls="nav-advanced"
                aria-label={layout.iconNav ? t("modules.advanced") : undefined}
                title={t("modules.advancedHint")}
                onClick={toggleAdvanced}
                data-testid="nav-advanced"
              >
                <ChevronRight size={14} className="chev" aria-hidden="true" />
                <Dna size={15} aria-hidden="true" />
                <span className="nav-label">{t("modules.advanced")}</span>
                <span className="nav-advanced-count">
                  {t("modules.advancedSteps", { done: confirmedSteps, total: DNA_STEP_COUNT })}
                </span>
              </button>
            )}
            {m.advanced && !advancedOpen ? null : (
              <button
                className={`nav-item ${m.availableIn ? "is-future" : ""} ${m.advanced ? "is-advanced" : ""}`}
                id={firstAdvanced ? "nav-advanced" : undefined}
                aria-current={active === m.id ? "page" : undefined}
                aria-label={layout.iconNav ? label : undefined}
                onClick={() => {
                  setModule(m.id);
                  // Narrow windows: the module's panel is the inspector drawer, so show it.
                  if (layout.drawer) setInspectorOpen(true);
                }}
                title={
                  m.availableIn
                    ? t("modules.futureTitle", { label, phase: m.availableIn })
                    : t(`modules.${m.id}.description`)
                }
                data-module={m.id}
              >
                {(() => {
                  const dnaIndex = WORKFLOW_STEPS.findIndex(
                    (item) => item.moduleId === m.id && item.stage === "dna",
                  );
                  return dnaIndex >= 0 ? (
                    <span className="nav-step-number">{dnaIndex + 1}</span>
                  ) : null;
                })()}
                <PremiumIcon id={MODULE_PREMIUM_ICONS[m.id]} size={19} />
                <span className="nav-label">{label}</span>
                {m.availableIn && <span className="nav-phase">P{m.availableIn}</span>}
                {(() => {
                  const step = WORKFLOW_STEPS.find((item) => item.moduleId === m.id);
                  const status = workflow?.steps.find((item) => item.id === step?.id)?.status;
                  return step && status ? (
                    <span
                      className="nav-status"
                      data-testid={`workflow-status-${step.id}`}
                      title={t(`workflow.status.${status}`)}
                    >
                      {statusIcon(status)}
                    </span>
                  ) : null;
                })()}
              </button>
            )}
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
