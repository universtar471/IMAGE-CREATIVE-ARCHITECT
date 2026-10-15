import type { KeyboardEvent } from "react";
import type { ColorGradeDNA } from "@arch/domain";
import { SelectField } from "../../components/panels/fields";
import { useT } from "../../i18n";

type SplitTone = NonNullable<ColorGradeDNA["splitTone"]>;
type SplitKey = keyof SplitTone;
type FlatKey =
  | "exposure"
  | "contrast"
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "temperature"
  | "tint"
  | "vibrance"
  | "saturation"
  | "texture"
  | "clarity"
  | "dehaze"
  | "vignette"
  | "grain";

export type SliderSpec =
  | { kind: "flat"; key: FlatKey; min: number; max: number }
  | { kind: "split"; key: SplitKey; min: number; max: number };

const flat = (key: FlatKey, min = -100, max = 100): SliderSpec => ({ kind: "flat", key, min, max });
const split = (key: SplitKey, min: number, max: number): SliderSpec => ({
  kind: "split",
  key,
  min,
  max,
});

/** API §21.3 slider groups. */
export const GRADE_SLIDER_GROUPS = [
  {
    id: "light",
    sliders: [
      flat("exposure"),
      flat("contrast"),
      flat("highlights"),
      flat("shadows"),
      flat("whites"),
      flat("blacks"),
    ],
  },
  {
    id: "color",
    sliders: [flat("temperature"), flat("tint"), flat("vibrance"), flat("saturation")],
  },
  {
    id: "effects",
    sliders: [flat("texture"), flat("clarity"), flat("dehaze"), flat("vignette"), flat("grain", 0)],
  },
  {
    id: "split",
    sliders: [
      split("shadowsHue", 0, 360),
      split("shadowsSat", 0, 100),
      split("highlightsHue", 0, 360),
      split("highlightsSat", 0, 100),
      split("balance", -100, 100),
    ],
  },
] as const;

export const TONE_CURVES = ["none", "soft_s", "strong_s", "faded", "matte"] as const;

/** Fields that are optional in the DNA: neutral means absent, so the v1 fast path returns. */
const OPTIONAL_FLAT = new Set<FlatKey>(["texture", "vignette", "grain"]);
const NEUTRAL_SPLIT: SplitTone = {
  shadowsHue: 0,
  shadowsSat: 0,
  highlightsHue: 0,
  highlightsSat: 0,
  balance: 0,
};

export function sliderValue(grade: ColorGradeDNA, spec: SliderSpec): number {
  if (spec.kind === "split") return Number(grade.splitTone?.[spec.key] ?? 0);
  return Number(grade[spec.key] ?? 0);
}

/**
 * Set one slider. A manual edit clears `look`. Resetting an optional field to neutral
 * removes it, and an all-neutral split tone is removed, so a grade without v2 effects keeps
 * using the TypeScript v1 preview.
 */
export function setSliderValue(grade: ColorGradeDNA, spec: SliderSpec, raw: number): ColorGradeDNA {
  const value = Math.max(spec.min, Math.min(spec.max, Math.round(raw)));
  const next: ColorGradeDNA = { ...grade, look: undefined };
  if (spec.kind === "split") {
    const tone = { ...(grade.splitTone ?? NEUTRAL_SPLIT), [spec.key]: value };
    if (Object.values(tone).every((v) => v === 0)) delete next.splitTone;
    else next.splitTone = tone;
    return next;
  }
  if (OPTIONAL_FLAT.has(spec.key) && value === 0) delete next[spec.key];
  else next[spec.key] = value;
  return next;
}

/** Arrow keys step by 1, Shift+Arrow and PageUp/PageDown by 10, Home/End jump to the ends. */
export function keyboardStep(event: { key: string; shiftKey: boolean }, spec: SliderSpec) {
  const big = 10;
  switch (event.key) {
    case "ArrowUp":
    case "ArrowRight":
      return event.shiftKey ? big : 1;
    case "ArrowDown":
    case "ArrowLeft":
      return event.shiftKey ? -big : -1;
    case "PageUp":
      return big;
    case "PageDown":
      return -big;
    case "Home":
      return -(spec.max - spec.min);
    case "End":
      return spec.max - spec.min;
    default:
      return 0;
  }
}

const fmt = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n));

function GradeSlider({
  spec,
  grade,
  disabled,
  onChange,
}: {
  spec: SliderSpec;
  grade: ColorGradeDNA;
  disabled: boolean;
  onChange: (grade: ColorGradeDNA) => void;
}) {
  const t = useT();
  const value = sliderValue(grade, spec);
  const label = t(`moodGrade.fields.${spec.key}`);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = keyboardStep(event, spec);
    if (!step) return;
    event.preventDefault();
    onChange(setSliderValue(grade, spec, value + step));
  };
  return (
    <div className="grade-slider" data-testid={`grade-slider-${spec.key}`}>
      <div className="grade-slider-head">
        <span className="grade-slider-label">{label}</span>
        <span className="grade-slider-value">{fmt(value)}</span>
      </div>
      <div className="grade-slider-track">
        <span className="grade-slider-range" aria-hidden="true">
          {fmt(spec.min)}
        </span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={1}
          value={value}
          disabled={disabled}
          aria-label={label}
          title={t("moodGrade.sliderResetHint")}
          onChange={(event) => onChange(setSliderValue(grade, spec, Number(event.target.value)))}
          onKeyDown={onKeyDown}
          onDoubleClick={() => onChange(setSliderValue(grade, spec, 0))}
        />
        <span className="grade-slider-range" aria-hidden="true">
          {fmt(spec.max)}
        </span>
      </div>
    </div>
  );
}

/** Grade v2 controls in collapsible groups (Ánh sáng / Màu / Hiệu ứng / Tách tông / Đường cong). */
export function GradeSliders({
  grade,
  disabled,
  onChange,
}: {
  grade: ColorGradeDNA;
  disabled: boolean;
  onChange: (grade: ColorGradeDNA) => void;
}) {
  const t = useT();
  return (
    <div className="grade-sliders" data-testid="grade-sliders">
      {GRADE_SLIDER_GROUPS.map((group) => (
        <details key={group.id} className="grade-group" open={group.id === "light"}>
          <summary>{t(`moodGrade.groups.${group.id}`)}</summary>
          {group.sliders.map((spec) => (
            <GradeSlider
              key={spec.key}
              spec={spec}
              grade={grade}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
        </details>
      ))}
      <details className="grade-group">
        <summary>{t("moodGrade.groups.curve")}</summary>
        <SelectField
          label={t("moodGrade.groups.curve")}
          value={grade.toneCurve ?? "none"}
          allowEmpty={false}
          disabled={disabled}
          options={TONE_CURVES.map((id) => ({ value: id, label: t(`moodGrade.toneCurve.${id}`) }))}
          onChange={(id) => {
            const next: ColorGradeDNA = { ...grade, look: undefined };
            if (!id || id === "none") delete next.toneCurve;
            else next.toneCurve = id as ColorGradeDNA["toneCurve"];
            onChange(next);
          }}
        />
      </details>
    </div>
  );
}
