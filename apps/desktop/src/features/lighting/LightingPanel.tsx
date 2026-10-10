import { Plus, Trash2 } from "lucide-react";
import {
  newLightingId,
  type LightingDNA,
  type LightingPreset,
  type ProjectDNA,
  type WeatherDNA,
  type WeatherPreset,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, SelectField, TextAreaField, TextField } from "../../components/panels/fields";
import { LockToggle } from "../dna/LockToggle";
import { knowledge } from "../../lib/knowledge";
import { useT } from "../../i18n";
import { LightingPreview, LightingPresetCards } from "../previews/LightingPreview";

const TIMES = [
  "dawn",
  "morning",
  "midday",
  "afternoon",
  "golden_hour",
  "blue_hour",
  "night",
] as const;
const ZONES = [
  "facade_uplights",
  "interior_glow",
  "landscape",
  "pool",
  "soffit_downlights",
  "signage",
  "street",
] as const;
const defaultLighting: LightingDNA = {
  schemaVersion: 1,
  timeOfDay: "morning",
  sunDirection: "east",
  sunElevation: "35°",
  intensity: "natural",
  shadowLength: "medium",
  shadowSoftness: "soft",
  ambientLight: "balanced",
  artificialLighting: [],
};
const defaultWeather: WeatherDNA = {
  schemaVersion: 1,
  preset: undefined,
  sky: "clear",
  humidity: "medium",
  groundWetness: "dry",
  haze: "low",
  notes: "",
};
export function LightingPanel() {
  const ws = useStudio((s) => s.workspace!);
  const editDna = useStudio((s) => s.editDna);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const lighting = (ws.draftDna.lighting ?? defaultLighting) as LightingDNA &
    Record<string, unknown>;
  const weather = (ws.draftDna.weather ?? defaultWeather) as WeatherDNA;
  const locks = ws.draftDna.locks as unknown as Record<string, boolean>;
  const lightLocked = readOnly || !!locks.lighting;
  const weatherLocked = readOnly || !!locks.weather;
  const setSection = (path: "lighting" | "weather", value: unknown) => editDna(path, value);
  const setLight = (field: string, value: unknown) =>
    setSection("lighting", { ...lighting, [field]: value });
  const setWeather = (field: string, value: unknown) =>
    setSection("weather", { ...weather, [field]: value });
  const presets = knowledge.lightingPresets(ws.project.projectType, ws.project.subtype);
  const weatherPresets = knowledge.weatherPresets(ws.project.projectType, ws.project.subtype);
  if (ws.project.projectType === "interior") return <InteriorLightingPanel />;
  const applyPreset = (preset: LightingPreset | WeatherPreset, kind: "lighting" | "weather") => {
    if (kind === "lighting" && !lightLocked)
      setSection(kind, {
        ...(kind === "lighting" ? lighting : weather),
        ...(preset.values ?? {}),
        presetId: preset.id,
      });
    if (kind === "weather" && !weatherLocked)
      setSection(kind, {
        ...weather,
        ...(preset.values ?? {}),
        presetId: preset.id,
        preset: preset.label,
      });
  };
  const lights =
    ((lighting as Record<string, unknown>).artificialLighting as
      Array<Record<string, unknown>> | undefined) ?? [];
  const updateLight = (index: number, patch: Record<string, unknown>) =>
    setLight(
      "artificialLighting",
      lights.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  return (
    <div data-testid="lighting-panel">
      <SectionPanel title={t("lighting.section")} aside={<LockToggle section="lighting" />}>
        <LightingPreview lighting={lighting} />
        <LightingPresetCards
          presets={presets}
          lighting={lighting}
          disabled={lightLocked}
          onChoose={(preset) => applyPreset(preset, "lighting")}
        />
        <SelectField
          label={t("lighting.timeOfDay")}
          hint={t("lighting.fieldHint")}
          value={lighting.timeOfDay as string | undefined}
          disabled={lightLocked}
          options={TIMES.map((v) => ({ value: v, label: t(`lighting.timeOptions.${v}` as never) }))}
          onChange={(v) => setLight("timeOfDay", v)}
        />
        <div className="field-row">
          <TextField
            label={t("lighting.sunDirection")}
            hint={t("lighting.fieldHint")}
            value={lighting.sunDirection as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("sunDirection", v)}
          />
          <TextField
            label={t("lighting.sunElevation")}
            hint={t("lighting.fieldHint")}
            value={lighting.sunElevation as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("sunElevation", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("lighting.intensity")}
            hint={t("lighting.fieldHint")}
            value={lighting.intensity as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("intensity", v)}
          />
          <TextField
            label={t("lighting.ambient")}
            hint={t("lighting.fieldHint")}
            value={lighting.ambientLight as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("ambientLight", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("lighting.shadowLength")}
            hint={t("lighting.fieldHint")}
            value={lighting.shadowLength as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("shadowLength", v)}
          />
          <TextField
            label={t("lighting.shadowSoftness")}
            hint={t("lighting.fieldHint")}
            value={lighting.shadowSoftness as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("shadowSoftness", v)}
          />
        </div>
      </SectionPanel>
      <SectionPanel
        title={t("lighting.artificial")}
        aside={
          <button
            className="btn btn-ghost btn-sm btn-icon"
            title={t("lighting.addLight")}
            aria-label={t("lighting.addLight")}
            disabled={lightLocked}
            onClick={() =>
              setLight("artificialLighting", [
                ...lights,
                {
                  id: newLightingId(),
                  type: "uplight",
                  enabled: true,
                  zone: "facade_uplights",
                  temperatureK: 3200,
                  intensity: "medium",
                },
              ])
            }
          >
            <Plus size={13} />
          </button>
        }
      >
        {lights.length === 0 && <span className="field-hint">{t("common.none")}</span>}
        {lights.map((item, index) => (
          <div className="lighting-light" key={String(item.id ?? index)}>
            <div className="field-row">
              <TextField
                label={t("lighting.type")}
                hint={t("lighting.fieldHint")}
                value={item.type as string | undefined}
                disabled={lightLocked}
                onChange={(v) => updateLight(index, { type: v })}
              />
              <SelectField
                label={t("lighting.zone")}
                hint={t("lighting.fieldHint")}
                value={item.zone as string | undefined}
                disabled={lightLocked}
                options={ZONES.map((v) => ({ value: v, label: t(`lighting.zones.${v}` as never) }))}
                onChange={(v) => updateLight(index, { zone: v })}
              />
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={item.enabled !== false}
                disabled={lightLocked}
                onChange={(e) => updateLight(index, { enabled: e.target.checked })}
              />
              {t("lighting.enabled")}
            </label>
            <div className="field-row">
              <FieldGroup label={t("lighting.temperature")} hint="2200–6500 K">
                <input
                  className="input"
                  type="range"
                  min="2200"
                  max="6500"
                  step="100"
                  value={Number(item.temperatureK ?? 3200)}
                  disabled={lightLocked}
                  onChange={(e) => updateLight(index, { temperatureK: Number(e.target.value) })}
                />
              </FieldGroup>
              <TextField
                label={t("lighting.intensity")}
                value={item.intensity as string | undefined}
                disabled={lightLocked}
                onChange={(v) => updateLight(index, { intensity: v })}
              />
            </div>
            <button
              className="btn btn-ghost btn-sm"
              disabled={lightLocked}
              onClick={() =>
                setLight(
                  "artificialLighting",
                  lights.filter((_, i) => i !== index),
                )
              }
            >
              <Trash2 size={12} /> {t("lighting.removeLight")}
            </button>
          </div>
        ))}
      </SectionPanel>
      <SectionPanel title={t("lighting.weather")} aside={<LockToggle section="weather" />}>
        <SelectField
          label={t("lighting.preset")}
          value={(weather as WeatherDNA & Record<string, unknown>).presetId as string | undefined}
          disabled={weatherLocked}
          options={weatherPresets.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => {
            const p = weatherPresets.find((x) => x.id === id);
            if (p) applyPreset(p, "weather");
          }}
        />
        <div className="field-row">
          <TextField
            label={t("lighting.sky")}
            hint={t("lighting.fieldHint")}
            value={weather.sky}
            disabled={weatherLocked}
            onChange={(v) => setWeather("sky", v)}
          />
          <TextField
            label={t("lighting.humidity")}
            hint={t("lighting.fieldHint")}
            value={weather.humidity}
            disabled={weatherLocked}
            onChange={(v) => setWeather("humidity", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("lighting.groundWetness")}
            hint={t("lighting.fieldHint")}
            value={weather.groundWetness}
            disabled={weatherLocked}
            onChange={(v) => setWeather("groundWetness", v)}
          />
          <TextField
            label={t("lighting.haze")}
            hint={t("lighting.fieldHint")}
            value={weather.haze}
            disabled={weatherLocked}
            onChange={(v) => setWeather("haze", v)}
          />
        </div>
        <TextAreaField
          label={t("lighting.notes")}
          value={weather.notes ?? ""}
          disabled={weatherLocked}
          onChange={(v) => setWeather("notes", v)}
        />
      </SectionPanel>
    </div>
  );
}

function InteriorLightingPanel() {
  const ws = useStudio((state) => state.workspace!);
  const editDna = useStudio((state) => state.editDna);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const interior = (ws.draftDna as ProjectDNA).interior;
  if (!interior) return <span className="field-hint">{t("interior.legacyLightingHint")}</span>;
  const disabled = readOnly || !!ws.draftDna.locks.lighting;
  const patch = (field: string, value: unknown) => editDna(`interior.${field}`, value);
  const scenes = ["ambient", "task", "accent", "cove", "pendant", "downlight"] as const;
  const times = ["morning", "midday", "afternoon", "golden_hour", "evening", "night"] as const;
  const temperatures = [2700, 3000, 3500, 4000] as const;
  return (
    <div data-testid="interior-lighting-panel">
      <SectionPanel title={t("lighting.section")} aside={<LockToggle section="lighting" />}>
        <SelectField
          label={t("lighting.timeOfDay")}
          value={interior.timeOfDay}
          disabled={disabled}
          options={times.map((value) => ({ value, label: t(`interior.time.${value}`) }))}
          onChange={(value) => patch("timeOfDay", value)}
        />
        <FieldGroup label={t("interior.artificialScenes")}>
          <div className="interior-scene-chips">
            {scenes.map((scene) => (
              <button
                type="button"
                className="chip"
                key={scene}
                aria-pressed={interior.artificialScenes.includes(scene)}
                disabled={disabled}
                onClick={() =>
                  patch(
                    "artificialScenes",
                    interior.artificialScenes.includes(scene)
                      ? interior.artificialScenes.filter((value) => value !== scene)
                      : [...interior.artificialScenes, scene],
                  )
                }
              >
                {t(`interior.scene.${scene}`)}
              </button>
            ))}
          </div>
        </FieldGroup>
        <FieldGroup label={t("interior.colorTemperature")}>
          <div className="segmented" role="group" aria-label={t("interior.colorTemperature")}>
            {temperatures.map((temperature) => (
              <button
                type="button"
                key={temperature}
                aria-pressed={interior.colorTemperatureK === temperature}
                disabled={disabled}
                onClick={() => patch("colorTemperatureK", temperature)}
              >
                {temperature} K
              </button>
            ))}
          </div>
        </FieldGroup>
      </SectionPanel>
    </div>
  );
}
