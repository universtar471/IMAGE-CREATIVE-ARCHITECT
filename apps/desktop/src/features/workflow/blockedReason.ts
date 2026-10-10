import type { WorkflowStepId } from "@arch/domain";
import type { TFunction } from "../../i18n";

/**
 * User-facing reason a generation is blocked by a workflow step. The Master step gets an
 * actionable message (what to press, where) because "set as Master" and "approve Master" are
 * two separate actions; other steps name the step in the current language.
 */
export function blockedReason(t: TFunction, blockedBy: WorkflowStepId, hasMaster: boolean): string {
  if (blockedBy === "generate.master") {
    return hasMaster ? t("workflow.blockedMasterPending") : t("workflow.blockedNoMaster");
  }
  return t("workflow.generationBlocked", {
    step: t(`workflow.steps.${blockedBy}.name` as never),
  });
}
