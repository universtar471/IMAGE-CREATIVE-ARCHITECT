import type { WorkflowStepId } from "@arch/domain";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS } from "../../lib/workflow";

export function BlockedExplainer({ stepId }: { stepId: WorkflowStepId }) {
  const t = useT();
  const setModule = useStudio((state) => state.setModule);
  const module = WORKFLOW_STEPS.find((step) => step.id === stepId)?.moduleId ?? "overview";
  return (
    <details className="blocked-explainer" data-testid={`blocked-explainer-${stepId}`}>
      <summary>{t("workflow.whyLocked")}</summary>
      <p>{t(`workflow.explain.${stepId}` as never)}</p>
      <button className="btn btn-sm" onClick={() => setModule(module as never)}>
        {t("workflow.goToStep")}
      </button>
    </details>
  );
}
