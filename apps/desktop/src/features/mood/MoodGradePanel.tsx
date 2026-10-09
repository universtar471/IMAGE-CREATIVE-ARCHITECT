import { RotateCcw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import {
  defaultGenerationParams,
  type ColorGradeDNA,
  type GenerationParams,
  type WeatherPreset,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { Dialog } from "../../components/common/Dialog";
import { FieldGroup, SelectField, TextAreaField, TextField } from "../../components/panels/fields";
import { LockToggle } from "../dna/LockToggle";
import { knowledge } from "../../lib/knowledge";
import { GRADE_LOOKS, neutralGrade } from "../../lib/grade";
import { adoptMoodPreset, buildMoodVariationItems, type MoodVariationPreset } from "./variation";
import { useT } from "../../i18n";

const SLIDERS = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "temperature",
  "tint",
  "vibrance",
  "saturation",
  "clarity",
  "dehaze",
] as const;
type Preset = MoodVariationPreset;

export function MoodGradePanel() {
  const ws = useStudio((s) => s.workspace!);
  const providers = useStudio((s) => s.providers ?? []);
  const editDna = useStudio((s) => s.editDna);
  const flushDna = useStudio((s) => s.flushDna);
  const applyGrade = useStudio((s) => s.applyGrade);
  const createBatch = useStudio((s) => s.createBatch);
  const selectedAssetId = useStudio((s) => s.selectedAssetId);
  const readOnly = useStudio(selectReadOnly);
  const notify = useStudio((s) => s.notify);
  const t = useT();
  const grade = (ws.draftDna.colorGrade ?? neutralGrade()) as ColorGradeDNA;
  const mood = ws.draftDna.mood ?? { schemaVersion: 1, notes: "" };
  const locks = ws.draftDna.locks as unknown as Record<string, boolean>;
  const gradeLocked = readOnly || !!locks.colorGrade;
  const moodLocked = readOnly || !!locks.mood;
  const moodPresets = useMemo(
    () => knowledge.moodPresets(ws.project.projectType, ws.project.subtype) as Preset[],
    [ws.project.projectType, ws.project.subtype],
  );
  const weatherPresets = useMemo(
    () => knowledge.weatherPresets(ws.project.projectType, ws.project.subtype) as WeatherPreset[],
    [ws.project.projectType, ws.project.subtype],
  );
  const [variationOpen, setVariationOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(() => moodPresets.slice(0, 2).map((p) => p.id));
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState<string | undefined>();
  const [paramsDraft, setParamsDraft] = useState<Partial<GenerationParams>>({});
  const provider =
    providers.find((p) => p.id === providerId) ??
    providers.find((p) => p.configured) ??
    providers[0];
  const model = provider?.models.find((m) => m.id === modelId) ?? provider?.models[0];
  const params: GenerationParams = model
    ? {
        ...defaultGenerationParams(
          model,
          ws.assets.find((a) => a.id === ws.project.activeMasterAssetId) ?? null,
        ),
        ...paramsDraft,
      }
    : { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null };
  const sourceId =
    ws.assets.find((a) => a.id === selectedAssetId)?.id ?? ws.project.activeMasterAssetId ?? "";
  const costHint =
    provider?.id === "hhtech" && model?.priceHint && params.imageSize
      ? `${chosen.length * params.outputCount} × ${model.priceHint[params.imageSize] ?? "?"}đ`
      : provider?.kind === "local"
        ? t("batch.costOffline", { count: chosen.length * params.outputCount })
        : provider
          ? t("batch.costRemote", {
              count: chosen.length * params.outputCount,
              provider: provider.label,
            })
          : "";
  const presetDisabled = (preset: Preset) => {
    const values = (preset.values ?? {}) as Record<string, unknown>;
    const sections = [
      values.lighting ? "lighting" : null,
      values.weather ? "weather" : null,
      values.mood || Object.keys(values).length ? "mood" : null,
    ].filter((section): section is string => !!section);
    return sections.length > 0 && sections.every((section) => !!locks[section]);
  };
  const setMood = (field: string, value: unknown) => editDna("mood", { ...mood, [field]: value });
  const setGrade = (field: string, value: unknown) =>
    editDna("colorGrade", { ...grade, [field]: value });
  const chooseLook = (id: string | undefined) => {
    const looks = GRADE_LOOKS as Record<string, ColorGradeDNA>;
    if (id && looks[id]) editDna("colorGrade", { ...looks[id] });
  };
  const adopt = (preset: Preset) => {
    if (!moodLocked) editDna("mood", adoptMoodPreset(ws.draftDna, preset).mood);
  };
  const queueVariations = async () => {
    if (!model || !sourceId || chosen.length < 2) return;
    try {
      if (!(await flushDna())) return;
      const current = useStudio.getState().workspace!;
      const pack = knowledge.resolve(current.project.projectType, current.project.subtype).pack;
      const selected = moodPresets.filter((p) => chosen.includes(p.id));
      const items = buildMoodVariationItems({
        dna: current.persistedDna,
        project: current.project,
        pack,
        assets: current.assets,
        sourceAssetId: sourceId,
        presets: selected,
        model,
        params,
      });
      await createBatch({
        projectId: current.project.id,
        name: "Mood variations",
        providerId: provider!.id,
        modelId: model.id,
        purpose: "variation",
        priority: 0,
        items,
      });
      setVariationOpen(false);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div data-testid="mood-grade-panel">
      <SectionPanel title={t("moodGrade.mood")} aside={<LockToggle section="mood" />}>
        <SelectField
          label={t("moodGrade.preset")}
          value={mood.preset}
          disabled={moodLocked}
          options={moodPresets.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => {
            const p = moodPresets.find((x) => x.id === id);
            if (p) adopt(p);
          }}
        />
        <div className="field-row">
          <TextField
            label={t("moodGrade.contrast")}
            value={mood.contrast}
            disabled={moodLocked}
            onChange={(v) => setMood("contrast", v)}
          />
          <TextField
            label={t("moodGrade.saturation")}
            value={mood.saturation}
            disabled={moodLocked}
            onChange={(v) => setMood("saturation", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("moodGrade.warmth")}
            value={mood.warmth}
            disabled={moodLocked}
            onChange={(v) => setMood("warmth", v)}
          />
          <TextField
            label={t("moodGrade.atmosphere")}
            value={mood.atmosphere}
            disabled={moodLocked}
            onChange={(v) => setMood("atmosphere", v)}
          />
        </div>
        <TextAreaField
          label={t("lighting.notes")}
          value={mood.notes ?? ""}
          disabled={moodLocked}
          onChange={(v) => setMood("notes", v)}
        />
        {weatherPresets.length > 0 && (
          <SelectField
            label={t("moodGrade.weatherPreset")}
            value={
              (ws.draftDna.weather as Record<string, unknown> | undefined)?.presetId as
                string | undefined
            }
            disabled={!!locks.weather || readOnly}
            options={weatherPresets.map((p) => ({ value: p.id, label: p.label }))}
            onChange={(id) => {
              const p = weatherPresets.find((x) => x.id === id);
              if (p && !locks.weather)
                editDna("weather", {
                  ...ws.draftDna.weather,
                  ...(p.values ?? {}),
                  presetId: p.id,
                  preset: p.label,
                });
            }}
          />
        )}
      </SectionPanel>
      <SectionPanel title={t("moodGrade.grade")} aside={<LockToggle section="colorGrade" />}>
        <SelectField
          label={t("moodGrade.look")}
          value={grade.look}
          disabled={gradeLocked}
          options={Object.keys(GRADE_LOOKS).map((id) => ({
            value: id,
            label: id.replaceAll("_", " "),
          }))}
          onChange={chooseLook}
        />
        {SLIDERS.map((field) => (
          <FieldGroup key={field} label={field[0]!.toUpperCase() + field.slice(1)}>
            <input
              className="input"
              type="range"
              min={field === "exposure" ? -5 : -100}
              max={field === "exposure" ? 5 : 100}
              step={field === "exposure" ? 0.1 : 1}
              value={Number(grade[field] ?? 0)}
              disabled={gradeLocked}
              onChange={(e) => setGrade(field, Number(e.target.value))}
            />
          </FieldGroup>
        ))}
        <div className="btn-row">
          <button
            className="btn btn-ghost btn-sm"
            disabled={gradeLocked}
            onClick={() => editDna("colorGrade", neutralGrade())}
          >
            <RotateCcw size={12} /> {t("moodGrade.reset")}
          </button>
          <button className="btn btn-sm" disabled={gradeLocked} onClick={() => void flushDna()}>
            {t("moodGrade.saveProject")}
          </button>
          <button
            className="btn btn-primary btn-sm"
            disabled={gradeLocked || !sourceId}
            onClick={() => void applyGrade(grade, grade.look ? `Grade · ${grade.look}` : undefined)}
          >
            <Sparkles size={12} /> {t("moodGrade.apply")}
          </button>
        </div>
      </SectionPanel>
      <button
        className="btn btn-sm"
        disabled={readOnly || !sourceId}
        onClick={() => setVariationOpen(true)}
      >
        <Sparkles size={13} /> {t("moodGrade.variations")}
      </button>
      {variationOpen && (
        <Dialog
          title={t("moodGrade.variations")}
          onClose={() => setVariationOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setVariationOpen(false)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                disabled={!model || chosen.length < 2}
                onClick={() => void queueVariations()}
              >
                {t("batch.queue", { count: chosen.length })}
              </button>
            </>
          }
        >
          <p className="field-hint">{t("moodGrade.choosePresets")}</p>
          <p className="field-hint" data-testid="mood-cost-hint">
            {costHint}
          </p>
          <SelectField
            label={t("generate.provider")}
            value={provider?.id}
            options={providers.map((p) => ({
              value: p.id,
              label: p.label,
              disabled: !p.configured,
            }))}
            onChange={(v) => {
              setProviderId(v ?? "");
              setModelId(undefined);
              setParamsDraft({});
            }}
          />
          {provider && (
            <SelectField
              label={t("generate.model")}
              value={model?.id}
              options={provider.models.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => {
                setModelId(v);
                setParamsDraft({});
              }}
            />
          )}
          {model && model.aspectRatios.length > 0 && (
            <SelectField
              label={t("generate.aspectRatio")}
              value={params.aspectRatio ?? undefined}
              options={model.aspectRatios.map((value) => ({ value, label: value }))}
              onChange={(aspectRatio) =>
                setParamsDraft({ ...paramsDraft, aspectRatio: aspectRatio ?? null })
              }
            />
          )}
          {model && model.imageSizes.length > 0 && (
            <SelectField
              label={t("generate.imageSize")}
              value={params.imageSize ?? undefined}
              options={model.imageSizes.map((value) => ({ value, label: value }))}
              onChange={(imageSize) =>
                setParamsDraft({ ...paramsDraft, imageSize: imageSize ?? null })
              }
            />
          )}
          {model && model.qualityOptions.length > 0 && (
            <SelectField
              label={t("generate.quality")}
              value={params.quality ?? undefined}
              options={model.qualityOptions.map((value) => ({
                value,
                label: t(`labels.quality.${value}` as never),
              }))}
              onChange={(quality) => setParamsDraft({ ...paramsDraft, quality: quality ?? null })}
            />
          )}
          {model && model.maxOutputs > 1 && (
            <FieldGroup label={t("generate.imagesPerRun")}>
              <div className="segmented" role="group">
                {Array.from({ length: model.maxOutputs }, (_, index) => index + 1).map((count) => (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={params.outputCount === count}
                    onClick={() => setParamsDraft({ ...paramsDraft, outputCount: count })}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </FieldGroup>
          )}
          <div className="batch-cams">
            {moodPresets.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  checked={chosen.includes(p.id)}
                  disabled={presetDisabled(p) || (chosen.length === 2 && chosen.includes(p.id))}
                  onChange={(e) =>
                    setChosen(
                      e.target.checked
                        ? [...chosen, p.id].slice(0, 8)
                        : chosen.filter((id) => id !== p.id),
                    )
                  }
                />{" "}
                {p.label}
              </label>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
