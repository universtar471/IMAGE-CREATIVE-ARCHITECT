import type { CSSProperties } from "react";
import { currentLocale, translate } from "../../i18n";
import { LightingPreview } from "./LightingPreview";

const palettes: Record<string, string[]> = {
  warm: ["#d69b68", "#f0d7b0", "#92644e"],
  cool: ["#7294a8", "#d4e0df", "#3c566d"],
  calm: ["#a7b9a7", "#e0dfc7", "#6a7965"],
  cinematic: ["#da9a62", "#547785", "#243c4e"],
  default: ["#c1a78d", "#e2d8c8", "#78887c"],
};

export function MoodPreview({
  mood = {},
  compact = false,
}: {
  mood?: Record<string, unknown>;
  compact?: boolean;
}) {
  const warmth = String(mood.warmth ?? mood.atmosphere ?? "").toLowerCase();
  const colors = palettes[warmth] ?? palettes.default!;
  const tint =
    warmth.includes("cool") || warmth.includes("blue")
      ? "#508acb55"
      : warmth.includes("warm") || warmth.includes("gold")
        ? "#e7974b55"
        : "#9eb78b44";
  return (
    <div
      className={`mood-preview${compact ? " mood-preview-compact" : ""}`}
      data-testid="mood-preview"
      style={{ "--mood-tint": tint } as CSSProperties}
    >
      <LightingPreview
        compact={compact}
        lighting={{
          schemaVersion: 1,
          timeOfDay: warmth.includes("night") ? "night" : "golden_hour",
          ambientLight: "balanced",
          artificialLighting: [],
        }}
      />
      <div className="mood-palette" aria-label={translate(currentLocale(), "previews.palette")}>
        {colors.map((color) => (
          <span key={color} style={{ backgroundColor: color }} />
        ))}
      </div>
    </div>
  );
}

export function MoodPresetCards({
  presets,
  onChoose,
  disabled = false,
}: {
  presets: Array<{ id: string; label: string; values?: Record<string, unknown> }>;
  onChoose?: (preset: { id: string; label: string; values?: Record<string, unknown> }) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="preview-card-grid"
      role="group"
      aria-label={translate(currentLocale(), "previews.moodTitle")}
    >
      {presets.map((preset) => (
        <button
          type="button"
          className="preview-preset-card"
          key={preset.id}
          onClick={() => onChoose?.(preset)}
          title={preset.label}
          disabled={disabled}
        >
          <span data-testid="mood-preset-thumbnail" className="preview-card-image">
            <MoodPreview mood={(preset.values ?? {}) as Record<string, unknown>} compact />
            <span className="preview-card-large">
              <MoodPreview mood={(preset.values ?? {}) as Record<string, unknown>} />
            </span>
          </span>
          <span>{preset.label}</span>
        </button>
      ))}
    </div>
  );
}
