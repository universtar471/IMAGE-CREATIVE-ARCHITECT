import { ImageOff, ImagePlus, KeyRound, Settings2, Sparkles } from "lucide-react";
import { PresetGrid } from "../presets/PresetGrid";
import { SketchupInbox } from "./SketchupInbox";
import { RecipeSection } from "./RecipeSection";
import { costHintText, type PlannedVariant, isImageProvider } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { RoleBadge } from "../../components/common/StatusBadge";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { LoadingState } from "../../components/common/states";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, SelectField } from "../../components/panels/fields";
import { fileUrl } from "../../lib/files";
import { useT } from "../../i18n";
import { translateDomainMessage } from "../../i18n/domain";
import { ExtraPromptSection } from "./ExtraPromptSection";
import { GeneratePromptPreview } from "./GeneratePromptPreview";
import { GenerationResult } from "./GenerationResult";
import { QualityField } from "./QualityField";
import { generateDisabledReason, resolveGenerateForm, type GenerateForm } from "./form";
import { useAssetImport } from "../assets/useAssetImport";
import { ConfirmDialog } from "../../components/common/Dialog";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { HelpPopover } from "../../components/common/HelpPopover";
import { ConflictPanel, useConflictFix } from "../validation/ConflictPanel";
import { checkShot } from "../validation/gate";

/** Right panel of the Generate module: provider, params, references, prompt, run, result. */
export function GeneratePanel() {
  const allProviders = useStudio((s) => s.providers);
  const providers =
    allProviders && allProviders.filter((p) => isImageProvider(p) && p.id !== "local_upscale");
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

  return (
    <div className="generate-panel">
      <ProviderSection form={form} disabled={running} />
      {form.model && (
        <div className="generation-quality-controls">
          {form.model.imageSizes.length > 0 && (
            <SelectField
              label={t("generate.imageSize")}
              allowEmpty={false}
              disabled={running}
              value={form.params.imageSize ?? undefined}
              options={form.model.imageSizes.map((size) => ({ value: size, label: size }))}
              onChange={(imageSize) =>
                setDraft({ params: { ...form.params, imageSize: imageSize ?? null } })
              }
            />
          )}
          <QualityField
            model={form.model}
            value={form.params.quality}
            disabled={running}
            onChange={(quality) => setDraft({ params: { ...form.params, quality } })}
          />
          {form.model.maxOutputs > 1 && (
            <SelectField
              label={t("generate.imagesPerRun")}
              allowEmpty={false}
              disabled={running}
              value={String(form.params.outputCount)}
              options={Array.from({ length: Math.min(4, form.model.maxOutputs) }, (_, i) => ({
                value: String(i + 1),
                label: String(i + 1),
              }))}
              onChange={(value) =>
                setDraft({ params: { ...form.params, outputCount: Number(value) || 1 } })
              }
            />
          )}
        </div>
      )}
      {form.purpose === "variation" && form.sketch && (
        <div className="variation-source" data-testid="variation-source">
          <img
            src={fileUrl(form.sketch.thumbnailPath ?? form.sketch.absolutePath) ?? undefined}
            alt=""
          />
          <div>
            <strong>{t("generate.generateVariation")}</strong>
            <span className="field-hint">{form.sketch.originalName}</span>
          </div>
        </div>
      )}
      {form.purpose !== "variation" && (
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
      )}
      <SectionPanel
        title={t("presets.title")}
        aside={<HelpPopover topic={t("presets.title")}>{t("presets.none")}</HelpPopover>}
      >
        <PresetGrid disabled={running} variation={form.purpose === "variation"} />
      </SectionPanel>
      {form.purpose !== "variation" && (
        <RecipeSection
          disabledReason={disabledReason}
          running={running}
          outputCount={form.params.outputCount}
          onRun={(plans) => void runRecipe(plans)}
        />
      )}
      {form.purpose === "variation" && (
        <ExtraPromptSection referenceIds={form.referenceIds} disabled={running} />
      )}
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
      {spend.dialog}
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
          setDraft({
            providerId: id ?? null,
            modelId: null,
            params: form.params,
            ...(form.source === "sketch" ? {} : { referenceAssetIds: null }),
          })
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
            setDraft({
              modelId: id ?? null,
              params: form.params,
              ...(form.source === "sketch" ? {} : { referenceAssetIds: null }),
            })
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
      {form.source === "sketch" && (
        <SketchupInbox
          disabled={disabled}
          onImported={(id) =>
            setDraft({ source: "sketch", purpose: "hero", referenceAssetIds: [id], params: null })
          }
        />
      )}
      <ExtraPromptSection referenceIds={form.referenceIds} disabled={disabled} />
    </>
  );
}
