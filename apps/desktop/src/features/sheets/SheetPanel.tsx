import { useState } from "react";
import { costHintText, defaultGenerationParams, isImageProvider, isVideoAsset } from "@arch/domain";
import { Loader2, Sparkles } from "lucide-react";
import { selectReadOnly, useStudio } from "../../app/store";
import { ImageModelPicker } from "../../components/panels/ImageModelPicker";
import { SelectField, TextAreaField } from "../../components/panels/fields";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { PremiumIcon, type PremiumIconId } from "../../components/common/PremiumIcon";
import { useLocale, useT } from "../../i18n";
import { compileSheetPrompt, SHEET_PRESETS, type SheetKind } from "./sheets";
import { useSheetDraft, useSheetStudio, type SheetDraft } from "./store";
import { fileUrl } from "../../lib/files";
import { usePublishing } from "../publishing/store";

export function SheetModeTabs({ kind }: { kind: SheetKind }) {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const draft = useSheetDraft(projectId, kind);
  const t = useT();
  return (
    <div className="segmented sheet-mode" role="group" aria-label={t("sheet.mode")}>
      {(["ai", "layout"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={draft.mode === mode}
          onClick={() => useSheetStudio.getState().update(projectId, kind, { mode })}
        >
          {t(`sheet.${mode}`)}
        </button>
      ))}
    </div>
  );
}

export function SheetPanel({ kind }: { kind: SheetKind }) {
  const ws = useStudio((s) => s.workspace!);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const choice = useStudio((s) => s.generateDraft);
  const all = useStudio((s) => s.providers);
  const providers = (all ?? [])
    .filter((p) => isImageProvider(p) && p.id !== "local_upscale")
    .map((p) => ({
      ...p,
      models: p.models.filter((m) => m.imageToImage && m.maxReferenceImages > 0),
    }))
    .filter((p) => p.models.length);
  const provider =
    providers.find((p) => p.id === choice.providerId) ??
    providers.find((p) => p.configured) ??
    providers[0];
  const model = provider?.models.find((m) => m.id === choice.modelId) ?? provider?.models[0];
  const readOnly = useStudio(selectReadOnly);
  const run = useStudio((s) => s.run);
  const draft = useSheetDraft(ws.project.id, kind);
  const setDraft = (patch: Partial<SheetDraft>) =>
    useSheetStudio.getState().update(ws.project.id, kind, patch);
  const images = ws.assets.filter((a) => a.status === "ready" && !isVideoAsset(a));
  const source =
    images.find((a) => a.id === draft.sourceId) ??
    images.find((a) => a.id === selectedId) ??
    images[0];
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const spend = useSpendConfirm();
  const [sentHere, setSentHere] = useState(false);
  const presetId = draft.presetId || SHEET_PRESETS[kind][0].id;
  const generation = ws.generations.find((g) => g.id === draft.generationId);
  const busy =
    run?.status === "submitting" ||
    generation?.status === "queued" ||
    generation?.status === "running";
  const prompt = compileSheetPrompt(
    kind,
    presetId,
    draft.note,
    ws.project.name,
    locale === "vi" ? "Vietnamese" : "English",
  );
  const params = model
    ? {
        ...defaultGenerationParams(model, source),
        imageSize:
          draft.imageSize && model.imageSizes.includes(draft.imageSize)
            ? draft.imageSize
            : model.imageSizes.includes("2K")
              ? "2K"
              : (model.imageSizes[0] ?? null),
      }
    : null;
  const create = async () => {
    if (!model || !provider || !source || !params || busy || readOnly) return;
    if (!provider.configured) {
      useStudio.getState().openProviderDialog(provider.id);
      return;
    }
    const price = params.imageSize ? model.priceHint?.[params.imageSize] : undefined;
    if (
      !(await spend.request({
        providerId: provider.id,
        provider: provider.label,
        model: model.label,
        imageCount: 1,
        estimatedTotal: price ?? null,
        costText: costHintText(model, params.imageSize, 1),
      }))
    )
      return;
    setDraft({ sourceId: source.id });
    setSentHere(true);
    const queued = await useStudio.getState().submitGeneration(
      {
        projectId: ws.project.id,
        providerId: provider.id,
        modelId: model.id,
        purpose: "variation",
        referenceAssetIds: [source.id],
        params,
        cameraId: null,
      },
      prompt,
    );
    if (queued) setDraft({ generationId: queued.id });
  };
  return (
    <div className="sheet-panel" data-testid={`${kind}-ai-panel`}>
      <ImageModelPicker
        providers={providers}
        provider={provider}
        model={model}
        disabled={readOnly || busy}
        onProvider={(providerId) =>
          useStudio.getState().setGenerateDraft({ providerId, modelId: null })
        }
        onModel={(modelId) => useStudio.getState().setGenerateDraft({ modelId })}
      />
      <SelectField
        label={t("generate.simpleSource")}
        allowEmpty={false}
        value={source?.id}
        disabled={readOnly || busy}
        options={images.map((a) => ({ value: a.id, label: a.originalName ?? a.id }))}
        onChange={(id) => setDraft({ sourceId: id ?? null })}
      />
      {!!model?.imageSizes.length && (
        <SelectField
          label={t("generate.imageSize")}
          value={params?.imageSize ?? undefined}
          allowEmpty={false}
          disabled={readOnly || busy}
          options={model.imageSizes.map((size) => ({ value: size, label: size }))}
          onChange={(imageSize) => setDraft({ imageSize: imageSize ?? null })}
        />
      )}
      <div className="preset-options" role="group" aria-label={t("sheet.style")}>
        {SHEET_PRESETS[kind].map((preset) => (
          <button
            className="chip premium-preset-card"
            type="button"
            key={preset.id}
            aria-pressed={presetId === preset.id}
            disabled={readOnly || busy}
            onClick={() => setDraft({ presetId: preset.id })}
          >
            <PremiumIcon id={preset.icon as PremiumIconId} size={30} />
            <span>{t(`sheet.presets.${preset.id}`)}</span>
          </button>
        ))}
      </div>
      <TextAreaField
        label={t("sheet.prompt")}
        value={draft.note}
        disabled={readOnly || busy}
        onChange={(note) => setDraft({ note: note.slice(0, 3000) })}
      />
      <button
        className="btn btn-primary"
        type="button"
        disabled={readOnly || busy || !model || !source}
        onClick={() => void create()}
        data-testid={`${kind}-ai-create`}
      >
        {busy ? <Loader2 size={16} className="node-spinner" /> : <Sparkles size={16} />}
        {t(busy ? "sheet.running" : "sheet.create")}
      </button>
      {generation && (
        <p className="field-hint" role="status">
          {t(`labels.generationStatus.${generation.status}`)} · {generation.modelId}
        </p>
      )}
      {generation?.error && (
        <p className="field-error" role="alert">
          {generation.error.message}
        </p>
      )}
      {sentHere && run?.status === "error" && run.projectId === ws.project.id && (
        <p className="field-error" role="alert">
          {run.message}
        </p>
      )}
      <details>
        <summary>{t("generate.compiledPrompt")}</summary>
        <pre className="prompt-text">{prompt.positivePrompt}</pre>
      </details>
      {spend.dialog}
    </div>
  );
}

