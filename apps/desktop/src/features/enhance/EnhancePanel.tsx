import { AlertTriangle, ChevronDown, ChevronRight, Layers, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GenerationParams, ModelCapabilities, ProviderDescriptorDTO } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, SelectField } from "../../components/panels/fields";
import { useT } from "../../i18n";
import { isMasterApproved } from "../camera/labels";
import {
  DEFAULT_ENHANCE_PARAMS,
  ENHANCE_TARGETS,
  buildEnhanceItems,
  buildEnhanceRequest,
  enhancePrompt,
  sourceLongEdge,
  validateEnhanceParams,
  type EnhanceParams,
} from "./enhance";

const EMPTY_PARAMS: GenerationParams = {
  aspectRatio: null,
  imageSize: null,
  outputCount: 1,
  seed: null,
  quality: null,
};

export function EnhancePanel() {
  const ws = useStudio((s) => s.workspace!);
  const providers = useStudio((s) => s.providers ?? []);
  const loadProviders = useStudio((s) => s.loadProviders);
  const submit = useStudio((s) => s.submitGeneration);
  const createBatch = useStudio((s) => s.createBatch);
  const readOnly = useStudio(selectReadOnly);
  const selectedId = useStudio((s) => s.selectedAssetId) ?? ws.project.activeMasterAssetId;
  const source =
    ws.assets.find((asset) => asset.id === selectedId && asset.status === "ready") ?? null;
  const [params, setParams] = useState<EnhanceParams>(DEFAULT_ENHANCE_PARAMS);
  const [providerId, setProviderId] = useState("local_upscale");
  const [modelId, setModelId] = useState("lanczos3");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = useT();

  const approved = isMasterApproved(ws.project.status);
  const sourceEdge = source ? sourceLongEdge(source) : 0;
  const validation = validateEnhanceParams(params, sourceEdge);
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
  const prompt = useMemo(() => enhancePrompt(params, ws.draftDna), [params, ws.draftDna]);
  const cost =
    model?.priceHint && params.targetLongEdge
      ? model.priceHint[params.targetLongEdge > 2048 ? "4K" : "2K"]
      : null;
  const disabled = readOnly || !approved || !source || !!validation || !provider || !model || busy;

  useEffect(() => {
    if (!providers.length) void loadProviders();
  }, [loadProviders, providers.length]);

  const updateMode = (mode: EnhanceParams["mode"]) => {
    const next =
      mode === "conservative"
        ? { ...params, mode, targetLongEdge: params.targetLongEdge ?? 2048 }
        : { ...params, mode };
    setParams(next);
    setProviderId(mode === "conservative" ? "local_upscale" : (generativeProviders[0]?.id ?? ""));
    setModelId(mode === "conservative" ? "lanczos3" : "");
  };

  const enhance = async () => {
    if (disabled || !source || !provider || !model) return;
    setBusy(true);
    try {
      const request = buildEnhanceRequest({
        projectId: ws.project.id,
        providerId: provider.id,
        modelId: model.id,
        sourceAssetId: source.id,
        params,
        baseParams: EMPTY_PARAMS,
        dna: ws.draftDna,
      });
      await submit(request, request.prompt);
    } finally {
      setBusy(false);
    }
  };

  const batch = async () => {
    if (!source || !provider || !model || validation) return;
    const items = buildEnhanceItems({
      projectId: ws.project.id,
      assetIds: [source.id],
      params,
      assets: ws.assets,
      baseParams: EMPTY_PARAMS,
      providerId: provider.id,
      model,
      dna: ws.draftDna,
    });
    await createBatch({
      projectId: ws.project.id,
      providerId: provider.id,
      modelId: model.id,
      purpose: "enhance",
      name: `${t("enhance.title")} · ${source.originalName ?? source.id}`,
      priority: 0,
      items,
    });
  };

  return (
    <div className="enhance-panel" data-testid="enhance-panel">
      {!approved && (
        <div className="callout callout-warning" role="status">
          <AlertTriangle size={14} /> {t("enhance.needsMaster")}
        </div>
      )}
      <SectionPanel title={t("enhance.source")}>
        {source ? (
          <div className="enhance-source">
            <strong>{source.originalName ?? source.id}</strong>
            <span className="field-hint">
              {source.widthPx ?? "?"} × {source.heightPx ?? "?"} px
            </span>
          </div>
        ) : (
          <span className="field-hint">{t("enhance.noSource")}</span>
        )}
      </SectionPanel>
      <SectionPanel title={t("enhance.mode")}>
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
              const downsize = target < sourceEdge;
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
          <span className="field-hint">
            {params.detailStrength} ·{" "}
            {params.detailStrength < 34
              ? t("enhance.low")
              : params.detailStrength < 67
                ? t("enhance.medium")
                : t("enhance.high")}
          </span>
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
      </SectionPanel>
      {params.mode === "generative" && (
        <SectionPanel title={t("enhance.provider")}>
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
          {cost !== null && cost !== undefined && (
            <span className="field-hint" data-testid="enhance-cost">
              {t("enhance.cost", { amount: cost })}
            </span>
          )}
        </SectionPanel>
      )}
      <SectionPanel title={t("enhance.promptPreview")} defaultOpen={false}>
        <button
          type="button"
          className="link-btn"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {previewOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{" "}
          {t("enhance.showPrompt")}
        </button>
        {previewOpen && (
          <pre className="enhance-preview">
            {prompt.positivePrompt}
            {prompt.preservationInstructions ? `\n\n${prompt.preservationInstructions}` : ""}
          </pre>
        )}
      </SectionPanel>
      {validation && (
        <div className="callout callout-warning" role="alert">
          {validation}
        </div>
      )}
      <div className="enhance-footer">
        <button
          className="btn btn-primary"
          disabled={disabled}
          onClick={() => void enhance()}
          data-testid="enhance-submit"
        >
          <Wand2 size={14} /> {t("enhance.submit")}
        </button>
        <button
          className="btn"
          disabled={disabled}
          onClick={() => void batch()}
          data-testid="enhance-batch"
        >
          <Layers size={14} /> {t("enhance.batch")}
        </button>
      </div>
    </div>
  );
}

export function enhanceProviderForMode(
  providers: readonly ProviderDescriptorDTO[],
  mode: EnhanceParams["mode"],
): ProviderDescriptorDTO | null {
  return mode === "conservative"
    ? (providers.find((provider) => provider.id === "local_upscale") ?? null)
    : (providers.find((provider) =>
        provider.models.some(
          (model: ModelCapabilities) => model.imageToImage && model.maxReferenceImages > 0,
        ),
      ) ?? null);
}
