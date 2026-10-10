import { ArrowRight } from "lucide-react";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { nextStep } from "../../lib/nextStep";
import type { ModuleId } from "../workspace/modules";

export function nextStepBarMode(active: ModuleId): "hidden" | "bar" {
  if (active === "export") return "hidden";
  return "bar";
}

const STEP_TITLE_KEYS: Record<string, string> = {
  "dna.building": "building",
  "dna.context": "context",
  "dna.references": "references",
  "dna.camera": "camera",
  "dna.lighting": "lighting",
  "generate.master": "master",
  "generate.anchors": "anchors",
  "generate.render": "render",
  "post.grade": "grade",
};

export function nextStepTitleKey(stepId: string): string {
  return STEP_TITLE_KEYS[stepId] ?? "building";
}

export function NextStepTitle({ stepId }: { stepId: string }) {
  const t = useT();
  return <>{t(`nextStep.steps.${nextStepTitleKey(stepId)}` as never)}</>;
}

export function NextStepBar({
  large = false,
  compact = false,
}: {
  large?: boolean;
  compact?: boolean;
}) {
  const workspace = useStudio((state) => state.workspace);
  const workflow = useStudio((state) => state.workflowView);
  const active = useStudio((state) => state.activeModule);
  const setModule = useStudio((state) => state.setModule);
  const t = useT();
  if (!workspace) return null;
  const step = nextStep(workspace, workflow);
  const mode = large ? "bar" : nextStepBarMode(active);
  if (mode === "hidden") return null;
  const count =
    step.id === "generate.anchors"
      ? workspace.draftDna.cameras.filter(
          (camera) =>
            camera.isAnchorView &&
            !workspace.anchors.some((anchor) => anchor.cameraId === camera.id),
        ).length
      : 0;
  const title =
    workspace.project.projectType === "interior" && step.id === "dna.building"
      ? t("nextStep.confirmInteriorSpace")
      : step.focus === "create-master"
        ? t("nextStep.masterCreate")
        : step.focus === "approve-master"
          ? t("nextStep.masterApprove")
          : t(`nextStep.steps.${nextStepTitleKey(step.id)}` as never, { count });
  if (compact) {
    return (
      <button
        type="button"
        className="next-step-compact"
        data-testid="next-step-compact"
        onClick={() => setModule(step.module)}
      >
        {t("nextStep.compact", { title })} <ArrowRight size={13} />
      </button>
    );
  }
  return (
    <section
      className={`next-step-bar ${large ? "next-step-large" : ""}`}
      data-testid="next-step-bar"
    >
      <div>
        <span className="field-hint">{t("nextStep.label")}</span>
        <strong>{title}</strong>
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => setModule(step.module)}>
        {t("nextStep.go")} <ArrowRight size={13} />
      </button>
    </section>
  );
}
