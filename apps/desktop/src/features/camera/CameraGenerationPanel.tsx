import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useEffect } from "react";
import { ImagePlus, Sparkles } from "lucide-react";
import {
  effectiveGenerationPreserve,
  isImageProvider,
  isVideoAsset,
  costHintText,
} from "@arch/domain";
import { useStudio, selectReadOnly } from "../../app/store";
import { useT } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";
import { SelectField } from "../../components/panels/fields";
import { HelpPopover } from "../../components/common/HelpPopover";
import { ConfirmDialog } from "../../components/common/Dialog";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { useAssetImport } from "../assets/useAssetImport";
import { GenerateProviderControls } from "../generate/GeneratePanel";
import { GenerationResult } from "../generate/GenerationResult";
import { generateDisabledReason, resolveGenerateForm } from "../generate/form";

/** One source image + the selected Camera DNA, through the normal paid-generation gate. */
export function CameraGenerationPanel() {
  const ws = useStudio((s) => s.workspace!);
  const providers = useStudio((s) => s.providers);
  const providersError = useStudio((s) => s.providersError);
  const draft = useStudio((s) => s.generateDraft);
  const cameraId = useStudio((s) => s.selectedCameraId);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const readOnly = useStudio(selectReadOnly);
  const saving = useStudio((s) => s.save.status);
  const run = useStudio((s) => s.run);
  const running = run?.status === "submitting";
  const { pickAndImport, busy, duplicate } = useAssetImport();
  const spend = useSpendConfirm();
  const t = useT();
  const state = useStudio.getState();
  useEffect(() => {
    if (!useStudio.getState().providers) void useStudio.getState().loadProviders();
  }, []);
  const images = ws.assets.filter((a) => a.status === "ready" && !isVideoAsset(a));
  const sourceId =
    draft.referenceAssetIds?.[0] ?? selectedAssetId ?? ws.project.activeMasterAssetId;
  const source = images.find((a) => a.id === sourceId);
  const form = resolveGenerateForm(
    {
      ...draft,
      source: "sketch",
      purpose: "variation",
      referenceAssetIds: source ? [source.id] : [],
    },
    (providers ?? []).filter((p) => isImageProvider(p) && p.id !== "local_upscale"),
    ws.assets,
    ws.project.activeMasterAssetId,
  );
  const camera = ws.draftDna.cameras.find((c) => c.id === cameraId);
  const generation = ws.shotIntent?.interiorGeneration;
  const locked =
    ws.project.projectType === "interior" &&
    generation &&
    effectiveGenerationPreserve(generation).camera;
  const reason = !source
    ? t("interiorFlow.sourceRequired")
    : !camera
      ? t("multiAngle.cameraMissing")
      : locked
        ? t("multiAngle.locked")
        : generateDisabledReason(form, {
            readOnly,
            submitting: running,
            dnaInvalid: saving === "invalid",
            assets: ws.assets,
          });
  const chooseSource = (id: string) => {
    if (useStudio.getState().workspace?.project.id !== ws.project.id) return;
    state.setGenerateDraft({ source: "sketch", purpose: "variation", referenceAssetIds: [id] });
    state.selectAsset(id, { keepView: true });
  };
  const generate = async () => {
    if (reason || !source || !camera || !form.provider || !form.model) return;
    const provider = form.provider;
    const model = form.model;
    const unit = form.params.imageSize ? model.priceHint?.[form.params.imageSize] : undefined;
    if (
      !(await spend.request({
        providerId: provider.id,
        provider: provider.label,
        model: model.label,
        imageCount: form.params.outputCount,
        costText: costHintText(model, form.params.imageSize, form.params.outputCount),
        estimatedTotal: unit === undefined ? null : unit * form.params.outputCount,
      }))
    )
      return;
    if (
      useStudio.getState().workspace?.project.id !== ws.project.id ||
      selectReadOnly(useStudio.getState())
    )
      return;
    // Store flushes and compiles the selected camera from persisted DNA.
    useStudio
      .getState()
      .setGenerateDraft({ source: "sketch", purpose: "variation", referenceAssetIds: [source.id] });
    await useStudio.getState().submitGeneration({
      projectId: ws.project.id,
      providerId: provider.id,
      modelId: model.id,
      purpose: "variation",
      referenceAssetIds: [source.id],
      params: form.params,
      cameraId: camera.id,
      shotIntent: ws.shotIntent,
    });
  };
  return (
    <div className="camera-generation-panel" data-testid="camera-generation-panel">
      <div className="field-heading">
        <strong>{t("multiAngle.generateView")}</strong>
        <HelpPopover topic={t("multiAngle.title")}>{t("multiAngle.generateHelp")}</HelpPopover>
      </div>
      <SelectField
        label={t("generate.source")}
        disabled={readOnly || running}
        value={source?.id}
        options={images.map((a) => ({ value: a.id, label: a.originalName ?? a.id }))}
        onChange={(id) => {
          if (id) chooseSource(id);
        }}
      />
      <button
        type="button"
        className="btn btn-sm"
        disabled={readOnly || running || !!busy}
        onClick={() =>
          void pickAndImport().then((id) => {
            if (id) chooseSource(id);
          })
        }
      >
        <ImagePlus size={15} aria-hidden /> {t("interiorFlow.upload")}
      </button>
      {providers ? (
        <GenerateProviderControls form={form} disabled={readOnly || running} />
      ) : (
        <button type="button" className="btn" onClick={() => void state.loadProviders()}>
          {providersError ?? t("generate.loadingProviders")} · {t("common.tryAgain")}
        </button>
      )}
      <button
        type="button"
        className="btn btn-primary generate-btn"
        disabled={!!reason}
        data-testid="camera-generate-button"
        onClick={() => void generate()}
      >
        <Sparkles size={15} aria-hidden /> {t("multiAngle.generateView")}
      </button>
      {reason && (
        <span className="field-hint" data-testid="camera-generation-reason">
          {translateDomainMessage(reason, t)}
        </span>
      )}
      {run?.projectId === ws.project.id && run.status === "error" && (
        <div className="callout callout-error" role="alert">
          <ErrorMessage code={run.code} message={translateDomainMessage(run.message, t)} />
        </div>
      )}
      <GenerationResult />
      {spend.dialog}
      {duplicate && (
        <ConfirmDialog
          title={t("assets.duplicateTitle")}
          message={duplicate.message}
          confirmLabel={t("assets.importAnyway")}
          onConfirm={() => duplicate.resolve(true)}
          onCancel={() => duplicate.resolve(false)}
        />
      )}
    </div>
  );
}
