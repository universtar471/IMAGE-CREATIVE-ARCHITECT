import { costHintText } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { useT } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";
import { isGenerationAllowed } from "../../lib/workflow";
import { canSubmit, checkShot } from "../validation/gate";
import { blockedReason } from "../workflow/blockedReason";
import { generateDisabledReason, type GenerateForm } from "./form";

/**
 * The one submit path of a single generation (Generate panel and quick generate, ADR-040):
 * the disabled reason, the workflow gate, the conflict gate on the draft (ADR-034), the cost
 * estimate, the spend confirmation and `submitGeneration`. Callers render `spendDialog`.
 */
export function useGenerateSubmit(form: GenerateForm) {
  const ws = useStudio((s) => s.workspace!);
  const draft = useStudio((s) => s.generateDraft);
  const run = useStudio((s) => s.run);
  const readOnly = useStudio(selectReadOnly);
  const saveStatus = useStudio((s) => s.save.status);
  const submit = useStudio((s) => s.submitGeneration);
  const t = useT();
  const spend = useSpendConfirm();

  const project = ws.project;
  const running = run?.status === "submitting";
  const reason = generateDisabledReason(form, {
    readOnly,
    submitting: running,
    dnaInvalid: saveStatus === "invalid",
    assets: ws.assets,
  });
  const workflowGate = form.purpose
    ? isGenerationAllowed(form.purpose, ws.workflow?.steps ?? [], {
        masterApproved: ["master_approved", "anchor_generation", "production"].includes(
          project.status,
        ),
        anchorCameraIds: ws.draftDna.cameras
          .filter((camera) => camera.isAnchorView)
          .map((camera) => camera.id),
        cameraIds: ws.draftDna.cameras.map((camera) => camera.id),
        approvedAnchorCameraIds: ws.anchors.map((anchor) => anchor.cameraId),
      })
    : { ok: true as const };
  // Conflict gate (ADR-034): the live view checks the draft; submit re-checks saved data.
  const conflicts = checkShot({
    dna: ws.draftDna,
    projectType: project.projectType,
    cameraId: null,
    extraPrompt: draft.extraPrompt,
    approvedExceptions: draft.approvedExceptions,
    shotIntent: ws.shotIntent,
  });
  const conflictReason = canSubmit(conflicts)
    ? null
    : t(conflicts.verdict === "BLOCK" ? "conflictUi.refusedBlock" : "conflictUi.refusedWarn");
  const disabledReason =
    reason ??
    (workflowGate.ok
      ? null
      : blockedReason(t, workflowGate.blockedBy, !!project.activeMasterAssetId)) ??
    conflictReason;
  const thisRun = run && run.projectId === project.id ? run : null;
  // Estimated price (HHTECH price list): images × tier price; null for unpriced providers.
  const costText = form.model
    ? costHintText(form.model, form.params.imageSize, form.params.outputCount)
    : null;
  const cost = costText ? translateDomainMessage(costText, t) : null;

  const generate = async () => {
    if (!form.provider || !form.model) return;
    const unit = form.params.imageSize ? form.model.priceHint?.[form.params.imageSize] : undefined;
    const estimatedTotal = unit === undefined ? null : unit * form.params.outputCount;
    if (
      !(await spend.request({
        providerId: form.provider.id,
        provider: form.provider.label,
        model: form.model.label,
        imageCount: form.params.outputCount,
        costText: cost,
        estimatedTotal,
      }))
    )
      return;
    void submit({
      projectId: project.id,
      providerId: form.provider.id,
      modelId: form.model.id,
      purpose: form.purpose,
      referenceAssetIds: form.referenceIds,
      params: form.params,
      cameraId: null,
      extraPrompt: draft.extraPrompt,
      approvedExceptions: draft.approvedExceptions,
      shotIntent: ws.shotIntent,
    });
  };

  return {
    running,
    conflicts,
    workflowGate,
    disabledReason,
    cost,
    thisRun,
    generate,
    spendDialog: spend.dialog,
  };
}
