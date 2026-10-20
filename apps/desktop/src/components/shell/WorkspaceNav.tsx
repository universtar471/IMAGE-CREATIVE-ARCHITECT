import { Fragment } from "react";
import { AlertTriangle, Check, Circle, LockKeyhole, Minus } from "lucide-react";
import { useStudio } from "../../app/store";
import { WORKSPACE_MODULES, type ModuleId } from "../../features/workspace/modules";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS } from "../../lib/workflow";
import { PremiumIcon, type PremiumIconId } from "../common/PremiumIcon";

const MODULE_PREMIUM_ICONS: Record<ModuleId, PremiumIconId> = {
  overview: "preset-grid",
  generate: "create-image",
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

/**
 * Permanent left navigation. Order and grouping are product architecture (regrouped once in
 * ADR-039 around the preset-first Studio) — do not reorder without an ADR.
 */
export function WorkspaceNav() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const workflow = useStudio((s) => s.workflowView);
  const isInterior = useStudio((s) => s.workspace?.project.projectType === "interior");
  return (
    <nav className="nav" aria-label={t("modules.navLabel")}>
      {WORKSPACE_MODULES.map((m, i) => {
        const prev = WORKSPACE_MODULES[i - 1];
        const label =
          isInterior && m.id === "design_dna" ? t("interior.space") : t(`modules.${m.id}.label`);
        return (
          <Fragment key={m.id}>
            {prev && prev.group !== m.group && <div className="nav-group-sep" role="separator" />}
            {(!prev || prev.group !== m.group) && (
              <div className="nav-group-label" data-group={m.group}>
                {t(`modules.groups.${m.group}`)}
              </div>
            )}
            <button
              className={`nav-item ${m.availableIn ? "is-future" : ""}`}
              aria-current={active === m.id ? "page" : undefined}
              onClick={() => setModule(m.id)}
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