export function SheetResult({ kind }: { kind: SheetKind }) {
  const ws = useStudio((s) => s.workspace!);
  const draft = useSheetDraft(ws.project.id, kind);
  const t = useT();
  const selected = useStudio((s) => s.selectedAssetId);
  const candidates = ws.generations.filter((g) => g.prompt.metadata.sheetKind === kind);
  const generation = candidates.find((g) => g.id === draft.generationId) ?? candidates[0];
  const result = ws.assets.find((a) => generation?.outputAssetIds.includes(a.id));
  const source = ws.assets.find(
    (a) => a.id === draft.sourceId || (!draft.sourceId && a.id === selected),
  );
  const asset = result ?? source;
  const readOnly = useStudio(selectReadOnly);
  const useInBook = () => {
    if (!result || readOnly) return;
    const pub = usePublishing.getState();
    pub.open(ws.project.id, ws.assets, ws.project.name);
    usePublishing.getState().setSettings({
      selectedImageIds: [result.id],
      selectionMode: "include_all",
      targetPageCount: 1,
    });
    usePublishing.getState().plan(ws.assets);
    const book = usePublishing.getState().publication;
    if (book)
      usePublishing.getState().update({
        ...book,
        pages: book.pages.map((page) => ({
          ...page,
          slots: page.slots.map((slot) =>
            slot.type === "image" ? { ...slot, fit: "contain" as const } : slot,
          ),
        })),
      });
    useSheetStudio.getState().update(ws.project.id, "publishing", { mode: "layout" });
  };
  return (
    <div className="sheet-result" data-testid={`${kind}-ai-result`}>
      {asset ? (
        <img
          src={fileUrl(asset.absolutePath) ?? undefined}
          alt={asset.originalName ?? t("sheet.preview")}
        />
      ) : (
        <p>{t("sheet.chooseSource")}</p>
      )}
      {generation && (
        <p role="status">
          {t(`labels.generationStatus.${generation.status}`)} · {generation.modelId}
        </p>
      )}
      {result && (
        <div className="btn-row">
          <button
            className="btn"
            type="button"
            onClick={() =>
              useStudio
                .getState()
                .openViewer({ assetIds: [result.id], index: 0, compareWithId: null })
            }
          >
            {t("sheet.preview")}
          </button>
          {kind === "publishing" && (
            <button className="btn" type="button" disabled={readOnly} onClick={useInBook}>
              {t("sheet.useInBook")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
