import type { AssistCatalog, AssistScope, DnaStepId } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { AssistControl } from "./AssistControl";

/** Thin context adapter; parsing and validation stay in the shared engine. */
export function ModuleAssist({
  scope,
  stepId,
  catalog,
  context,
  onApply,
}: {
  scope: AssistScope;
  stepId?: DnaStepId;
  catalog?: AssistCatalog;
  context?: Record<string, unknown>;
  onApply?: React.ComponentProps<typeof AssistControl>["onApply"];
}) {
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  if (readOnly) return null;
  return (
    <AssistControl
      key={`${ws.project.id}:${scope}`}
      scope={scope}
      stepId={stepId}
      projectId={ws.project.id}
      projectType={ws.project.projectType}
      dna={ws.draftDna}
      assets={ws.assets}
      hasMaster={!!ws.project.activeMasterAssetId}
      catalog={catalog}
      context={context}
      onApply={onApply ?? useStudio.getState().applyDnaAssist}
    />
  );
}
