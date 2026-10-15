import type { CSSProperties } from "react";
import { currentLocale, translate } from "../../i18n";
import { LightingPreview } from "./LightingPreview";
import { PhotoThumbnail } from "./PhotoThumbnail";
import { useStudio } from "../../app/store";

const palettes: Record<string, { colors: string[]; tint: string; timeOfDay: string }> = {
  calm: { colors: ["#a7b9a7", "#e0dfc7", "#6a7965"], tint: "#9eb78b44", timeOfDay: "morning" },
  warm: { colors: ["#d69b68", "#f0d7b0", "#92644e"], tint: "#e7974b55", timeOfDay: "golden_hour" },
  cinematic: {
    colors: ["#da9a62", "#547785", "#243c4e"],
    tint: "#637aaf66",
    timeOfDay: "blue_hour",
  },
  fresh: { colors: ["#d7e5cb", "#f4f0d9", "#7a9c9a"], tint: "#d8e5b844", timeOfDay: "afternoon" },
  cool: { colors: ["#7294a8", "#d4e0df", "#3c566d"], tint: "#508acb55", timeOfDay: "blue_hour" },
  night: { colors: ["#425c80", "#9ca6bc", "#212c46"], tint: "#465a9b66", timeOfDay: "night" },
};

export function MoodPreview({
  mood = {},
  compact = false,
}: {
  mood?: Record<string, unknown>;
  compact?: boolean;
}) {
  const presetId = String(mood.presetId ?? "").toLowerCase();
  const description = `${String(mood.warmth ?? "")} ${String(mood.atmosphere ?? "")}`.toLowerCase();
  const themeKey = palettes[presetId]
    ? presetId
    : description.includes("cinematic") ||
        description.includes("dusk") ||
        description.includes("shadow")
      ? "cinematic"
      : description.includes("warm") || description.includes("cozy") || description.includes("gold")
        ? "warm"
        : description.includes("fresh") || description.includes("editorial")
          ? "fresh"
          : description.includes("cool") || description.includes("blue")
            ? "cool"
            : description.includes("night")
              ? "night"
              : "calm";
  const theme = palettes[themeKey]!;
  return (
    <div
      className={`mood-preview${compact ? " mood-preview-compact" : ""}`}
      data-testid="mood-preview"
      data-palette={themeKey}
      style={{ "--mood-tint": theme.tint } as CSSProperties}
    >
      <LightingPreview
        compact={compact}
        lighting={{
          schemaVersion: 1,
          timeOfDay: theme.timeOfDay,
          ambientLight: "balanced",
          artificialLighting: [],
        }}
      />
      <div className="mood-palette" aria-label={translate(currentLocale(), "previews.palette")}>
        {theme.colors.map((color) => (
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
  interior,
}: {
  presets: Array<{ id: string; label: string; values?: Record<string, unknown> }>;
  onChoose?: (preset: { id: string; label: string; values?: Record<string, unknown> }) => void;
  disabled?: boolean;
  interior?: boolean;
}) {
  const isInterior = useStudio((state) => state.workspace?.project.projectType === "interior");
  const interiorPhoto = interior ?? isInterior;
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
            <PhotoThumbnail
              kind="mood"
              presetId={preset.id}
              label={preset.label}
              interior={interiorPhoto}
            >
              <MoodPreview
                mood={{ ...(preset.values ?? {}), presetId: preset.id } as Record<string, unknown>}
                compact
              />
            </PhotoThumbnail>
            <span className="preview-card-large">
              <PhotoThumbnail
                kind="mood"
                presetId={preset.id}
                label={preset.label}
                interior={interiorPhoto}
              >
                <MoodPreview
                  mood={
                    { ...(preset.values ?? {}), presetId: preset.id } as Record<string, unknown>
                  }
                />
              </PhotoThumbnail>
            </span>
          </span>
          <span>{preset.label}</span>
        </button>
      ))}
    </div>
  );
}
