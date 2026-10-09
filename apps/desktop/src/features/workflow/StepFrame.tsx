import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, LockKeyhole } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { WORKFLOW_STEPS, type DnaStepId, type DerivedWorkflowStep } from "../../lib/workflow";

const DNA_IDS: readonly DnaStepId[] = [
  "dna.building",
  "dna.context",
  "dna.references",
  "dna.camera",
  "dna.lighting",
];

const moduleForStep = (stepId: string) =>
  WORKFLOW_STEPS.find((step) => step.id === stepId)?.moduleId as
    "design_dna" | "context" | "references" | "camera" | "lighting" | undefined;

export function laterStepsToReview(
  workflow: { steps: readonly DerivedWorkflowStep[] } | null | undefined,
  stepId: DnaStepId,
): DerivedWorkflowStep[] {
  const index = DNA_IDS.indexOf(stepId);
  return (
    workflow?.steps.filter(
      (item) => DNA_IDS.indexOf(item.id as DnaStepId) > index && item.status === "confirmed",
    ) ?? []
  );
}

export function StepFrame({ stepId, children }: { stepId: DnaStepId; children: ReactNode }) {
  const t = useT();
  const setModule = useStudio((state) => state.setModule);
  const workflow = useStudio((state) => state.workflowView);
  const confirm = useStudio((state) => state.confirmWorkflowStep);
  const reopen = useStudio((state) => state.reopenWorkflowStep);
  const [guideOpen, setGuideOpen] = useState(true);
  const step = workflow?.steps.find((item) => item.id === stepId) ?? fallbackStep(stepId);
  const number = DNA_IDS.indexOf(stepId) + 1;
  const laterReview = useMemo(() => laterStepsToReview(workflow, stepId), [stepId, workflow]);
  const locked = step.status === "locked";
  const readOnly = locked || step.status === "confirmed" || step.status === "needs_review";
  const statusLabel = t(`workflow.status.${step.status}`);
  const name = t(`workflow.steps.${stepId}.name`);
  const guide = t(`workflow.steps.${stepId}.guide`);

  const onReopen = () => {
    const later = laterReview.length
      ? `\n${laterReview.map((item) => `• ${t(`workflow.steps.${item.id}.name`)}`).join("\n")}`
      : "";
    if (window.confirm(`${t("workflow.reopenConfirm")}\n${t("workflow.reopenLater")}${later}`))
      void reopen(stepId);
  };

  return (
    <section className="workflow-step" data-step-id={stepId} data-step-status={step.status}>
      <header className="workflow-step-header">
        <div>
          <span className="workflow-step-kicker">{t("workflow.stepNumber", { number })}</span>
          <h2>{name}</h2>
        </div>
        <span className={`badge workflow-status workflow-status-${step.status}`}>
          {statusIcon(step.status)} {statusLabel}
        </span>
      </header>

      <div className="workflow-guide">
        <button
          type="button"
          className="workflow-guide-toggle"
          aria-expanded={guideOpen}
          onClick={() => setGuideOpen((value) => !value)}
        >
          {guideOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t("workflow.howTo")}
        </button>
        {guideOpen && <p>{guide}</p>}
      </div>

      {locked && step.blockedBy && (
        <div className="callout callout-warning workflow-banner" role="status">
          <LockKeyhole size={14} />
          <span>{t("workflow.locked", { step: t(`workflow.steps.${step.blockedBy}.name`) })}</span>
          <button
            className="link-btn"
            onClick={() => setModule(moduleForStep(step.blockedBy!) ?? "overview")}
          >
            {t("workflow.goThere")}
          </button>
        </div>
      )}
      {step.status === "needs_review" && (
        <div className="callout callout-warning workflow-banner" role="alert">
          <AlertTriangle size={14} /> {t("workflow.needsReview")}
        </div>
      )}

      <fieldset disabled={readOnly} className="workflow-fields">
        {children}
      </fieldset>

      <footer className="workflow-step-footer">
        {step.status === "available" && (
          <button className="btn btn-primary" onClick={() => void confirm(stepId)}>
            {t("workflow.confirm")}
          </button>
        )}
        {(step.status === "confirmed" || step.status === "needs_review") && (
          <button className="btn btn-ghost" onClick={onReopen}>
            {t("workflow.reopen")}
          </button>
        )}
      </footer>
    </section>
  );
}

export function PostStepFrame({ children }: { children: ReactNode }) {
  const workflow = useStudio((state) => state.workflowView);
  const setModule = useStudio((state) => state.setModule);
  const t = useT();
  const step = workflow?.steps.find((item) => item.id === "post.grade");
  const locked = !step || step.status === "locked";
  return (
    <section
      className="workflow-step"
      data-step-id="post.grade"
      data-step-status={step?.status ?? "locked"}
    >
      {locked && (
        <div className="callout callout-warning workflow-banner" role="status">
          <LockKeyhole size={14} />
          <span>{t("workflow.locked", { step: t("workflow.steps.generate.master.name") })}</span>
          <button className="link-btn" onClick={() => setModule("generate")}>
            {t("workflow.goThere")}
          </button>
        </div>
      )}
      <fieldset disabled={locked} className="workflow-fields">
        {children}
      </fieldset>
    </section>
  );
}

function fallbackStep(stepId: DnaStepId): DerivedWorkflowStep {
  const definition = WORKFLOW_STEPS.find((step) => step.id === stepId)!;
  return {
    ...definition,
    status: stepId === "dna.building" ? "available" : "locked",
    blockedBy: "dna.building",
  };
}

function statusIcon(status: DerivedWorkflowStep["status"]) {
  if (status === "locked") return <LockKeyhole size={12} />;
  if (status === "confirmed" || status === "done") return <Check size={12} />;
  if (status === "needs_review") return <AlertTriangle size={12} />;
  if (status === "skipped") return <Circle size={12} />;
  return <Circle size={12} />;
}
