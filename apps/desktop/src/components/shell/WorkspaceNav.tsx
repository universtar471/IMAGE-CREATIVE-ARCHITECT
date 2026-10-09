import { Fragment } from "react";
import { AlertTriangle, Check, Circle, LockKeyhole } from "lucide-react";
import { useStudio } from "../../app/store";
import { WORKSPACE_MODULES } from "../../features/workspace/modules";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS } from "../../lib/workflow";

/** Permanent left navigation. Order and grouping are product architecture — do not reorder. */
export function WorkspaceNav() {
  const active = useStudio((s) => s.activeModule);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const workflow = useStudio((s) => s.workflowView);
  return (
    <nav className="nav" aria-label={t("modules.navLabel")}>
      {WORKSPACE_MODULES.map((m, i) => {
        const prev = WORKSPACE_MODULES[i - 1];
        const Icon = m.icon;
        const label = t(`modules.${m.id}.label`);
        return (
          <Fragment key={m.id}>
            {prev && prev.group !== m.group && <div className="nav-group-sep" role="separator" />}
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
              <Icon size={16} />
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
  return <Circle size={12} />;
}
