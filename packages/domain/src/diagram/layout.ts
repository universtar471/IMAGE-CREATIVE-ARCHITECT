import {
  type DiagramLanguage,
  type DiagramLayout,
  type DiagramStep,
} from "./schemas";

const FRAME = { width: 300, height: 190 } as const;
const GAP_X = 20;
const GAP_Y = 40;
const MARGIN = 20;
const PALETTE = {
  background: "#f7f8f5",
  panel: "#ffffff",
  line: "#263238",
  muted: "#68747d",
  accent: "#bf6b3a",
  verified: "#32745b",
  illustrative: "#8a6b3f",
} as const;

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function gridFor(layout: DiagramLayout, count: number): { columns: number; rows: number } {
  if (layout === "linear") return { columns: count, rows: 1 };
  if (layout === "2x2") return { columns: 2, rows: Math.ceil(count / 2) };
  if (layout === "2x3") return { columns: 3, rows: Math.ceil(count / 3) };
  return { columns: 4, rows: Math.ceil(count / 4) };
}

function wrap(text: string, maxLength = 34): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
}

export function layoutDiagramSheet(
  steps: readonly DiagramStep[],
  layout: DiagramLayout,
  lang: DiagramLanguage,
): string {
  const { columns, rows } = gridFor(layout, steps.length);
  const width = MARGIN * 2 + columns * FRAME.width + (columns - 1) * GAP_X;
  const height = MARGIN * 2 + rows * FRAME.height + (rows - 1) * GAP_Y;
  const markerId = "diagram-arrow";
  const panels = steps
    .map((step, index) => {
      const x = MARGIN + (index % columns) * (FRAME.width + GAP_X);
      const y = MARGIN + Math.floor(index / columns) * (FRAME.height + GAP_Y);
      const title = step.title[lang];
      const caption = step.caption[lang];
      const titleLines = wrap(title, 30);
      const captionLines = wrap(caption, 42);
      const evidenceColor = step.evidence === "verified" ? PALETTE.verified : PALETTE.illustrative;
      const annotationSvg = step.annotations
        .map((annotation) => {
          if (annotation.kind === "label") {
            return `<text x="${x + annotation.position.x * FRAME.width}" y="${y + 54 + annotation.position.y * 55}" class="annotation">${xml(annotation.label[lang])}</text>`;
          }
          const fromX = x + annotation.from.x * FRAME.width;
          const fromY = y + annotation.from.y * FRAME.height;
          const toX = x + annotation.to.x * FRAME.width;
          const toY = y + annotation.to.y * FRAME.height;
          const label = annotation.label ? `<text x="${toX}" y="${toY - 6}" class="annotation">${xml(annotation.label[lang])}</text>` : "";
          return `<line x1="${fromX}" y1="${fromY}" x2="${toX}" y2="${toY}" class="arrow" marker-end="url(#${markerId})"/>${label}`;
        })
        .join("");
      return `<g data-frame="${index}" x="${x}" y="${y}" width="${FRAME.width}" height="${FRAME.height}" data-frame-asset="${xml(step.frameAssetId ?? "")}">
  <rect x="${x}" y="${y}" width="${FRAME.width}" height="${FRAME.height}" rx="4" fill="${PALETTE.panel}" stroke="${PALETTE.line}" stroke-width="1"/>
  <rect x="${x + 1}" y="${y + 1}" width="${FRAME.width - 2}" height="${FRAME.height - 2}" fill="none" stroke="${PALETTE.muted}" stroke-opacity="0.28"/>
  <path d="M ${x + 30} ${y + 137} L ${x + 80} ${y + 105} L ${x + 160} ${y + 132} L ${x + 250} ${y + 92} L ${x + 270} ${y + 140}" fill="none" stroke="${PALETTE.accent}" stroke-width="2"/>
  <path d="M ${x + 60} ${y + 140} L ${x + 60} ${y + 82} L ${x + 165} ${y + 64} L ${x + 242} ${y + 88} L ${x + 242} ${y + 140}" fill="${PALETTE.background}" stroke="${PALETTE.line}" stroke-width="1.5"/>
  ${annotationSvg}
  <text x="${x + 14}" y="${y + 24}" class="step-index">${String(index + 1).padStart(2, "0")}</text>
  <text x="${x + 42}" y="${y + 22}" class="title">${titleLines.map((line, lineIndex) => `<tspan x="${x + 42}" dy="${lineIndex === 0 ? 0 : 15}">${xml(line)}</tspan>`).join("")}</text>
  ${captionLines.map((line, lineIndex) => `<text x="${x + 14}" y="${y + 158 + lineIndex * 11}" class="caption">${xml(line)}</text>`).join("")}
  <circle cx="${x + FRAME.width - 16}" cy="${y + 18}" r="5" fill="${evidenceColor}"/>
</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Architectural diagram sheet">
<defs><marker id="${markerId}" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 z" fill="${PALETTE.accent}"/></marker><style>
  .title { font: 600 12px Arial, sans-serif; fill: ${PALETTE.line}; }
  .caption { font: 10px Arial, sans-serif; fill: ${PALETTE.muted}; }
  .step-index { font: 700 10px Arial, sans-serif; fill: ${PALETTE.accent}; }
  .annotation { font: 9px Arial, sans-serif; fill: ${PALETTE.line}; }
  .arrow { stroke: ${PALETTE.accent}; stroke-width: 1.4; }
</style></defs>
<rect width="${width}" height="${height}" fill="${PALETTE.background}"/>
${panels}
</svg>`;
}

export { FRAME as DIAGRAM_FRAME_GEOMETRY };
