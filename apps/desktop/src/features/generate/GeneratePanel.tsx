import { AlertTriangle, ImageOff, KeyRound, RotateCcw, Settings2, Sparkles } from "lucide-react";
import {
  costHintText,
  dnaReadiness,
  type AssetDTO,
  type GenerationParams,
  type ModelCapabilities,
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

/** Right panel of the Generate module: provider, params, references, prompt, run, result. */
export function GeneratePanel() {
  const providers = useStudio((s) => s.providers);
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
  const queuedHere = useQueuedCount(ws.project.id);
  const t = useT();

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
  const missingDna = dnaReadiness(ws.persistedDna, project.projectType).filter((r) => !r.done);
  const thisRun = run && run.projectId === project.id ? run : null;
  // Estimated price (HHTECH price list): images × tier price; null for unpriced providers.
  const costText = form.model
    ? costHintText(form.model, form.params.imageSize, form.params.outputCount)
    : null;
  const cost = costText ? translateDomainMessage(costText, t) : null;

  const generate = () => {
    if (!form.provider || !form.model) return;
    void submit({
      projectId: project.id,
      providerId: form.provider.id,
      modelId: form.model.id,
      purpose: form.purpose,
      referenceAssetIds: form.referenceIds,
      params: form.params,
      cameraId: null,
      extraPrompt: draft.extraPrompt,
    });
  };

  return (
    <div className="generate-panel">
      <ProviderSection form={form} disabled={running} />
      {form.model && (
        <OutputSection
          form={form}
          model={form.model}
          disabled={running}
          hasMaster={!!project.activeMasterAssetId}
          onParams={(params) => setDraft({ params })}
        />
      )}
      {form.model && (
        <ReferenceSection
          form={form}
          model={form.model}
          disabled={running}
          onChange={(ids) => setDraft({ referenceAssetIds: ids })}
          onReset={() => setDraft({ referenceAssetIds: null })}
        />
      )}

      {missingDna.length > 0 && (
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
          disabled={reason !== null}
          onClick={generate}
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
        {reason && (
          <span className="field-hint" data-testid="generate-disabled-reason">
            {reason}
          </span>
        )}
      </div>
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
  const providers = useStudio((s) => s.providers ?? []);
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
          disabled: !p.configured,
        }))}
        // Model/params/references are provider-specific: start from that model's defaults.
        onChange={(id) =>
          setDraft({ providerId: id ?? null, modelId: null, params: null, referenceAssetIds: null })
        }
      />
      {providers.some((p) => !p.configured) && (
        <button
          className="btn btn-sm"
          onClick={() => openProviderDialog(providers.find((p) => !p.configured)?.id ?? null)}
        >
          <KeyRound size={13} />{" "}
          {t("generate.setKeyFor", {
            names: providers
              .filter((p) => !p.configured)
              .map((p) => p.label)
              .join(", "),
          })}
        </button>
      )}
      {provider && provider.models.length > 1 && (
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
            ? t("generate.heroHint")
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
              onClick={() => setDraft({ purpose })}
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
                  disabled={disabled || unavailable || (!checked && atCap)}
                  onToggle={(on) => toggle(a.id, on)}
                />
              );
            })}
          </ul>
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
