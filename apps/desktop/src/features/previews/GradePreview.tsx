import { useState } from "react";
import type { AssetDTO, ColorGradeDNA } from "@arch/domain";
import { fileUrl } from "../../lib/files";
import { currentLocale, translate } from "../../i18n";
import { LightingPreview } from "./LightingPreview";

function gradeFilter(grade: ColorGradeDNA) {
  const contrast = Math.max(0.55, Math.min(1.65, 1 + Number(grade.contrast ?? 0) / 140));
  const saturation = Math.max(
    0,
    Math.min(2, 1 + Number(grade.saturation ?? 0) / 100 + Number(grade.vibrance ?? 0) / 180),
  );
  const temperature = Number(grade.temperature ?? 0);
  const sepia = Math.max(0, Math.min(0.5, temperature / 300));
  return `brightness(${Math.max(0.7, Math.min(1.3, 1 + Number(grade.exposure ?? 0) / 6))}) contrast(${contrast}) saturate(${saturation}) sepia(${sepia}) hue-rotate(${Number(grade.tint ?? 0) * 0.25}deg)`;
}

export function GradePreview({
  asset,
  grade,
  compact = false,
}: {
  asset: AssetDTO | null;
  grade: ColorGradeDNA;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<"before" | "after" | "split">("after");
  const [split, setSplit] = useState(50);
  const title = translate(currentLocale(), "previews.gradeTitle");
  if (!asset)
    return (
      <div
        className={`grade-preview-fallback${compact ? " grade-preview-compact" : ""}`}
        data-testid="grade-preview-fallback"
      >
        <LightingPreview
          lighting={{ schemaVersion: 1, timeOfDay: "golden_hour", artificialLighting: [] }}
          compact={compact}
        />
      </div>
    );
  const filter = gradeFilter(grade);
  const src =
    fileUrl(compact ? (asset.thumbnailPath ?? asset.absolutePath) : asset.absolutePath) ?? "";
  return (
    <div
      className={`grade-image-preview${compact ? " grade-image-preview-compact" : ""}`}
      data-testid="grade-preview-image"
      data-mode={mode}
      data-asset-id={asset.id}
      role="group"
      aria-label={title}
    >
      {src ? (
        <>
          <img src={src} alt="" className="grade-image-before" />
          <img
            src={src}
            alt=""
            className="grade-image-after"
            style={{
              filter,
              ...(mode === "split" ? { clipPath: `inset(0 ${100 - split}% 0 0)` } : {}),
            }}
          />
          {mode === "split" && (
            <span
              className="grade-image-divider"
              style={{ left: `${split}%` }}
              aria-hidden="true"
            />
          )}
        </>
      ) : (
        <div className="grade-image-loading">
          <LightingPreview
            lighting={{ schemaVersion: 1, timeOfDay: "afternoon", artificialLighting: [] }}
            compact
          />
        </div>
      )}
      <span className="grade-image-label">{title}</span>
      {!compact && (
        <div className="grade-image-toolbar" role="group" aria-label={title}>
          {(["before", "after", "split"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {translate(currentLocale(), `moodGrade.${value}`)}
            </button>
          ))}
          {mode === "split" && (
            <input
              type="range"
              min="0"
              max="100"
              value={split}
              aria-label={translate(currentLocale(), "moodGrade.split")}
              onChange={(event) => setSplit(Number(event.target.value))}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function GradePresetCards({
  presets,
  asset,
}: {
  presets: Array<{ id: string; label: string; grade: ColorGradeDNA }>;
  asset: AssetDTO | null;
}) {
  return (
    <div
      className="preview-card-grid grade-preset-grid"
      role="group"
      aria-label={translate(currentLocale(), "previews.gradeTitle")}
    >
      {presets.map((preset) => (
        <div className="preview-preset-card grade-preset-card" key={preset.id} title={preset.label}>
          <GradePreview asset={asset} grade={preset.grade} compact />
          <span>{preset.label}</span>
        </div>
      ))}
    </div>
  );
}
