import { useId } from "react";
import {
  resolveSiteTopology,
  type ContextDNA,
  type ContextPreset,
  type ProjectType,
} from "@arch/domain";
import { currentLocale, translate } from "../../i18n";

export function ContextPreview({
  context,
  projectType = "villa",
  daylightDirection = "front",
  compact = false,
}: {
  context?: ContextDNA;
  projectType?: ProjectType;
  daylightDirection?: string;
  compact?: boolean;
}) {
  const lang = currentLocale();
  const markerId = useId().replaceAll(":", "");
  if (projectType === "interior") {
    const direction: Record<string, string> = {
      front: "M120 24v35",
      rear: "M120 126V91",
      left: "M30 75h55",
      right: "M210 75h-55",
      diffuse: "M30 34 85 64m70 22 55 30",
      none: "",
    };
    return (
      <svg
        className={`context-preview${compact ? " scene-preview-compact" : ""}`}
        viewBox="0 0 240 150"
        role="img"
        aria-label={translate(lang, "previews.interiorTitle")}
        data-testid="interior-context-preview"
        data-daylight={daylightDirection}
      >
        <title>{translate(lang, "previews.interiorTitle")}</title>
        <rect
          x="18"
          y="18"
          width="204"
          height="114"
          rx="4"
          fill="#e8dfcf"
          stroke="#817967"
          strokeWidth="3"
        />
        <path
          d="M72 19v22m96-22v22M72 41h24m48 0h24"
          fill="none"
          stroke="#83bad1"
          strokeWidth="5"
        />
        <path d="M120 42v77" stroke="#b8aa93" strokeDasharray="3 4" />
        <path
          d={direction[daylightDirection] ?? direction.front}
          stroke="#f2ba4b"
          strokeWidth="4"
          strokeLinecap="round"
          markerEnd={`url(#context-arrow-${markerId})`}
        />
        <defs>
          <marker
            id={`context-arrow-${markerId}`}
            markerWidth="7"
            markerHeight="7"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0 0 6 3 0 6" fill="none" stroke="#f2ba4b" />
          </marker>
        </defs>
        <text x="120" y="145" textAnchor="middle" fill="currentColor" fontSize="9">
          {translate(lang, "previews.daylight")}
        </text>
      </svg>
    );
  }

  const topology = resolveSiteTopology(context);
  const leftX = topology.left === "attached" ? 38 : topology.left === "open" ? 24 : 30;
  const rightX = topology.right === "attached" ? 170 : topology.right === "open" ? 184 : 178;
  const density = context?.density;
  const blockCount =
    density === "very_high" || density === "high"
      ? 5
      : density === "medium"
        ? 3
        : density === "low"
          ? 2
          : 1;
  const roadLabel = context?.front?.roadType || translate(lang, "previews.frontRoad");
  const greenery = Math.min(
    6,
    (context?.front?.vegetation.length ?? 0) + (context?.rear?.vegetation.length ?? 0),
  );
  const rearBlocks = Array.from({ length: blockCount }, (_, index) => index);
  return (
    <svg
      className={`context-preview${compact ? " scene-preview-compact" : ""}`}
      viewBox="0 0 240 170"
      role="img"
      aria-label={translate(lang, "previews.contextTitle")}
      data-testid="context-preview"
      data-left={topology.left}
      data-right={topology.right}
      data-corner-side={topology.cornerLot ? topology.cornerSide : ""}
      data-density={density ?? "medium"}
      data-block-count={blockCount}
    >
      <title>{translate(lang, "previews.contextTitle")}</title>
      <rect x="0" y="0" width="240" height="170" fill="#dce6d3" />
      {rearBlocks.map((i) => (
        <rect
          key={i}
          x={22 + i * 42}
          y="8"
          width="29"
          height="25"
          rx="2"
          fill="#b6c5ac"
          stroke="#91a28d"
        />
      ))}
      <rect
        x="70"
        y="42"
        width="100"
        height="72"
        rx="3"
        fill="#eadab9"
        stroke="#8c7962"
        strokeWidth="2"
      />
      <text x="120" y="80" textAnchor="middle" fontSize="9" fill="#5f5142">
        {translate(lang, "previews.lot")}
      </text>
      <rect
        data-testid="context-neighbor-left"
        x={leftX}
        y="52"
        width="32"
        height="53"
        fill="#99a795"
        stroke="#61715f"
      />
      <rect
        data-testid="context-neighbor-right"
        x={rightX}
        y="52"
        width="32"
        height="53"
        fill="#99a795"
        stroke="#61715f"
      />
      {topology.cornerLot && (
        <path
          d={topology.cornerSide === "left" ? "M0 40h28v74H0z" : "M212 40h28v74h-28z"}
          fill="#a7b8c1"
          data-testid="context-side-street"
        />
      )}
      <rect x="0" y="126" width="240" height="11" fill="#d4ccb8" />
      <rect x="0" y="137" width="240" height="33" fill="#767b7c" />
      <path d="M0 137h240" stroke="#f1eddd" strokeWidth="2" />
      <path d="M0 154h240" stroke="#e6d99a" strokeDasharray="9 8" strokeWidth="1" />
      <text x="120" y="165" textAnchor="middle" fontSize="8" fill="white">
        {roadLabel}
      </text>
      {Array.from({ length: greenery }, (_, i) => (
        <circle key={i} cx={15 + ((i * 37) % 207)} cy={42 + ((i * 13) % 72)} r="4" fill="#52784e" />
      ))}
      <text x="120" y="122" textAnchor="middle" fontSize="7" fill="#6e665b">
        {translate(lang, "previews.rear")}
      </text>
    </svg>
  );
}

export function ContextPresetCards({
  presets,
  context,
  onChoose,
  disabled = false,
}: {
  presets: ContextPreset[];
  context: ContextDNA;
  onChoose: (preset: ContextPreset) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="preview-card-grid"
      role="group"
      aria-label={translate(currentLocale(), "previews.contextTitle")}
    >
      {presets.map((preset) => {
        const merged = { ...context, ...preset.context } as ContextDNA;
        for (const direction of ["front", "rear", "left", "right"] as const) {
          if (preset.context[direction])
            merged[direction] = { ...context[direction], ...preset.context[direction] };
        }
        return (
          <button
            type="button"
            className="preview-preset-card"
            key={preset.id}
            onClick={() => onChoose(preset)}
            title={preset.label}
            disabled={disabled}
          >
            <span data-testid="context-preset-thumbnail" className="preview-card-image">
              <ContextPreview context={merged} compact />
              <span className="preview-card-large">
                <ContextPreview context={merged} />
              </span>
            </span>
            <span>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
