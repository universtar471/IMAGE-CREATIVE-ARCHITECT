import { useId } from "react";
import type { LightingDNA, LightingPreset } from "@arch/domain";
import { currentLocale, translate, type Locale } from "../../i18n";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { useStudio } from "../../app/store";

const sky: Record<string, [string, string, string]> = {
  dawn: ["#7c5d83", "#efaa88", "#f6d3a2"],
  morning: ["#73b9df", "#d4edfa", "#eff8f9"],
  midday: ["#328dc9", "#a8ddf7", "#e3f5fc"],
  afternoon: ["#5593c2", "#ebbf8f", "#f9e2bc"],
  golden_hour: ["#695276", "#e99359", "#f6c779"],
  blue_hour: ["#182d59", "#536d9b", "#b7b6cb"],
  night: ["#0c1735", "#1b3152", "#43516b"],
};

function sunPosition(direction: string | undefined, elevation: string | undefined) {
  const positions: Record<string, number> = {
    north: 120,
    northeast: 80,
    east: 48,
    southeast: 79,
    south: 120,
    southwest: 160,
    west: 194,
    northwest: 160,
  };
  const x = positions[(direction ?? "east").toLowerCase()] ?? 72;
  const value = Number.parseFloat(elevation ?? "35");
  return { x, y: 74 - Math.max(0, Math.min(80, value)) * 0.53 };
}

export function LightingPreview({
  lighting,
  compact = false,
  locale,
}: {
  lighting: Partial<LightingDNA>;
  compact?: boolean;
  locale?: Locale;
}) {
  const lang = locale ?? currentLocale();
  const uid = useId().replaceAll(":", "");
  const title = translate(lang, "previews.lightingTitle");
  const time = lighting.timeOfDay ?? "morning";
  const colors = sky[time] ?? sky.morning!;
  const sun = sunPosition(lighting.sunDirection, lighting.sunElevation);
  const isNight = time === "night" || time === "blue_hour";
  const temperatureValues = (lighting.artificialLighting ?? [])
    .map((light) => light.temperatureK)
    .filter((value): value is number => typeof value === "number");
  const averageTemperature = temperatureValues.length
    ? temperatureValues.reduce((sum, value) => sum + value, 0) / temperatureValues.length
    : 5000;
  const warmth = Math.max(0, Math.min(0.28, ((6500 - averageTemperature) / 6500) * 0.28));
  const intensity = String(lighting.intensity ?? "natural").toLowerCase();
  const sunOpacity =
    intensity.includes("low") || intensity.includes("soft")
      ? ".65"
      : intensity.includes("high") || intensity.includes("strong")
        ? "1"
        : ".88";
  const shadow =
    lighting.shadowLength === "long" ? 49 : lighting.shadowLength === "short" ? 15 : 31;
  const blur = lighting.shadowSoftness === "hard" ? 0 : lighting.shadowSoftness === "soft" ? 3 : 7;
  const lights = (lighting.artificialLighting ?? []).filter(
    (item) => item.enabled !== false,
  ).length;
  return (
    <svg
      className={`scene-preview${compact ? " scene-preview-compact" : ""}`}
      viewBox="0 0 240 150"
      role="img"
      aria-label={title}
      data-testid="lighting-preview"
      data-time={time}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`lighting-preview-title-${uid}`}>{title}</title>
      <defs>
        <linearGradient id={`lighting-sky-${uid}`} x2="0" y2="1">
          <stop offset="0" stopColor={colors[0]} />
          <stop offset=".65" stopColor={colors[1]} />
          <stop offset="1" stopColor={colors[2]} />
        </linearGradient>
        <filter id={`lighting-shadow-${uid}`}>
          <feGaussianBlur stdDeviation={blur} />
        </filter>
      </defs>
      <rect
        data-testid="preview-sky"
        data-time={time}
        width="240"
        height="150"
        fill={`url(#lighting-sky-${uid})`}
      />
      {isNight ? (
        <g fill="#f7f2d6">
          <circle cx="26" cy="21" r="1.2" />
          <circle cx="56" cy="36" r="1" />
          <circle cx="208" cy="24" r="1.3" />
          <circle cx="183" cy="45" r=".8" />
        </g>
      ) : null}
      <circle
        data-testid="preview-sun"
        cx={sun.x}
        cy={sun.y}
        r={isNight ? 8 : 11}
        fill={isNight ? "#f2edce" : "#ffe7a2"}
        opacity={isNight ? ".9" : sunOpacity}
      />
      <path d="M0 108 Q55 98 108 106 T240 103 V150 H0Z" fill={isNight ? "#243b3c" : "#719576"} />
      <ellipse
        cx={129 + Math.sign(120 - sun.x) * shadow * 0.35}
        cy="127"
        rx={shadow}
        ry="8"
        fill="#172326"
        opacity={lighting.ambientLight === "bright" ? ".2" : ".42"}
        filter={`url(#lighting-shadow-${uid})`}
      />
      <path d="M71 79 124 47 177 79Z" fill="#594e4b" />
      <path d="M78 77h92v57H78z" fill="#e5d8c3" />
      <path d="M111 96h23v38h-23z" fill="#77645b" />
      <rect
        x="88"
        y="88"
        width="15"
        height="16"
        rx="1"
        fill={lights || isNight ? "#ffd788" : "#8fb4c0"}
      />
      <rect
        x="145"
        y="88"
        width="15"
        height="16"
        rx="1"
        fill={lights || isNight ? "#ffd788" : "#8fb4c0"}
      />
      <rect x="0" y="137" width="240" height="13" fill="#a8a18e" />
      <rect x="0" y="137" width="240" height="2" fill="#ddd5c3" />
      <rect
        x="0"
        y="0"
        width="240"
        height="150"
        fill="#ffb45b"
        opacity={warmth}
        pointerEvents="none"
      />
      <rect
        x="0"
        y="0"
        width="240"
        height="150"
        fill="#102640"
        opacity={lighting.ambientLight === "dim" ? ".19" : "0"}
        pointerEvents="none"
      />
    </svg>
  );
}

export function LightingPresetCards({
  presets,
  lighting,
  onChoose,
  disabled = false,
  interior,
}: {
  presets: LightingPreset[];
  lighting: LightingDNA;
  onChoose?: (preset: LightingPreset) => void;
  disabled?: boolean;
  interior?: boolean;
}) {
  const isInterior = useStudio((state) => state.workspace?.project.projectType === "interior");
  const interiorPhoto = interior ?? isInterior;
  const t = (key: "lightingTitle") => translate(currentLocale(), `previews.${key}`);
  return (
    <div className="preview-card-grid" role="group" aria-label={t("lightingTitle")}>
      {presets.map((preset) => {
        const values = { ...lighting, ...(preset.values ?? {}) } as LightingDNA;
        return (
          <button
            type="button"
            className="preview-preset-card"
            key={preset.id}
            onClick={() => onChoose?.(preset)}
            title={preset.label}
            disabled={disabled}
          >
            <span data-testid="lighting-preset-thumbnail" className="preview-card-image">
              <PhotoThumbnail
                kind="lighting"
                presetId={preset.id}
                label={preset.label}
                interior={interiorPhoto}
              >
                <LightingPreview lighting={values} compact />
              </PhotoThumbnail>
              <span className="preview-card-large">
                <PhotoThumbnail
                  kind="lighting"
                  presetId={preset.id}
                  label={preset.label}
                  interior={interiorPhoto}
                >
                  <LightingPreview lighting={values} />
                </PhotoThumbnail>
              </span>
            </span>
            <span>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
