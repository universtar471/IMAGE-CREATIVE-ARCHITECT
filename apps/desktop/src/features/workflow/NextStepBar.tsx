import { ArrowRight } from "lucide-react";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { nextStep } from "../../lib/nextStep";
import type { ModuleId } from "../workspace/modules";

export function nextStepBarMode(active: ModuleId, target: ModuleId): "hidden" | "hint" | "bar" {
  if (active === "export") return "hidden";
  return active === target ? "hint" : "bar";
}

export function NextStepBar({ large = false }: { large?: boolean }) {
  const workspace = useStudio((state) => state.workspace);
  const workflow = useStudio((state) => state.workflowView);
  const active = useStudio((state) => state.activeModule);
  const setModule = useStudio((state) => state.setModule);
  const t = useT();
  if (!workspace) return null;
  const step = nextStep(workspace, workflow);
  const mode = large ? "bar" : nextStepBarMode(active, step.module);
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
    step.focus === "create-master"
      ? t("nextStep.masterCreate")
      : step.focus === "approve-master"
        ? t("nextStep.masterApprove")
        : t(`nextStep.steps.${step.id}` as never, { count });
  if (mode === "hint") return <p className="next-step-hint">{t("nextStep.here", { title })}</p>;
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
