import {
  AlertTriangle,
  Anchor,
  Clapperboard,
  ImageOff,
  ImagePlus,
  KeyRound,
  LayoutGrid,
  Minus,
  RotateCcw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { PresetGrid } from "../presets/PresetGrid";
import { SketchupInbox } from "./SketchupInbox";
import { RecipeSection } from "./RecipeSection";
import {
  anchorViews,
  costHintText,
  dnaReadiness,
  type PlannedVariant,
  type AssetDTO,
  type GenerationParams,
  type ModelCapabilities,
  isImageProvider,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { RoleBadge } from "../../components/common/StatusBadge";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { LoadingState } from "../../components/common/states";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, NumberField, SelectField } from "../../components/panels/fields";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";
import { readinessLabel, translateDomainMessage } from "../../i18n/domain";
import { ExtraPromptSection } from "./ExtraPromptSection";
import { GeneratePromptPreview } from "./GeneratePromptPreview";
import { GenerationResult } from "./GenerationResult";
import { QualityField } from "./QualityField";
import { generateDisabledReason, resolveGenerateForm, type GenerateForm } from "./form";
import { isGenerationAllowed } from "../../lib/workflow";
import { blockedReason } from "../workflow/blockedReason";
import { BatchDialog } from "../camera/BatchDialog";
import type { BatchMode } from "../camera/batch";
import { isMasterApproved } from "../camera/labels";
import { useAssetImport } from "../assets/useAssetImport";
import { ConfirmDialog } from "../../components/common/Dialog";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { HelpPopover } from "../../components/common/HelpPopover";
import { BlockedExplainer } from "../workflow/BlockedExplainer";
import { ConflictPanel, useConflictFix } from "../validation/ConflictPanel";
import { checkShot } from "../validation/gate";
import { VisualIntentSelector } from "../camera/VisualIntentSelector";

/** Right panel of the Generate module: provider, params, references, prompt, run, result. */
export function GeneratePanel() {
  const allProviders = useStudio((s) => s.providers);
  const providers = allProviders && allProviders.filter(isImageProvider);
  const providersError = useStudio((s) => s.providersError);
  const loadProviders = useStudio((s) => s.loadProviders);
  const ws = useStudio((s) => s.workspace!);
  const draft = useStudio((s) => s.generateDraft);
  const run = useStudio((s) => s.run);
  const readOnly = useStudio(selectReadOnly);
  const saveStatus = useStudio((s) => s.save.status);
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const submit = useStudio((s) => s.submitGeneration);
  const openProviderDialog = useStudio((s) => s.openProviderDialog);
  const setModule = useStudio((s) => s.setModule);
  const [batchMode, setBatchMode] = useState<BatchMode | null>(null);
  const [mode, setMode] = usePanelMode();
  const queuedHere = useQueuedCount(ws.project.id);
  const t = useT();
  const spend = useSpendConfirm();
  const fixConflict = useConflictFix("extra-prompt");

  if (!providers) {
    if (providersError) {
      return (
        <div className="callout callout-error" role="alert">
          <span>
            <strong>{t("generate.providersFailed")}</strong> {providersError}
          </span>
          <button className="btn btn-sm" onClick={() => void loadProviders()}>
            {t("common.tryAgain")}
          </button>
        </div>
      );
    }
    return <LoadingState label={t("generate.loadingProviders")} />;
  }

  const project = ws.project;
  const form = resolveGenerateForm(draft, providers, ws.assets, project.activeMasterAssetId);
  const running = run?.status === "submitting";
  const reason = generateDisabledReason(form, {
    readOnly,
    submitting: running,
    dnaInvalid: saveStatus === "invalid",
    assets: ws.assets,
  });
  // Advisory creative check: the live view checks the draft; submit re-checks saved data.
  const conflicts = checkShot({
    dna: ws.draftDna,
    projectType: project.projectType,
    cameraId: null,
    extraPrompt: draft.extraPrompt,
    approvedExceptions: draft.approvedExceptions,
    shotIntent: ws.shotIntent,
  });
  const disabledReason = reason;
  const missingDna = dnaReadiness(ws.persistedDna, project.projectType).filter((r) => !r.done);
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

  /** ADR-042: one spend confirm for every variant, then one ordinary generation each. */
  const runRecipe = async (plans: readonly PlannedVariant[]) => {
    if (!form.provider || !form.model || plans.length === 0) return;
    const images = form.params.outputCount * plans.length;
    const unit = form.params.imageSize ? form.model.priceHint?.[form.params.imageSize] : undefined;
    const total = costHintText(form.model, form.params.imageSize, images);
    if (
      !(await spend.request({
        providerId: form.provider.id,
        provider: form.provider.label,
        model: form.model.label,
        imageCount: images,
        costText: total ? translateDomainMessage(total, t) : null,
        estimatedTotal: unit === undefined ? null : unit * images,
      }))
    )
      return;
    for (const plan of plans) {
      await submit({
        projectId: project.id,
        providerId: form.provider.id,
        modelId: form.model.id,
        purpose: form.purpose,
        referenceAssetIds: form.referenceIds,
        params: form.params,
        cameraId: null,
        extraPrompt: draft.extraPrompt,
        approvedExceptions: draft.approvedExceptions,
        shotIntent: plan.shotIntent,
      });
    }
  };

  const advanced = mode === "advanced";
  return (
    <div className="generate-panel">
      <div className="generate-mode-row">
        <div className="segmented generate-mode" role="group" aria-label={t("generate.modeLabel")}>
          {(["simple", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              data-testid={`generate-mode-${m}`}
              onClick={() => setMode(m)}
            >
              {t(m === "simple" ? "generate.modeSimple" : "generate.modeAdvanced")}
            </button>
          ))}
        </div>
        <HelpPopover topic={t("generate.modeLabel")}>{t("generate.advancedHint")}</HelpPopover>
      </div>
      <ProviderSection form={form} disabled={running} />
      {advanced && <GenerationStepper />}
      <SectionPanel
        title={t("generate.simpleSource")}
        aside={
          <HelpPopover topic={t("generate.simpleSource")}>
            {t("generate.simpleSourceHint")}
          </HelpPopover>
        }
      >
        <SourceFields form={form} disabled={running} />
      </SectionPanel>
      <SectionPanel
        title={t("presets.title")}
        aside={<HelpPopover topic={t("presets.title")}>{t("presets.none")}</HelpPopover>}
      >
        <PresetGrid disabled={running} />
      </SectionPanel>
      <RecipeSection
        disabledReason={disabledReason}
        running={running}
        outputCount={form.params.outputCount}
        onRun={(plans) => void runRecipe(plans)}
      />
      {advanced && <GenerationActions onOpen={setBatchMode} />}
      {advanced && <VisualIntentSelector />}

      {advanced && form.model && (
        <OutputSection
          form={form}
          model={form.model}
          disabled={running}
          hasMaster={!!project.activeMasterAssetId}
          onParams={(params) => setDraft({ params })}
        />
      )}
      {advanced && form.model && (
        <ReferenceSection
          form={form}
          model={form.model}
          disabled={running}
          onChange={(ids) => setDraft({ referenceAssetIds: ids })}
          onReset={() => setDraft({ referenceAssetIds: null })}
        />
      )}

      {advanced && missingDna.length > 0 && (
        <div className="callout callout-warning">
          <AlertTriangle size={14} />
          <div>
            <strong>{t("generate.dnaIncomplete")}</strong>{" "}
            {t("generate.missing", {
              list: missingDna.map((m) => readinessLabel(m, t).toLowerCase()).join(", "),
            })}{" "}
            {t("generate.stillGenerate")}{" "}
            <button className="link-btn" onClick={() => setModule("design_dna")}>
              {t("generate.editDna")}
            </button>
          </div>
        </div>
      )}

      <ExtraPromptSection referenceIds={form.referenceIds} disabled={running} />
      <ConflictPanel
        entries={[{ validation: conflicts }]}
        onFix={fixConflict}
        onApprove={(codes) =>
          setDraft({ approvedExceptions: [...(draft.approvedExceptions ?? []), ...codes] })
        }
      />

      <SectionPanel title={t("generate.compiledPrompt")} defaultOpen={false}>
        <GeneratePromptPreview referenceIds={form.referenceIds} />
      </SectionPanel>

      <GenerationResult />

      <div className="generate-footer">
        {thisRun?.status === "error" && (
          <div className="callout callout-error" role="alert">
            <ErrorMessage
              code={thisRun.code}
              message={translateDomainMessage(thisRun.message, t)}
            />
            {thisRun.needsKeyFor && (
              <button
                className="btn btn-sm"
                onClick={() => openProviderDialog(thisRun.needsKeyFor)}
              >
                <KeyRound size={13} /> {t("generate.setApiKey")}
              </button>
            )}
          </div>
        )}
        {queuedHere > 0 && (
          <span className="field-hint" data-testid="queue-hint">
            {t("generate.queueHint", { count: queuedHere })}
          </span>
        )}
        <button
          className="btn btn-primary generate-btn"
          disabled={disabledReason !== null}
          onClick={() => void generate()}
          data-testid="generate-button"
        >
          <Sparkles size={15} />
          {form.purpose === "hero" ? t("generate.generateHero") : t("generate.generateVariation")}
          {form.params.outputCount > 1 ? ` ×${form.params.outputCount}` : ""}
        </button>
        {cost && (
          <span className="field-hint" data-testid="generate-cost" title={t("generate.costTitle")}>
            {cost}
          </span>
        )}
        {disabledReason && (
          <div data-testid="generate-disabled-reason">
            <span className="field-hint">{disabledReason}</span>
          </div>
        )}
      </div>
      {batchMode && <BatchDialog mode={batchMode} onClose={() => setBatchMode(null)} />}
      {spend.dialog}
    </div>
  );
}

function GenerationActions({ onOpen }: { onOpen: (mode: BatchMode) => void }) {
  const ws = useStudio((s) => s.workspace!);
  const readOnly = useStudio(selectReadOnly);
  const showContactSheet = useStudio((s) => s.showContactSheet);
  const t = useT();
  const facts = {
    masterApproved: isMasterApproved(ws.project.status),
    anchorCameraIds: ws.draftDna.cameras
      .filter((camera) => camera.isAnchorView)
      .map((camera) => camera.id),
    cameraIds: ws.draftDna.cameras.map((camera) => camera.id),
    approvedAnchorCameraIds: ws.anchors.map((anchor) => anchor.cameraId),
  };
  const anchorGate = isGenerationAllowed("anchor", ws.workflow?.steps ?? [], facts);
  const renderGate = isGenerationAllowed("production", ws.workflow?.steps ?? [], facts);
  const reason = (gate: typeof anchorGate) =>
    readOnly
      ? t("camera.reasonArchived")
      : gate.ok
        ? null
        : blockedReason(t, gate.blockedBy, !!ws.project.activeMasterAssetId);
  const anchorReason = reason(anchorGate);
  const renderReason = reason(renderGate);
  const blockedBy = !anchorGate.ok
    ? anchorGate.blockedBy
    : !renderGate.ok
      ? renderGate.blockedBy
      : null;
  const anchorViewsCount = anchorViews(ws.draftDna).length;
  return (
    <SectionPanel title={t("camera.workflow")}>
      <div className="btn-row">
        <button
          className="btn btn-sm btn-primary"
          disabled={anchorReason !== null}
          onClick={() => onOpen("anchor")}
          data-testid="generate-anchors"
        >
          <Anchor size={13} /> {t("camera.generateAnchors")}
        </button>
        <button
          className="btn btn-sm"
          disabled={renderReason !== null}
          onClick={() => onOpen("production")}
          data-testid="render-cameras"
        >
          <Clapperboard size={13} /> {t("camera.renderCameras")}
        </button>
        <button
          className="btn btn-sm"
          disabled={ws.batches.length === 0}
          onClick={() => showContactSheet(null)}
        >
          <LayoutGrid size={13} /> {t("camera.contactSheet")}
        </button>
      </div>
      {(anchorReason ?? renderReason) ? (
        <div data-testid="anchor-disabled-reason">
          <span className="field-hint">{anchorReason ?? renderReason}</span>
          {blockedBy && <BlockedExplainer stepId={blockedBy} />}
        </div>
      ) : anchorViewsCount === 0 ? (
        <span className="field-hint">{t("workflow.steps.generate.anchors.guide")}</span>
      ) : (
        <span className="field-hint">{t("camera.approveHint")}</span>
      )}
    </SectionPanel>
  );
}

function GenerationStepper() {
  const workflow = useStudio((s) => s.workflowView);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const steps = ["generate.master", "generate.anchors", "generate.render"] as const;
  return (
    <div className="workflow-stepper" aria-label={t("workflow.generateLabel")}>
      {steps.map((id) => {
        const step = workflow?.steps.find((item) => item.id === id);
        const status = step?.status ?? "available";
        return (
          <button
            type="button"
            className={`workflow-stepper-item workflow-stepper-${status}`}
            key={id}
            onClick={() => setModule("generate")}
            title={t(`workflow.status.${status}`)}
          >
            <span>
              {t(
                `workflow.steps.${id === "generate.master" ? "generate.master" : id === "generate.anchors" ? "generate.anchors" : "generate.render"}.name`,
              )}
            </span>
            <small>
              {status === "skipped" && (
                <Minus size={12} aria-label={t("workflow.status.skipped")} />
              )}
              {t(`workflow.status.${status}`)}
            </small>
          </button>
        );
      })}
    </div>
  );
}

/** Non-terminal jobs of one project (count is a primitive, so the selector is stable). */
function useQueuedCount(projectId: string): number {
  return useStudio(
    (s) =>
      s.jobs.filter(
        (j) =>
          j.projectId === projectId &&
          (j.status === "queued" || j.status === "running" || j.status === "retrying"),
      ).length,
  );
}

function ProviderSection({ form, disabled }: { form: GenerateForm; disabled: boolean }) {
  const providers = useStudio((s) => s.providers ?? []).filter(isImageProvider);
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const openProviderDialog = useStudio((s) => s.openProviderDialog);
  const provider = form.provider;
  const model = form.model;
  const t = useT();
  const caps = model
    ? [
        [
          model.textToImage ? t("generate.capText") : "",
          model.imageToImage ? t("generate.capRefs", { count: model.maxReferenceImages }) : "",
        ]
          .filter(Boolean)
          .join(" + "),
        t("generate.capOutputs", { count: model.maxOutputs }),
        provider?.kind === "local" ? t("generate.capOffline") : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <SectionPanel
      title={t("generate.provider")}
      aside={
        <button
          className="btn btn-ghost btn-sm btn-icon"
          title={t("generate.providerSettings")}
          aria-label={t("generate.providerSettings")}
          onClick={(e) => {
            e.preventDefault();
            openProviderDialog(provider?.id ?? null);
          }}
        >
          <Settings2 size={14} />
        </button>
      }
    >
      <SelectField
        label={t("generate.provider")}
        allowEmpty={false}
        disabled={disabled}
        value={provider?.id}
        options={providers.map((p) => ({
          value: p.id,
          label: p.configured ? p.label : t("generate.needsKeyOption", { label: p.label }),
        }))}
        // Model/params/references are provider-specific: start from that model's defaults.
        onChange={(id) =>
          setDraft({ providerId: id ?? null, modelId: null, params: null, referenceAssetIds: null })
        }
      />
      {provider && !provider.configured && (
        <button className="btn btn-sm btn-wrap" onClick={() => openProviderDialog(provider.id)}>
          <KeyRound size={13} />{" "}
          {t("generate.setKeyFor", {
            names: provider.label,
          })}
        </button>
      )}
      {provider && (
        <SelectField
          label={t("generate.model")}
          allowEmpty={false}
          disabled={disabled}
          value={model?.id}
          options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
          onChange={(id) =>
            setDraft({ modelId: id ?? null, params: null, referenceAssetIds: null })
          }
        />
      )}
      {model && (
        <span className="field-hint">
          {model.label}: {caps}
        </span>
      )}
    </SectionPanel>
  );
}

function OutputSection({
  form,
  model,
  disabled,
  hasMaster,
  onParams,
}: {
  form: GenerateForm;
  model: ModelCapabilities;
  disabled: boolean;
  hasMaster: boolean;
  onParams: (p: GenerationParams) => void;
}) {
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const p = form.params;
  const counts = Array.from({ length: model.maxOutputs }, (_, i) => i + 1);
  const t = useT();

  return (
    <SectionPanel title={t("generate.output")}>
      <FieldGroup
        label={t("generate.purpose")}
        hint={
          form.purpose === "hero"
            ? hasMaster
              ? t("generate.heroHint")
              : t("generate.heroNoMaster")
            : hasMaster
              ? t("generate.variationHint")
              : t("generate.variationNoMaster")
        }
      >
        <div className="segmented" role="group" aria-label={t("generate.purpose")}>
          {(["hero", "variation"] as const).map((purpose) => (
            <button
              key={purpose}
              type="button"
              aria-pressed={form.purpose === purpose}
              disabled={disabled}
              onClick={() => setDraft({ purpose, source: "dna" })}
            >
              {t(`labels.purpose.${purpose}`)}
            </button>
          ))}
        </div>
      </FieldGroup>
      <div className="field-row">
        {model.aspectRatios.length > 0 && (
          <SelectField
            label={t("generate.aspectRatio")}
            allowEmpty={false}
            disabled={disabled}
            value={p.aspectRatio ?? undefined}
            options={model.aspectRatios.map((r) => ({ value: r, label: r }))}
            onChange={(v) => onParams({ ...p, aspectRatio: v ?? null })}
          />
        )}
        {model.imageSizes.length > 0 && (
          <SelectField
            label={t("generate.imageSize")}
            allowEmpty={false}
            disabled={disabled}
            value={p.imageSize ?? undefined}
            options={model.imageSizes.map((r) => ({ value: r, label: r }))}
            onChange={(v) => onParams({ ...p, imageSize: v ?? null })}
          />
        )}
      </div>
      {model.maxOutputs > 1 && (
        <FieldGroup label={t("generate.imagesPerRun")}>
          <div className="segmented" role="group" aria-label={t("generate.imagesPerRun")}>
            {counts.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={p.outputCount === n}
                disabled={disabled}
                onClick={() => onParams({ ...p, outputCount: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </FieldGroup>
      )}
      <QualityField
        model={model}
        value={p.quality}
        disabled={disabled}
        onChange={(quality) => onParams({ ...p, quality })}
      />
      {model.supportsSeed && (
        <NumberField
          label={t("generate.seed")}
          hint={t("generate.seedHint")}
          disabled={disabled}
          value={p.seed ?? undefined}
          onChange={(v) => onParams({ ...p, seed: v ?? null })}
        />
      )}
      {model.aspectRatios.length === 0 && model.imageSizes.length === 0 && (
        <span className="field-hint">{t("generate.modelChoosesSize", { model: model.label })}</span>
      )}
    </SectionPanel>
  );
}

/**
 * The source of a hero shot: the DNA (with the approved master when there is one) or a
 * structure sketch / viewport. Shown in both panel modes (ADR-039).
 */
function SourceFields({ form, disabled }: { form: GenerateForm; disabled: boolean }) {
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const { busy, duplicate, pickAndImport } = useAssetImport();
  const t = useT();
  return (
    <>
      {form.purpose === "hero" && (
        <FieldGroup label={t("generate.source")}>
          <div className="segmented" role="group" aria-label={t("generate.source")}>
            {(["dna", "sketch"] as const).map((source) => (
              <button
                key={source}
                type="button"
                aria-pressed={form.source === source}
                disabled={disabled}
                onClick={() =>
                  setDraft({
                    source,
                    purpose: "hero",
                    referenceAssetIds: null,
                    params: null,
                  })
                }
              >
                {t(source === "dna" ? "generate.sourceDna" : "generate.sourceSketch")}
              </button>
            ))}
          </div>
        </FieldGroup>
      )}
      {form.source === "sketch" && (
        <FieldGroup label={t("generate.sketchPicker")} hint={t("generate.sketchHowTo")}>
          {form.structureSketches.length > 0 && (
            <ul className="ref-list" aria-label={t("generate.sketchPicker")}>
              {form.structureSketches.map((asset) => (
                <li
                  key={asset.id}
                  className={`ref-row ${asset.id === form.sketch?.id ? "is-checked" : ""}`}
                >
                  <label>
                    <input
                      type="radio"
                      name="structure-sketch"
                      checked={asset.id === form.sketch?.id}
                      disabled={disabled}
                      onChange={() => setDraft({ referenceAssetIds: [asset.id], params: null })}
                    />
                    <span className="ref-thumb">
                      {fileUrl(asset.thumbnailPath) ? (
                        <img
                          src={fileUrl(asset.thumbnailPath)!}
                          alt=""
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <ImageOff size={14} />
                      )}
                    </span>
                    <span className="ref-meta">
                      <span className="ref-name">{asset.originalName ?? asset.id}</span>
                      <RoleBadge role={asset.role} short />
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled || !!busy}
            onClick={() => void pickAndImport("structure_sketch")}
          >
            <ImagePlus size={13} /> {t("generate.importSketch")}
          </button>
          {duplicate && (
            <ConfirmDialog
              title={t("assets.duplicateTitle")}
              message={duplicate.message}
              confirmLabel={t("assets.importAnyway")}
              onConfirm={() => duplicate.resolve(true)}
              onCancel={() => duplicate.resolve(false)}
            />
          )}
        </FieldGroup>
      )}
      <SketchupInbox
        disabled={disabled}
        onImported={(id) =>
          setDraft({ source: "sketch", purpose: "hero", referenceAssetIds: [id], params: null })
        }
      />
    </>
  );
}

function ReferenceSection({
  form,
  model,
  disabled,
  onChange,
  onReset,
}: {
  form: GenerateForm;
  model: ModelCapabilities;
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onReset: () => void;
}) {
  const selected = form.referenceIds;
  const cap = model.imageToImage ? model.maxReferenceImages : 0;
  const atCap = selected.length >= cap;
  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...selected, id] : selected.filter((x) => x !== id));
  const pinned = form.pinnedIds;
  const t = useT();

  return (
    <SectionPanel
      title={t("generate.references")}
      aside={
        <span className={`badge ${selected.length > cap ? "badge-danger" : "badge-neutral"}`}>
          {selected.length} / {cap}
        </span>
      }
    >
      {!model.imageToImage ? (
        <span className="field-hint">{t("generate.noRefsModel", { model: model.label })}</span>
      ) : form.candidates.length === 0 ? (
        <span className="field-hint">{t("generate.noImages")}</span>
      ) : (
        <>
          <ul className="ref-list" aria-label={t("generate.refsLabel")}>
            {form.candidates.map((a) => {
              const index = selected.indexOf(a.id);
              const checked = index >= 0;
              const unavailable = a.status !== "ready";
              return (
                <ReferenceRow
                  key={a.id}
                  asset={a}
                  checked={checked}
                  imageNumber={checked ? index + 1 : null}
                  disabled={disabled || unavailable || pinned.includes(a.id) || (!checked && atCap)}
                  onToggle={(on) => toggle(a.id, on)}
                />
              );
            })}
          </ul>
          {pinned.length > 0 && (
            <span className="field-hint">
              {t(form.source === "sketch" ? "generate.sketchPinned" : "generate.masterPinned")}
            </span>
          )}
          <span className="field-hint">
            {t("generate.refsOrder", { cap, model: model.label })}{" "}
            <button className="link-btn" onClick={onReset} disabled={disabled}>
              <RotateCcw size={11} /> {t("generate.defaultSelection")}
            </button>
          </span>
        </>
      )}
    </SectionPanel>
  );
}

function ReferenceRow({
  asset,
  checked,
  imageNumber,
  disabled,
  onToggle,
}: {
  asset: AssetDTO;
  checked: boolean;
  imageNumber: number | null;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const thumb = fileUrl(asset.thumbnailPath);
  const t = useT();
  return (
    <li className={`ref-row ${checked ? "is-checked" : ""}`}>
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="ref-thumb">
          {thumb && asset.status === "ready" ? (
            <img src={thumb} alt="" loading="lazy" decoding="async" />
          ) : (
            <ImageOff size={14} aria-label={t("assets.fileMissing")} />
          )}
        </span>
        <span className="ref-meta">
          <span className="ref-name" title={asset.originalName ?? asset.id}>
            {imageNumber !== null && (
              <span className="ref-index">{t("generate.imageN", { n: imageNumber })}</span>
            )}
            {asset.originalName ?? asset.id}
          </span>
          <span>
            <RoleBadge role={asset.role} short />
            {asset.status !== "ready" && (
              <span className="badge badge-danger">{t("generate.missingBadge")}</span>
            )}
          </span>
        </span>
      </label>
    </li>
  );
}

const MODE_STORAGE_KEY = "arch.generateMode";
type PanelMode = "simple" | "advanced";

/** Simple / Advanced, remembered on this machine; storage may be unavailable. */
function usePanelMode(): [PanelMode, (mode: PanelMode) => void] {
  const [mode, setModeState] = useState<PanelMode>(() => {
    try {
      return localStorage.getItem(MODE_STORAGE_KEY) === "advanced" ? "advanced" : "simple";
    } catch {
      return "simple";
    }
  });
  const setMode = (next: PanelMode) => {
    setModeState(next);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // A UI preference only: ignore storage that is blocked or full.
    }
  };
  return [mode, setMode];
}
