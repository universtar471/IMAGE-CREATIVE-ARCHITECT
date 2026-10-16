import { Ban, ChevronDown, ChevronRight, Layers, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AssetDTO,
  BatchDTO,
  JobDTO,
  ModelCapabilities,
  ProviderDescriptorDTO,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { FieldGroup, SelectField } from "../../components/panels/fields";
import { useT } from "../../i18n";
import { JOB_STATUS_TONE } from "../generate/labels";
import {
  DEFAULT_ENHANCE_PARAMS,
  buildEnhanceItems,
  enhanceCost,
  enhanceProviderChoice,
  enhanceSizeFor,
  enhanceTargetEdge,
  failedBatchJobIds,
  retryFailedItems,
  validateEnhanceParams,
  withPreservationMode,
  type EnhanceParams,
  type PreservationMode,
} from "./enhance";
import { LockToggles, PreservationModeSelector, SizeTargetSelector } from "./EnhanceControls";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { ConflictPanel, useConflictFix } from "../validation/ConflictPanel";
import { useBatchGate } from "../validation/useBatchGate";

export function EnhanceBatchDialog({
  sources,
  onClose,
  initialParams,
  initialSelectedIds,
}: {
  sources: readonly AssetDTO[];
  onClose: () => void;
  initialParams?: EnhanceParams;
  initialSelectedIds?: readonly string[];
}) {
  const ws = useStudio((s) => s.workspace!);
  const providers = useStudio((s) => s.providers ?? []);
  const loadProviders = useStudio((s) => s.loadProviders);
  const createBatch = useStudio((s) => s.createBatch);
  const t = useT();
  const spend = useSpendConfirm();
  // Allowed regions belong to one source asset, so a batch never carries them.
  const [params, setParams] = useState<EnhanceParams>(() => {
    const start = { ...(initialParams ?? DEFAULT_ENHANCE_PARAMS) };
    delete start.allowedRegionIds;
    return start;
  });
  const initialMode =
    params.preservationMode ?? (params.mode === "conservative" ? "strict" : "balanced");
  const [providerId, setProviderId] = useState(initialMode === "strict" ? "local_upscale" : "");
  const [modelId, setModelId] = useState(initialMode === "strict" ? "lanczos3" : "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [
    ...(initialSelectedIds ?? sources.map((source) => source.id)),
  ]);

  useEffect(() => {
    if (!providers.length) void loadProviders();
  }, [loadProviders, providers.length]);

  const preservationMode: PreservationMode =
    params.preservationMode ?? (params.mode === "conservative" ? "strict" : "balanced");
  const strict = preservationMode === "strict";
  const local = providers.find((provider) => provider.id === "local_upscale");
  const generativeProviders = providers.filter(
    (provider) =>
      provider.id !== "local_upscale" &&
      provider.models.some((model) => model.imageToImage && model.maxReferenceImages >= 1),
  );
  // Strict never offers a paid provider (ADR-035).
  const availableProviders =
    strict || params.mode === "conservative" ? (local ? [local] : []) : generativeProviders;
  const provider =
    availableProviders.find((item) => item.id === providerId) ?? availableProviders[0] ?? null;
  const models =
    provider?.models.filter((model) =>
      params.mode === "conservative"
        ? model.id === "lanczos3"
        : model.imageToImage && model.maxReferenceImages >= 1,
    ) ?? [];
  const model = models.find((item) => item.id === modelId) ?? models[0] ?? null;
  const availableSources = useMemo(
    () => ws.assets.filter((asset) => asset.status === "ready"),
    [ws.assets],
  );
  const selectedSources = useMemo(
    () => availableSources.filter((source) => selectedIds.includes(source.id)),
    [availableSources, selectedIds],
  );
  const rows = useMemo(
    () =>
      selectedSources.map((source) => {
        const size = enhanceSizeFor(params, source);
        const edge = Math.max(source.widthPx ?? 0, source.heightPx ?? 0);
        // Without a size target the legacy rule applies: never downsize.
        const blocked =
          !params.upscale && params.targetLongEdge !== null && params.targetLongEdge < edge;
        return { source, size, edge, blocked, skip: size?.action === "skip" };
      }),
    [params, selectedSources],
  );
  const runnable = rows.filter((row) => !row.skip);
  const skipped = rows.filter((row) => row.skip);
  const invalidSources = rows.filter((row) => row.blocked);
  const validation = validateEnhanceParams(params);
  const targetEdge = Math.max(
    0,
    ...runnable.map((row) => enhanceTargetEdge(params, row.source) ?? row.edge),
  );
  const cost = enhanceCost(
    params.mode === "conservative" ? (provider?.id ?? providerId) : (provider?.id ?? ""),
    model,
    targetEdge || null,
    runnable.length,
  );
  const costText =
    cost.kind === "free"
      ? t("enhance.batchCostFree", { count: cost.count })
      : cost.kind === "unknown"
        ? t("enhance.batchCostUnknown", { count: cost.count })
        : t("enhance.batchCost", { amount: cost.amount, tier: cost.tier });
  const buildItems = () =>
    buildEnhanceItems({
      sources: selectedSources,
      params,
      providerId: provider!.id,
      model: model!,
      dna: ws.draftDna,
    });
  // Preview of the per-item conflict gate (ADR-034); the store re-runs it on submit.
  const preview = (() => {
    if (!provider || !model || validation || runnable.length < 1) return null;
    try {
      return {
        projectId: ws.project.id,
        providerId: provider.id,
        modelId: model.id,
        purpose: "enhance" as const,
        name: `${t("enhance.batch")} · ${runnable.length}`,
        priority: 0,
        items: buildItems(),
      };
    } catch {
      return null;
    }
  })();
  const conflicts = useBatchGate(preview);
  const fixConflict = useConflictFix(undefined, onClose);
  const disabled =
    (conflicts.gate !== null && !conflicts.gate.request) ||
    selectedSources.length < 2 ||
    runnable.length < 1 ||
    !!validation ||
    invalidSources.length > 0 ||
    !provider ||
    !model ||
    (strict && provider.id !== "local_upscale") ||
    busy;

  const updatePreservationMode = (mode: PreservationMode) => {
    setParams((current) => withPreservationMode(current, mode));
    const choice = enhanceProviderChoice(mode, generativeProviders);
    setProviderId(choice.providerId);
    setModelId(choice.modelId);
  };

  const submit = async () => {
    if (disabled || !provider || !model) return;
    if (strict && provider.id !== "local_upscale") return;
    setBusy(true);
    try {
      const items = buildItems();
      // A paid submit is confirmed first; a known price is shown, else "Chưa xác định chi phí".
      if (
        !(await spend.request({
          providerId: provider.id,
          provider: provider.label,
          model: model.label,
          imageCount: items.length,
          costText: cost.kind === "free" ? null : costText,
          estimatedTotal: cost.kind === "priced" ? cost.amount : null,
        }))
      )
        return;
      const created = await createBatch(
        {
          projectId: ws.project.id,
          providerId: provider.id,
          modelId: model.id,
          purpose: "enhance",
          name: `${t("enhance.batch")} · ${items.length}`,
          priority: 0,
          items,
        },
        { approvedExceptions: conflicts.approvedExceptions },
      );
      if (created) setBatch(created);
    } finally {
      setBusy(false);
    }
  };

  if (batch)
    return (
      <BatchProgress
        batch={batch}
        skipped={skipped.map((row) => row.source)}
        provider={provider}
        model={model}
        unitAmount={cost.kind === "priced" ? cost.unitAmount : null}
        onClose={onClose}
      />
    );

  return (
    <Dialog
      title={t("enhance.batch")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={disabled}
            data-testid="enhance-batch-submit"
            onClick={() => void submit()}
          >
            <Layers size={14} /> {t("enhance.batchSubmit", { count: runnable.length })}
          </button>
        </>
      }
    >
      <div className="enhance-batch-dialog" data-testid="enhance-batch-dialog">
        <p className="field-hint">
          {t("enhance.batchSelected", { count: selectedSources.length })}
        </p>
        <fieldset className="batch-cams">
          <legend className="field-label">{t("enhance.batchAddImages")}</legend>
          {availableSources.map((source) => (
            <label key={source.id} className="toggle-row">
              <input
                type="checkbox"
                checked={selectedIds.includes(source.id)}
                onChange={(event) =>
                  setSelectedIds((current) =>
                    event.target.checked
                      ? [...current, source.id]
                      : current.filter((id) => id !== source.id),
                  )
                }
              />
              {source.originalName ?? source.id}
            </label>
          ))}
        </fieldset>
        <ul
          className="batch-cams"
          aria-label={t("enhance.batchSelected", { count: selectedSources.length })}
        >
          {rows.map(({ source, edge, blocked, skip, size }) => (
            <li key={source.id}>
              <span>{source.originalName ?? source.id}</span>
              <span className="field-hint">
                {source.widthPx ?? "?"} × {source.heightPx ?? "?"} px
                {size && !skip && ` → ${size.canvasWidth} × ${size.canvasHeight} px`}
              </span>
              {skip && <span className="badge badge-neutral">{t("enhance.batchItemSkipped")}</span>}
              {blocked && (
                <span className="badge badge-warning">
                  {t("enhance.batchTargetReason", { edge })}
                </span>
              )}
            </li>
          ))}
        </ul>
        {skipped.length > 0 && (
          <p className="field-hint" role="status">
            {t("enhance.batchSkipped", { count: skipped.length })}
          </p>
        )}
        <Section title={t("enhance.mode")}>
          <PreservationModeSelector value={preservationMode} onChange={updatePreservationMode} />
          <LockToggles params={params} onChange={setParams} />
          <SizeTargetSelector params={params} onChange={setParams} allowKeepSize={!strict} />
          <FieldGroup label={t("enhance.detailStrength")} hint={t("enhance.strengthHint")}>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={params.detailStrength}
              onChange={(event) =>
                setParams({ ...params, detailStrength: Number(event.target.value) })
              }
              aria-label={t("enhance.detailStrength")}
            />
            <span className="field-hint">{params.detailStrength}</span>
          </FieldGroup>
        </Section>
        {!strict && params.mode === "generative" && (
          <Section title={t("enhance.provider")}>
            <div className="field-row">
              <SelectField
                label={t("enhance.provider")}
                allowEmpty={false}
                value={provider?.id}
                options={availableProviders.map((item) => ({ value: item.id, label: item.label }))}
                onChange={(id) => {
                  setProviderId(id ?? "");
                  setModelId("");
                }}
              />
              {provider && (
                <SelectField
                  label={t("enhance.model")}
                  allowEmpty={false}
                  value={model?.id}
                  options={models.map((item) => ({ value: item.id, label: item.label }))}
                  onChange={(id) => setModelId(id ?? "")}
                />
              )}
            </div>
          </Section>
        )}
        <span className="field-hint" data-testid="enhance-batch-cost">
          {costText}
        </span>
        {validation && (
          <div className="callout callout-warning" role="alert">
            {validation}
          </div>
        )}
        {invalidSources.length > 0 && (
          <div className="callout callout-warning" role="alert">
            {t("enhance.batchTargetBlocked")}
          </div>
        )}
        {conflicts.gate && (
          <ConflictPanel
            batch
            entries={conflicts.gate.entries}
            onFix={fixConflict}
            onApprove={conflicts.approve}
          />
        )}
        <button
          type="button"
          className="link-btn"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {previewOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{" "}
          {t("enhance.showPrompt")}
        </button>
        {previewOpen && <p className="field-hint">{t("enhance.batchPromptHint")}</p>}
        {spend.dialog}
      </div>
    </Dialog>
  );
}

/**
 * Per-item status of a queued enhance batch (ADR-035): every item is its own job, a failed
 * item never stops the others, "retry failed" resends only the failed items (no duplicate
 * charge) and a waiting item can be skipped.
 */
function BatchProgress({
  batch,
  skipped,
  provider,
  model,
  unitAmount,
  onClose,
}: {
  batch: BatchDTO;
  skipped: readonly AssetDTO[];
  provider: ProviderDescriptorDTO | null;
  model: ModelCapabilities | null;
  /** Price of one item when known; null shows "Chưa xác định chi phí". */
  unitAmount: number | null;
  onClose: () => void;
}) {
  const t = useT();
  const jobs = useStudio((s) => s.jobs);
  const retryJob = useStudio((s) => s.retryJob);
  const cancelJob = useStudio((s) => s.cancelJob);
  const readOnly = useStudio(selectReadOnly);
  const spend = useSpendConfirm();
  const [busy, setBusy] = useState(false);
  const items = batch.jobIds
    .map((id) => jobs.find((job) => job.id === id))
    .filter((job): job is JobDTO => !!job);
  const failed = failedBatchJobIds(items, batch.id);
  const done = items.filter((job) => job.status === "completed").length;
  const pending = items.filter(
    (job) => !["completed", "failed", "cancelled", "interrupted"].includes(job.status),
  ).length;

  const retry = async () => {
    if (!failed.length || busy) return;
    setBusy(true);
    try {
      if (
        !(await spend.request({
          providerId: provider?.id ?? batch.providerId,
          provider: provider?.label ?? batch.providerId,
          model: model?.label ?? batch.modelId,
          imageCount: failed.length,
          costText:
            unitAmount === null
              ? t("enhance.costUnknown")
              : t("enhance.cost", { amount: unitAmount * failed.length }),
          estimatedTotal: unitAmount === null ? null : unitAmount * failed.length,
        }))
      )
        return;
      await retryFailedItems(items, batch.id, retryJob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("enhance.batchProgress")}
      onClose={onClose}
      footer={
        <>
          <button
            className="btn"
            disabled={readOnly || busy || failed.length === 0}
            data-testid="enhance-batch-retry"
            onClick={() => void retry()}
          >
            <RotateCcw size={13} /> {t("enhance.batchRetryFailed", { count: failed.length })}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            {t("common.close")}
          </button>
        </>
      }
    >
      <div className="enhance-batch-dialog" data-testid="enhance-batch-progress">
        <p className="field-hint" role="status">
          {t("enhance.batchSummary", { done, failed: failed.length, pending })}
        </p>
        <ul className="batch-cams">
          {items.map((job) => (
            <li key={job.id}>
              <span>{job.label}</span>
              <span className={`badge ${JOB_STATUS_TONE[job.status]}`}>
                {t(`labels.jobStatus.${job.status}`)}
              </span>
              {(job.status === "queued" || job.status === "retrying") && (
                <button
                  className="btn btn-sm"
                  disabled={readOnly}
                  title={t("enhance.batchSkipItem")}
                  onClick={() => void cancelJob(job.id)}
                >
                  <Ban size={12} /> {t("enhance.batchItemSkipped")}
                </button>
              )}
            </li>
          ))}
          {skipped.map((source) => (
            <li key={source.id}>
              <span>{source.originalName ?? source.id}</span>
              <span className="badge badge-neutral">{t("enhance.batchItemSkipped")}</span>
            </li>
          ))}
        </ul>
        {spend.dialog}
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section-panel">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export type EnhanceBatchModel = Pick<
  ModelCapabilities,
  "imageToImage" | "maxReferenceImages" | "label"
>;
export type EnhanceBatchProvider = ProviderDescriptorDTO;
