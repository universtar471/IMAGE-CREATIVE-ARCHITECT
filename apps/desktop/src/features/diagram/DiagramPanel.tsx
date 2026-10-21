import { ImageModelPicker, useImageModelChoice } from "../../components/panels/ImageModelPicker";
import { SheetModeTabs, SheetPanel } from "../sheets/SheetPanel";
import { useSheetDraft } from "../sheets/store";
/**
 * Diagram Studio panel (ADR-037, SRS §10.2): source → type → step count → layout → language
 * → plan → edit and approve each step → optional isometric frames → export PNG 2K/4K or MP4.
 */
import { Check, Film, ImageDown, Layers, ListRestart, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  DIAGRAM_LANGUAGES,
  DIAGRAM_LAYOUTS,
  DIAGRAM_MAX_STEPS,
  DIAGRAM_MIN_STEPS,
  DIAGRAM_TYPES,
  allDiagramStepsApproved,
  allowedDiagramEvidence,
  buildDiagramFrameItems,
  defaultGenerationParams,
  diagramFrameOutputs,
  type AssetDTO,
  type DiagramEvidence,
  type DiagramPlan,
  type DiagramStep,
  type FfmpegStatus,
  type GenerationParams,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, NumberField, SelectField, TextField } from "../../components/panels/fields";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { call } from "../../lib/bridge";
import { knowledge } from "../../lib/knowledge";
import { useT } from "../../i18n";
import { DEFAULT_DIAGRAM_CONFIG, stepCountOf, useDiagram, type StepChoice } from "./useDiagram";
import { exportSheetPng, exportVideo, PNG_SIZES, type PngSize } from "./raster";

const isImage = (a: AssetDTO) => a.status === "ready" && !!a.mimeType?.startsWith("image/");

/** The render the diagram starts from: the chosen one, else the selected image, else the master. */
export function diagramSourceId(
  assets: readonly AssetDTO[],
  chosen: string | null,
  selected: string | null,
  master: string | null,
): string | null {
  const images = assets.filter(isImage);
  return (
    [chosen, selected, master].find((id) => !!id && images.some((a) => a.id === id)) ??
    images[0]?.id ??
    null
  );
}

