import { Plus, Trash2 } from "lucide-react";
import type { LightingDNA, WeatherDNA } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { FieldGroup, SelectField, TextAreaField, TextField } from "../../components/panels/fields";
import { LockToggle } from "../dna/LockToggle";
import { knowledge } from "../../lib/knowledge";
import { useT } from "../../i18n";

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
type Preset = { id: string; label: string; values?: Record<string, unknown> };

function packPresets(kind: "lightingPresets" | "weatherPresets"): Preset[] {
  const s = useStudio.getState().workspace;
  if (!s) return [];
  const pack = knowledge.resolve(s.project.projectType, s.project.subtype)
    .pack as unknown as Record<string, unknown> | null;
  return ((pack?.[kind] as Preset[] | undefined) ?? []).filter((p) => p && p.id && p.label);
}

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
const LIGHT_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newLightId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(25));
  return `LGT_0${[...bytes].map((value) => LIGHT_ID_ALPHABET[value % LIGHT_ID_ALPHABET.length]).join("")}`;
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
  const presets = packPresets("lightingPresets");
  const weatherPresets = packPresets("weatherPresets");
  const applyPreset = (preset: Preset, kind: "lighting" | "weather") => {
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
        <SelectField
          label={t("lighting.preset")}
          value={lighting.presetId as string | undefined}
          disabled={lightLocked}
          options={presets.map((p) => ({ value: p.id, label: p.label }))}
          onChange={(id) => {
            const p = presets.find((x) => x.id === id);
            if (p) applyPreset(p, "lighting");
          }}
        />
        <SelectField
          label={t("lighting.timeOfDay")}
          value={lighting.timeOfDay as string | undefined}
          disabled={lightLocked}
          options={TIMES.map((v) => ({ value: v, label: t(`lighting.timeOptions.${v}` as never) }))}
          onChange={(v) => setLight("timeOfDay", v)}
        />
        <div className="field-row">
          <TextField
            label={t("lighting.sunDirection")}
            value={lighting.sunDirection as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("sunDirection", v)}
          />
          <TextField
            label={t("lighting.sunElevation")}
            value={lighting.sunElevation as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("sunElevation", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("lighting.intensity")}
            value={lighting.intensity as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("intensity", v)}
          />
          <TextField
            label={t("lighting.ambient")}
            value={lighting.ambientLight as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("ambientLight", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("lighting.shadowLength")}
            value={lighting.shadowLength as string | undefined}
            disabled={lightLocked}
            onChange={(v) => setLight("shadowLength", v)}
          />
          <TextField
            label={t("lighting.shadowSoftness")}
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
                  id: newLightId(),
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
                value={item.type as string | undefined}
                disabled={lightLocked}
                onChange={(v) => updateLight(index, { type: v })}
              />
              <SelectField
                label={t("lighting.zone")}
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
            value={weather.sky}
            disabled={weatherLocked}
            onChange={(v) => setWeather("sky", v)}
          />
          <TextField
            label={t("lighting.humidity")}
            value={weather.humidity}
            disabled={weatherLocked}
            onChange={(v) => setWeather("humidity", v)}
          />
        </div>
        <div className="field-row">
          <TextField
            label={t("lighting.groundWetness")}
            value={weather.groundWetness}
            disabled={weatherLocked}
            onChange={(v) => setWeather("groundWetness", v)}
          />
          <TextField
            label={t("lighting.haze")}
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
