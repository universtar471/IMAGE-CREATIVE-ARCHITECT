import { AlertTriangle, ChevronDown, ChevronRight, Layers } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AssetDTO, ModelCapabilities, ProviderDescriptorDTO } from "@arch/domain";
import { useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { FieldGroup, SelectField } from "../../components/panels/fields";
import { useT } from "../../i18n";
import {
  DEFAULT_ENHANCE_PARAMS,
  ENHANCE_TARGETS,
  buildEnhanceItems,
  enhanceCost,
  sourceLongEdge,
  validateEnhanceParams,
  type EnhanceParams,
} from "./enhance";
import { useSpendConfirm } from "../../components/common/SpendConfirm";

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
  const [params, setParams] = useState<EnhanceParams>(initialParams ?? DEFAULT_ENHANCE_PARAMS);
  const [providerId, setProviderId] = useState("local_upscale");
  const [modelId, setModelId] = useState("lanczos3");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>(() => [
    ...(initialSelectedIds ?? sources.map((source) => source.id)),
  ]);

  useEffect(() => {
    if (!providers.length) void loadProviders();
  }, [loadProviders, providers.length]);

  const local = providers.find((provider) => provider.id === "local_upscale");
  const generativeProviders = providers.filter((provider) =>
    provider.models.some((model) => model.imageToImage && model.maxReferenceImages >= 1),
  );
  const availableProviders =
    params.mode === "conservative" ? (local ? [local] : []) : generativeProviders;
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
  const reasons = useMemo(
    () =>
      selectedSources.map((source) => ({
        source,
        edge: sourceLongEdge(source),
        blocked: params.targetLongEdge !== null && params.targetLongEdge < sourceLongEdge(source),
      })),
    [params.targetLongEdge, selectedSources],
  );
  const invalidSources = reasons.filter((item) => item.blocked);
  const validation = validateEnhanceParams(params);
  const cost = enhanceCost(
    params.mode === "conservative" ? (provider?.id ?? providerId) : (provider?.id ?? ""),
    model,
    params.targetLongEdge,
    selectedSources.length,
  );
  const disabled =
    selectedSources.length < 2 ||
    !!validation ||
    invalidSources.length > 0 ||
    !provider ||
    !model ||
    busy;

  const updateMode = (mode: EnhanceParams["mode"]) => {
    setParams((current) => ({
      ...current,
      mode,
      targetLongEdge:
        mode === "conservative" ? (current.targetLongEdge ?? 2048) : current.targetLongEdge,
    }));
    setProviderId(mode === "conservative" ? "local_upscale" : (generativeProviders[0]?.id ?? ""));
    setModelId(mode === "conservative" ? "lanczos3" : "");
  };

  const submit = async () => {
    if (disabled || !provider || !model) return;
    setBusy(true);
    try {
      const items = buildEnhanceItems({
        sources: selectedSources,
        params,
        providerId: provider.id,
        model,
        dna: ws.draftDna,
      });
      if (
        !(await spend.request({
          providerId: provider.id,
          provider: provider.label,
          model: model.label,
          imageCount: selectedSources.length,
          costText:
            cost.kind === "priced"
              ? t("enhance.batchCost", { amount: cost.amount, tier: cost.tier })
              : null,
          estimatedTotal: cost.kind === "priced" ? cost.amount : null,
        }))
      )
        return;
      await createBatch({
        projectId: ws.project.id,
        providerId: provider.id,
        modelId: model.id,
        purpose: "enhance",
        name: `${t("enhance.batch")} Â· ${selectedSources.length}`,
        priority: 0,
        items,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("enhance.batch")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" disabled={disabled} onClick={() => void submit()}>
            <Layers size={14} /> {t("enhance.batchSubmit", { count: selectedSources.length })}
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
          {reasons.map(({ source, edge, blocked }) => (
            <li key={source.id}>
              <span>{source.originalName ?? source.id}</span>
              <span className="field-hint">
                {source.widthPx ?? "?"} Ã— {source.heightPx ?? "?"} px
              </span>
              {blocked && (
                <span className="badge badge-warning">
                  {t("enhance.batchTargetReason", { edge })}
                </span>
              )}
            </li>
          ))}
        </ul>
        <Section title={t("enhance.mode")}>
          <div className="segmented" role="group" aria-label={t("enhance.mode")}>
            <button
              type="button"
              aria-pressed={params.mode === "conservative"}
              onClick={() => updateMode("conservative")}
            >
              {t("enhance.conservative")}
            </button>
            <button
              type="button"
              aria-pressed={params.mode === "generative"}
              onClick={() => updateMode("generative")}
            >
              {t("enhance.generative")}
            </button>
          </div>
          <FieldGroup label={t("enhance.target")} hint={t("enhance.targetHint")}>
            <div className="segmented">
              {params.mode === "generative" && (
                <button
                  type="button"
                  aria-pressed={params.targetLongEdge === null}
                  onClick={() => setParams({ ...params, targetLongEdge: null })}
                >
                  {t("enhance.keepSize")}
                </button>
              )}
              {ENHANCE_TARGETS.map((target) => {
                const downsize = reasons.some((item) => target < item.edge);
                return (
                  <button
                    key={target}
                    type="button"
                    disabled={downsize}
                    title={downsize ? t("enhance.targetTooSmall") : undefined}
                    aria-pressed={params.targetLongEdge === target}
                    onClick={() => setParams({ ...params, targetLongEdge: target })}
                  >
                    {target}px
                  </button>
                );
              })}
            </div>
          </FieldGroup>
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
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={params.architecturePreserve}
              onChange={(event) =>
                setParams({ ...params, architecturePreserve: event.target.checked })
              }
            />{" "}
            {t("enhance.architecturePreserve")}
          </label>
          {!params.architecturePreserve && (
            <div className="callout callout-warning">
              <AlertTriangle size={14} /> {t("enhance.preserveWarning")}
            </div>
          )}
        </Section>
        {params.mode === "generative" && (
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
          {cost.kind === "free"
            ? t("enhance.batchCostFree", { count: cost.count })
            : cost.kind === "unknown"
              ? t("enhance.batchCostUnknown", { count: cost.count })
              : t("enhance.batchCost", { amount: cost.amount, tier: cost.tier })}
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