export function LocalDiagramPanel() {
  const imageChoice = useImageModelChoice();
  const ws = useStudio((s) => s.workspace!);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const { config, plan, configure, makePlan, ensureProject } = useDiagram();
  const projectId = ws.project.id;

  useEffect(() => ensureProject(projectId), [ensureProject, projectId]);

  const images = ws.assets.filter(isImage);
  const sourceId = diagramSourceId(
    ws.assets,
    config.sourceAssetId,
    selectedAssetId,
    ws.project.activeMasterAssetId,
  );
  const count = stepCountOf(config);
  const countValid =
    Number.isInteger(count) && count >= DIAGRAM_MIN_STEPS && count <= DIAGRAM_MAX_STEPS;
  const edited = !!plan?.steps.some((s) => s.approved);

  const runPlan = () => {
    if (plan && edited && !window.confirm(t("diagram.replanConfirm"))) return;
    configure({ sourceAssetId: sourceId });
    makePlan(ws.draftDna, ws.project.projectType);
  };

  return (
    <div data-testid="diagram-panel">
      <ImageModelPicker {...imageChoice} disabled={readOnly} />
      <p className="field-hint">{t("diagram.intro")}</p>
      <SectionPanel title={t("diagram.source")}>
        {images.length === 0 ? (
          <p className="field-hint" data-testid="diagram-no-source">
            {t("diagram.noSource")}
          </p>
        ) : (
          <SelectField
            label={t("diagram.source")}
            value={sourceId ?? undefined}
            allowEmpty={false}
            disabled={readOnly}
            options={images.map((a) => ({ value: a.id, label: a.originalName ?? a.id }))}
            onChange={(id) => configure({ sourceAssetId: id ?? null })}
          />
        )}
        <FieldGroup label={t("diagram.extraSources")} hint={t("diagram.sourcesHint")}>
          <ul className="batch-cams">
            {(["floorPlan", "elevation", "model3d"] as const).map((key) => (
              <li key={key}>
                <label>
                  <input
                    type="checkbox"
                    checked={config.sources[key]}
                    disabled={readOnly}
                    onChange={(e) =>
                      configure({ sources: { ...config.sources, [key]: e.target.checked } })
                    }
                  />{" "}
                  {t(`diagram.${key}`)}
                </label>
              </li>
            ))}
          </ul>
        </FieldGroup>
      </SectionPanel>

      <SectionPanel title={t("diagram.type")}>
        <SelectField
          label={t("diagram.type")}
          value={config.type}
          allowEmpty={false}
          disabled={readOnly}
          options={DIAGRAM_TYPES.map((type) => ({
            value: type,
            label: t(`diagram.types.${type}`),
          }))}
          onChange={(type) => configure({ type: type ?? DEFAULT_DIAGRAM_CONFIG.type })}
        />
        <FieldGroup label={t("diagram.stepCount")}>
          <div className="segmented" role="group" aria-label={t("diagram.stepCount")}>
            {([4, 6, 8, "custom"] as const).map((choice: StepChoice) => (
              <button
                key={choice}
                type="button"
                disabled={readOnly}
                aria-pressed={config.stepChoice === choice}
                onClick={() => configure({ stepChoice: choice })}
              >
                {choice === "custom" ? t("diagram.custom") : choice}
              </button>
            ))}
          </div>
        </FieldGroup>
        {config.stepChoice === "custom" && (
          <NumberField
            label={t("diagram.customCount")}
            value={config.customCount}
            disabled={readOnly}
            error={countValid ? undefined : t("diagram.customCount")}
            onChange={(v) => configure({ customCount: v ?? Number.NaN })}
          />
        )}
        <SelectField
          label={t("diagram.layout")}
          value={config.layout}
          allowEmpty={false}
          disabled={readOnly}
          options={DIAGRAM_LAYOUTS.map((layout) => ({
            value: layout,
            label: t(`diagram.layouts.${layout}`),
          }))}
          onChange={(layout) => configure({ layout: layout ?? DEFAULT_DIAGRAM_CONFIG.layout })}
        />
        <SelectField
          label={t("diagram.language")}
          value={config.lang}
          allowEmpty={false}
          disabled={readOnly}
          options={DIAGRAM_LANGUAGES.map((lang) => ({ value: lang, label: t(`locale.${lang}`) }))}
          onChange={(lang) => configure({ lang: lang ?? DEFAULT_DIAGRAM_CONFIG.lang })}
        />
        <div className="btn-row">
          <button
            className="btn btn-primary"
            type="button"
            data-testid="diagram-plan"
            disabled={readOnly || !sourceId || !countValid}
            onClick={runPlan}
          >
            {plan ? <ListRestart size={14} /> : <Layers size={14} />}{" "}
            {plan ? t("diagram.replan") : t("diagram.plan")}
          </button>
        </div>
      </SectionPanel>

      {plan && (
        <>
          <StepsSection plan={plan} readOnly={readOnly} />
          <FramesSection plan={plan} sourceId={sourceId} readOnly={readOnly} />
          <ExportSection plan={plan} sourceId={sourceId} readOnly={readOnly} />
        </>
      )}
    </div>
  );
}

function StepsSection({ plan, readOnly }: { plan: DiagramPlan; readOnly: boolean }) {
  const t = useT();
  const done = plan.steps.filter((s) => s.approved).length;
  return (
    <SectionPanel
      title={t("diagram.stepsTitle")}
      aside={
        <span className={`badge ${done === plan.steps.length ? "badge-success" : "badge-neutral"}`}>
          {t("diagram.approvedCount", { done, total: plan.steps.length })}
        </span>
      }
    >
      {plan.steps.map((step) => (
        <StepEditor key={step.id} plan={plan} step={step} readOnly={readOnly} />
      ))}
    </SectionPanel>
  );
}

