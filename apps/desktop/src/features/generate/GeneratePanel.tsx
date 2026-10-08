import { AlertTriangle, ImageOff, KeyRound, RotateCcw, Settings2, Sparkles } from "lucide-react";
import {
  dnaReadiness,
  type AssetDTO,
  type GenerationParams,
  type ModelCapabilities,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { RoleBadge } from "../../components/common/StatusBadge";
import { LoadingState } from "../../components/common/states";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, NumberField, SelectField } from "../../components/panels/fields";
import { fileUrl } from "../../lib/files";
import { GeneratePromptPreview } from "./GeneratePromptPreview";
import { GenerationResult } from "./GenerationResult";
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

  if (!providers) {
    if (providersError) {
      return (
        <div className="callout callout-error" role="alert">
          <span>Could not load image providers: {providersError}</span>
          <button className="btn btn-sm" onClick={() => void loadProviders()}>
            Try again
          </button>
        </div>
      );
    }
    return <LoadingState label="Loading providers…" />;
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
            <strong>Design DNA is incomplete.</strong> Missing:{" "}
            {missingDna.map((m) => m.label.toLowerCase()).join(", ")}. You can still generate, but
            results follow the DNA less closely.{" "}
            <button className="link-btn" onClick={() => setModule("design_dna")}>
              Edit DNA
            </button>
          </div>
        </div>
      )}

      <SectionPanel title="Compiled prompt" defaultOpen={false}>
        <GeneratePromptPreview referenceIds={form.referenceIds} />
      </SectionPanel>

      <GenerationResult />

      <div className="generate-footer">
        {thisRun?.status === "error" && (
          <div className="callout callout-error" role="alert">
            <span>{thisRun.message}</span>
            {thisRun.needsKeyFor && (
              <button
                className="btn btn-sm"
                onClick={() => openProviderDialog(thisRun.needsKeyFor)}
              >
                <KeyRound size={13} /> Set API key
              </button>
            )}
          </div>
        )}
        {queuedHere > 0 && (
          <span className="field-hint" data-testid="queue-hint">
            {queuedHere} job{queuedHere === 1 ? "" : "s"} of this project in the queue — Generate
            adds another.
          </span>
        )}
        <button
          className="btn btn-primary generate-btn"
          disabled={reason !== null}
          onClick={generate}
          data-testid="generate-button"
        >
          <Sparkles size={15} />
          {form.purpose === "hero" ? "Generate hero" : "Generate variation"}
          {form.params.outputCount > 1 ? ` ×${form.params.outputCount}` : ""}
        </button>
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

  return (
    <SectionPanel
      title="Provider"
      aside={
        <button
          className="btn btn-ghost btn-sm btn-icon"
          title="Provider settings"
          aria-label="Provider settings"
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
        label="Provider"
        allowEmpty={false}
        disabled={disabled}
        value={provider?.id}
        options={providers.map((p) => ({
          value: p.id,
          label: p.configured ? p.label : `${p.label} — set API key`,
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
          <KeyRound size={13} /> Set API key for{" "}
          {providers
            .filter((p) => !p.configured)
            .map((p) => p.label)
            .join(", ")}
        </button>
      )}
      {provider && provider.models.length > 1 && (
        <SelectField
          label="Model"
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
          {model.label}: {model.textToImage ? "text" : ""}
          {model.textToImage && model.imageToImage ? " + " : ""}
          {model.imageToImage ? `up to ${model.maxReferenceImages} reference image(s)` : ""} · up to{" "}
          {model.maxOutputs} output(s) per run
          {provider?.kind === "local" ? " · offline placeholder images" : ""}
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

  return (
    <SectionPanel title="Output">
      <FieldGroup
        label="Purpose"
        hint={
          form.purpose === "hero"
            ? "Hero: the main presentation image, anchored on the master."
            : hasMaster
              ? "Variation: an alternative take for exploration."
              : "Variation: no master yet — set one in References for a hero image."
        }
      >
        <div className="segmented" role="group" aria-label="Purpose">
          {(["hero", "variation"] as const).map((purpose) => (
            <button
              key={purpose}
              type="button"
              aria-pressed={form.purpose === purpose}
              disabled={disabled}
              onClick={() => setDraft({ purpose })}
            >
              {purpose === "hero" ? "Hero" : "Variation"}
            </button>
          ))}
        </div>
      </FieldGroup>
      <div className="field-row">
        {model.aspectRatios.length > 0 && (
          <SelectField
            label="Aspect ratio"
            allowEmpty={false}
            disabled={disabled}
            value={p.aspectRatio ?? undefined}
            options={model.aspectRatios.map((r) => ({ value: r, label: r }))}
            onChange={(v) => onParams({ ...p, aspectRatio: v ?? null })}
          />
        )}
        {model.imageSizes.length > 0 && (
          <SelectField
            label="Image size"
            allowEmpty={false}
            disabled={disabled}
            value={p.imageSize ?? undefined}
            options={model.imageSizes.map((r) => ({ value: r, label: r }))}
            onChange={(v) => onParams({ ...p, imageSize: v ?? null })}
          />
        )}
      </div>
      {model.maxOutputs > 1 && (
        <FieldGroup label="Images per run">
          <div className="segmented" role="group" aria-label="Images per run">
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
      {model.supportsSeed && (
        <NumberField
          label="Seed"
          hint="Empty = random. The same seed and inputs repeat a result."
          disabled={disabled}
          value={p.seed ?? undefined}
          onChange={(v) => onParams({ ...p, seed: v ?? null })}
        />
      )}
      {model.aspectRatios.length === 0 && model.imageSizes.length === 0 && (
        <span className="field-hint">{model.label} chooses the size and aspect ratio itself.</span>
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

  return (
    <SectionPanel
      title="References"
      aside={
        <span className={`badge ${selected.length > cap ? "badge-danger" : "badge-neutral"}`}>
          {selected.length} / {cap}
        </span>
      }
    >
      {!model.imageToImage ? (
        <span className="field-hint">{model.label} does not use reference images.</span>
      ) : form.candidates.length === 0 ? (
        <span className="field-hint">
          No images in this project yet. Import a master or references in the Assets tray.
        </span>
      ) : (
        <>
          <ul className="ref-list" aria-label="Reference images">
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
            Sent in this order — master first, then by role. Up to {cap} for {model.label}.{" "}
            <button className="link-btn" onClick={onReset} disabled={disabled}>
              <RotateCcw size={11} /> Default selection
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
            <ImageOff size={14} aria-label="File missing" />
          )}
        </span>
        <span className="ref-meta">
          <span className="ref-name" title={asset.originalName ?? asset.id}>
            {imageNumber !== null && <span className="ref-index">Image {imageNumber}</span>}
            {asset.originalName ?? asset.id}
          </span>
          <span>
            <RoleBadge role={asset.role} short />
            {asset.status !== "ready" && <span className="badge badge-danger">missing</span>}
          </span>
        </span>
      </label>
    </li>
  );
}