function StepEditor({
  plan,
  step,
  readOnly,
}: {
  plan: DiagramPlan;
  step: DiagramStep;
  readOnly: boolean;
}) {
  const t = useT();
  const { editStep, approveStep } = useDiagram();
  const allowed = allowedDiagramEvidence(plan, step);
  const safe = (field: "title" | "caption", lang: "vi" | "en") => (value: string | undefined) =>
    editStep(step.id, { [field]: { ...step[field], [lang]: value ?? "" } });
  // A step with an empty title or caption cannot be approved (the sheet would lose a label).
  const complete = [step.title.vi, step.title.en, step.caption.vi, step.caption.en].every((x) =>
    x.trim(),
  );
  return (
    <fieldset className="diagram-step" data-testid={`diagram-step-${step.index}`}>
      <legend>
        {t("diagram.step", { number: step.index + 1 })}{" "}
        {step.approved && (
          <span className="badge badge-success">
            <Check size={11} /> {t("diagram.approved")}
          </span>
        )}
        {step.frameAssetId && (
          <span className="badge badge-info">{t("diagram.frameAttached")}</span>
        )}
      </legend>
      <TextField
        label={t("diagram.titleVi")}
        value={step.title.vi}
        disabled={readOnly}
        onChange={safe("title", "vi")}
      />
      <TextField
        label={t("diagram.titleEn")}
        value={step.title.en}
        disabled={readOnly}
        onChange={safe("title", "en")}
      />
      <TextField
        label={t("diagram.captionVi")}
        value={step.caption.vi}
        disabled={readOnly}
        onChange={safe("caption", "vi")}
      />
      <TextField
        label={t("diagram.captionEn")}
        value={step.caption.en}
        disabled={readOnly}
        onChange={safe("caption", "en")}
      />
      <SelectField<DiagramEvidence>
        label={t("diagram.evidence")}
        value={step.evidence}
        allowEmpty={false}
        disabled={readOnly}
        hint={
          step.interior && !plan.interiorVerifiable
            ? t("diagram.interiorLocked")
            : step.basis.length
              ? t("diagram.basis", { list: step.basis.join(", ") })
              : t("diagram.noBasis")
        }
        options={(["verified", "inferred", "illustrative"] as const).map((evidence) => ({
          value: evidence,
          label: t(`diagram.evidenceOptions.${evidence}`),
          disabled: !allowed.includes(evidence),
        }))}
        onChange={(evidence) => evidence && editStep(step.id, { evidence })}
      />
      <div className="btn-row">
        <button
          type="button"
          className={`btn btn-sm ${step.approved ? "btn-ghost" : ""}`}
          disabled={readOnly || (!step.approved && !complete)}
          data-testid={`diagram-approve-${step.index}`}
          onClick={() => approveStep(step.id, !step.approved)}
        >
          {step.approved ? t("diagram.unapprove") : t("diagram.approve")}
        </button>
      </div>
    </fieldset>
  );
}

function FramesSection({
  plan,
  sourceId,
  readOnly,
}: {
  plan: DiagramPlan;
  sourceId: string | null;
  readOnly: boolean;
}) {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const { provider, model } = useImageModelChoice();
  const createBatch = useStudio((s) => s.createBatch);
  const flushDna = useStudio((s) => s.flushDna);
  const notify = useStudio((s) => s.notify);
  const setFrames = useDiagram((s) => s.setFrames);
  const spend = useSpendConfirm();
  const [busy, setBusy] = useState(false);
  const source = ws.assets.find((a) => a.id === sourceId) ?? null;
  const params: GenerationParams | null = model
    ? {
        ...defaultGenerationParams(model, source),
        // One fixed 16:9 frame for every step when the model offers it.
        ...(model.aspectRatios.includes("16:9") ? { aspectRatio: "16:9" } : {}),
        outputCount: 1,
      }
    : null;
  const outputs = useMemo(() => diagramFrameOutputs(plan, ws.generations), [plan, ws.generations]);
  const ready = Object.keys(outputs.frames).length;
  const attached = plan.steps.filter((s) => s.frameAssetId).length;

  const queue = async () => {
    if (!provider || !model || !params || !sourceId) return;
    setBusy(true);
    try {
      if (!(await flushDna())) return;
      const current = useStudio.getState().workspace!;
      const pack = knowledge.resolve(current.project.projectType, current.project.subtype).pack;
      const items = buildDiagramFrameItems({
        project: current.project,
        dna: current.persistedDna,
        pack,
        assets: current.assets,
        sourceAssetId: sourceId,
        plan,
        model,
        params,
      });
      const unit = params.imageSize ? model.priceHint?.[params.imageSize] : undefined;
      const accepted = await spend.request({
        providerId: provider.id,
        provider: provider.label,
        model: model.label,
        imageCount: items.length,
        costText:
          provider.kind === "local"
            ? t("batch.costOffline", { count: items.length })
            : t("batch.costRemote", { count: items.length, provider: provider.label }),
        estimatedTotal: unit === undefined ? null : unit * items.length,
      });
      if (!accepted) return;
      // The store's batch flow runs the conflict gate on every item before anything is sent.
      await createBatch({
        projectId: current.project.id,
        name: t("diagram.batchName"),
        providerId: provider.id,
        modelId: model.id,
        purpose: "variation",
        priority: 0,
        items,
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionPanel title={t("diagram.frames")} defaultOpen={false}>
      <p className="field-hint">{t("diagram.framesHint")}</p>
      <div className="btn-row">
        <button
          type="button"
          className="btn"
          data-testid="diagram-generate-frames"
          disabled={readOnly || busy || !model || !sourceId}
          onClick={() => void queue()}
        >
          <Sparkles size={14} /> {t("diagram.generateFrames", { count: plan.steps.length })}
        </button>
      </div>
      {outputs.batchId && (
        <p className="field-hint" data-testid="diagram-frames-ready">
          {t("diagram.framesReady", { done: ready, total: plan.steps.length })}
        </p>
      )}
      <div className="btn-row">
        {ready > 0 && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={readOnly}
            onClick={() => setFrames(outputs.frames)}
          >
            {t("diagram.useFrames")}
          </button>
        )}
        {attached > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={readOnly}
            onClick={() => setFrames(Object.fromEntries(plan.steps.map((s) => [s.id, null])))}
          >
            {t("diagram.clearFrames")}
          </button>
        )}
      </div>
      {spend.dialog}
    </SectionPanel>
  );
}

function ExportSection({
  plan,
  sourceId,
  readOnly,
}: {
  plan: DiagramPlan;
  sourceId: string | null;
  readOnly: boolean;
}) {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const notify = useStudio((s) => s.notify);
  const notifyError = useStudio((s) => s.notifyError);
  const adoptAssets = useStudio((s) => s.adoptAssets);
  const selectAsset = useStudio((s) => s.selectAsset);
  const config = useDiagram((s) => s.config);
  const [ffmpeg, setFfmpeg] = useState<FfmpegStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const approved = allDiagramStepsApproved(plan);
  const projectId = ws.project.id;

  useEffect(() => {
    let live = true;
    call("diagram_ffmpeg_status", {})
      .then((status) => live && setFfmpeg(status))
      .catch(() => live && setFfmpeg({ available: false, version: null }));
    return () => {
      live = false;
    };
  }, []);

  const ctx = sourceId
    ? {
        projectId,
        sourceAssetId: sourceId,
        plan,
        layout: config.layout,
        lang: config.lang,
        title: ws.project.name,
      }
    : null;

  const refreshAssets = async () => {
    const assets = await call("asset_list", { projectId });
    await adoptAssets(projectId, assets);
  };

  const png = async (size: PngSize) => {
    if (!ctx) return;
    setBusy(t("diagram.exporting"));
    try {
      const asset = await exportSheetPng(ctx, size, t("diagram.sheetName", { size }));
      await refreshAssets();
      selectAsset(asset.id);
      notify("success", t("diagram.savedPng"));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  };

  const video = async () => {
    if (!ctx) return;
    try {
      const result = await exportVideo(
        ctx,
        (number) => t("diagram.frameName", { number }),
        (done, total) =>
          setBusy(t("diagram.renderingFrame", { number: Math.min(done + 1, total), total })),
      );
      await refreshAssets();
      notify("success", t("diagram.savedVideo", { path: result.path }));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(null);
    }
  };

  const disabled = readOnly || !ctx || !approved || busy !== null;
  return (
    <SectionPanel title={t("diagram.export")}>
      {!approved && (
        <p className="field-hint" data-testid="diagram-export-hint">
          {t("diagram.exportNeedsApproval")}
        </p>
      )}
      <div className="btn-row">
        {(Object.keys(PNG_SIZES) as PngSize[]).map((size) => (
          <button
            key={size}
            type="button"
            className="btn"
            data-testid={`diagram-png-${size}`}
            disabled={disabled}
            onClick={() => void png(size)}
          >
            <ImageDown size={14} /> {t("diagram.exportPng", { size })}
          </button>
        ))}
        <button
          type="button"
          className="btn"
          data-testid="diagram-mp4"
          disabled={disabled || !ffmpeg?.available}
          title={ffmpeg && !ffmpeg.available ? t("diagram.ffmpegHint") : undefined}
          onClick={() => void video()}
        >
          <Film size={14} />{" "}
          {ffmpeg && !ffmpeg.available ? t("diagram.ffmpegMissing") : t("diagram.exportVideo")}
        </button>
      </div>
      {ffmpeg && !ffmpeg.available && (
        <p className="field-hint" data-testid="diagram-ffmpeg-missing">
          {t("diagram.ffmpegMissing")} — {t("diagram.ffmpegHint")}
        </p>
      )}
      {busy && (
        <p className="field-hint" role="status">
          {busy}
        </p>
      )}
    </SectionPanel>
  );
}

export function DiagramPanel() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const draft = useSheetDraft(projectId, "diagram");
  return (
    <>
      <SheetModeTabs kind="diagram" />
      {draft.mode === "ai" ? <SheetPanel kind="diagram" /> : <LocalDiagramPanel />}
    </>
  );
}
