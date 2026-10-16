/**
 * Vector layout of a diagram sheet (ADR-037, SRS §10.3).
 *
 * Every title, caption, label and arrow is SVG text/geometry; images only fill the frames.
 * The palette, fonts and frame geometry are fixed so every panel matches (AC-15). Output is
 * deterministic: the same steps, layout, language and options give the same bytes.
 */
import type {
  DiagramAnnotation,
  DiagramEvidence,
  DiagramLanguage,
  DiagramLayout,
  DiagramStep,
  DiagramType,
} from "./schemas";

/** One panel: header, a 16:9 image frame and a caption block. Never changes per step. */
export const DIAGRAM_PANEL = {
  width: 320,
  height: 292,
  header: 40,
  frame: { x: 0, y: 40, width: 320, height: 180 },
  caption: { y: 232 },
} as const;
/** Kept for callers of the first draft: the image frame size. */
export const DIAGRAM_FRAME_GEOMETRY = {
  width: DIAGRAM_PANEL.frame.width,
  height: DIAGRAM_PANEL.frame.height,
} as const;

const MARGIN = 32;
const GAP = 24;
const SHEET_HEADER = 64;
const SHEET_FOOTER = 44;

export const DIAGRAM_PALETTE = {
  background: "#f6f5f1",
  panel: "#ffffff",
  ink: "#1f2a30",
  muted: "#5f6b72",
  rule: "#d5d2c8",
  accent: "#c0622f",
  veil: "#ffffff",
  placeholder: "#e9e6de",
  verified: "#2f6f55",
  inferred: "#9a6a1c",
  illustrative: "#6b5a8a",
} as const;

const FONT = "'Segoe UI', Arial, 'Helvetica Neue', sans-serif";

/** The label every step that is not verified carries (SRS §10.2). */
export const DIAGRAM_ILLUSTRATIVE_LABEL = {
  vi: "sơ đồ diễn giải ý tưởng",
  en: "illustrative concept diagram",
} as const;

const EVIDENCE_TEXT: Record<DiagramEvidence, { vi: string; en: string }> = {
  verified: { vi: "đã xác minh", en: "verified" },
  inferred: {
    vi: `suy luận · ${DIAGRAM_ILLUSTRATIVE_LABEL.vi}`,
    en: `inferred · ${DIAGRAM_ILLUSTRATIVE_LABEL.en}`,
  },
  illustrative: DIAGRAM_ILLUSTRATIVE_LABEL,
};

export function diagramEvidenceLabel(evidence: DiagramEvidence, lang: DiagramLanguage): string {
  return EVIDENCE_TEXT[evidence][lang];
}

export const DIAGRAM_TYPE_TITLES: Record<DiagramType, { vi: string; en: string }> = {
  concept_evolution: { vi: "Diễn tiến ý tưởng", en: "Concept evolution" },
  massing_voids: { vi: "Khối đặc và khoảng rỗng", en: "Massing and voids" },
  functional_zoning: { vi: "Phân khu công năng", en: "Functional zoning" },
  circulation: { vi: "Giao thông", en: "Circulation" },
  sun_ventilation: { vi: "Nắng và thông gió", en: "Sunlight and ventilation" },
  facade_material: { vi: "Mặt đứng và vật liệu", en: "Facade and materials" },
};

const LEGEND_TEXT = {
  vi: "Chữ, nhãn và mũi tên là vector; ảnh không vẽ chữ.",
  en: "Text, labels and arrows are vector; images carry no text.",
} as const;

export type DiagramSheetOptions = {
  type?: DiagramType;
  /** Shown next to the diagram type in the sheet header (e.g. the project name). */
  title?: string;
  /** The source render (data URL), used in every frame without its own image. */
  sourceHref?: string | null;
  /** Images of generated frames by asset id (data URLs). */
  frameHrefs?: Readonly<Record<string, string>>;
};

export type DiagramRect = { x: number; y: number; width: number; height: number };

export type DiagramSheetGeometry = {
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** Panel rectangles in step order. */
  panels: DiagramRect[];
  /** Image frame rectangles in step order (same size for every step). */
  frames: DiagramRect[];
};

export function diagramGrid(
  layout: DiagramLayout,
  count: number,
): { columns: number; rows: number } {
  const columns =
    layout === "linear" ? Math.max(1, count) : layout === "2x2" ? 2 : layout === "2x3" ? 3 : 4;
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

export function diagramSheetGeometry(layout: DiagramLayout, count: number): DiagramSheetGeometry {
  const { columns, rows } = diagramGrid(layout, count);
  const width = MARGIN * 2 + columns * DIAGRAM_PANEL.width + (columns - 1) * GAP;
  const height =
    MARGIN * 2 + SHEET_HEADER + rows * DIAGRAM_PANEL.height + (rows - 1) * GAP + SHEET_FOOTER;
  const panels: DiagramRect[] = [];
  const frames: DiagramRect[] = [];
  for (let i = 0; i < count; i++) {
    const x = MARGIN + (i % columns) * (DIAGRAM_PANEL.width + GAP);
    const y = MARGIN + SHEET_HEADER + Math.floor(i / columns) * (DIAGRAM_PANEL.height + GAP);
    panels.push({ x, y, width: DIAGRAM_PANEL.width, height: DIAGRAM_PANEL.height });
    frames.push({
      x: x + DIAGRAM_PANEL.frame.x,
      y: y + DIAGRAM_PANEL.frame.y,
      width: DIAGRAM_PANEL.frame.width,
      height: DIAGRAM_PANEL.frame.height,
    });
  }
  return { width, height, columns, rows, panels, frames };
}

// ---------------------------------------------------------------- helpers

const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** Coordinates with at most one decimal, so the bytes never depend on float noise. */
const n = (value: number) => String(Math.round(value * 10) / 10);

/** Greedy word wrap by character budget; the last kept line ends with "…" when cut. */
export function wrapDiagramText(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = `${last.length >= maxChars ? last.slice(0, maxChars - 1) : last}…`;
  return kept;
}

const evidenceColor = (evidence: DiagramEvidence) => DIAGRAM_PALETTE[evidence];

function styles(scale = 1): string {
  const px = (size: number) => `${n(size * scale)}px`;
  return [
    `.d-sheet-title{font:700 ${px(20)} ${FONT};fill:${DIAGRAM_PALETTE.ink}}`,
    `.d-sheet-sub{font:400 ${px(12)} ${FONT};fill:${DIAGRAM_PALETTE.muted}}`,
    `.d-index{font:700 ${px(13)} ${FONT};fill:${DIAGRAM_PALETTE.accent}}`,
    `.d-title{font:600 ${px(13)} ${FONT};fill:${DIAGRAM_PALETTE.ink}}`,
    `.d-caption{font:400 ${px(11)} ${FONT};fill:${DIAGRAM_PALETTE.muted}}`,
    `.d-badge{font:600 ${px(10)} ${FONT};fill:#ffffff}`,
    `.d-label{font:600 ${px(10)} ${FONT};fill:${DIAGRAM_PALETTE.ink}}`,
    `.d-legend{font:400 ${px(11)} ${FONT};fill:${DIAGRAM_PALETTE.muted}}`,
    `.d-arrow{stroke:${DIAGRAM_PALETTE.accent};stroke-width:${n(2 * scale)};fill:none}`,
  ].join("");
}

/** Approximate text width for the badge and label backgrounds (fixed fonts, no measuring). */
const textWidth = (text: string, size: number) => Math.ceil(text.length * size * 0.56);

function badge(
  x: number,
  y: number,
  evidence: DiagramEvidence,
  lang: DiagramLanguage,
  scale = 1,
): string {
  const text = diagramEvidenceLabel(evidence, lang);
  const h = 16 * scale;
  const w = textWidth(text, 10 * scale) + 14 * scale;
  return (
    `<g data-evidence="${evidence}">` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="${evidenceColor(evidence)}"/>` +
    `<text x="${n(x + 7 * scale)}" y="${n(y + 11.5 * scale)}" class="d-badge">${xml(text)}</text></g>`
  );
}

function annotationSvg(
  a: DiagramAnnotation,
  frame: DiagramRect,
  lang: DiagramLanguage,
  marker: string,
  scale = 1,
): string {
  const px = (p: { x: number }) => frame.x + p.x * frame.width;
  const py = (p: { y: number }) => frame.y + p.y * frame.height;
  const chip = (cx: number, cy: number, text: string) => {
    const w = textWidth(text, 10 * scale) + 10 * scale;
    const h = 15 * scale;
    // Keep the chip inside the frame whatever the normalized position.
    const x = Math.min(
      Math.max(cx - w / 2, frame.x + 2 * scale),
      frame.x + frame.width - w - 2 * scale,
    );
    const y = Math.min(
      Math.max(cy - h / 2, frame.y + 2 * scale),
      frame.y + frame.height - h - 2 * scale,
    );
    return (
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(3 * scale)}" fill="${DIAGRAM_PALETTE.panel}" fill-opacity="0.9" stroke="${DIAGRAM_PALETTE.ink}" stroke-width="${n(0.6 * scale)}"/>` +
      `<text x="${n(x + 5 * scale)}" y="${n(y + 11 * scale)}" class="d-label">${xml(text)}</text>`
    );
  };
  if (a.kind === "label")
    return `<g data-annotation="label">${chip(px(a.position), py(a.position), a.label[lang])}</g>`;
  const x1 = px(a.from);
  const y1 = py(a.from);
  const x2 = px(a.to);
  const y2 = py(a.to);
  const text = a.label ? chip((x1 + x2) / 2, (y1 + y2) / 2, a.label[lang]) : "";
  return (
    `<g data-annotation="arrow"><line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="d-arrow" marker-end="url(#${marker})"/>` +
    `${text}</g>`
  );
}

/** The image of a frame: generated frame, else the source render, else a vector placeholder. */
function frameImage(
  step: DiagramStep,
  frame: DiagramRect,
  clipId: string,
  options: DiagramSheetOptions,
): string {
  const href =
    (step.frameAssetId && options.frameHrefs?.[step.frameAssetId]) || options.sourceHref || null;
  const box = `x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.width)}" height="${n(frame.height)}"`;
  if (href) {
    const veil = step.frameAssetId && options.frameHrefs?.[step.frameAssetId] ? "0" : "0.18";
    return (
      `<image ${box} href="${xml(href)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>` +
      `<rect ${box} fill="${DIAGRAM_PALETTE.veil}" fill-opacity="${veil}"/>`
    );
  }
  // A neutral isometric block, the same in every frame (fixed camera stand-in).
  const cx = frame.x + frame.width / 2;
  const base = frame.y + frame.height * 0.78;
  const w = frame.width * 0.22;
  const h = frame.height * 0.36;
  const d = frame.width * 0.12;
  const pts = (list: [number, number][]) => list.map(([x, y]) => `${n(x)},${n(y)}`).join(" ");
  return (
    `<rect ${box} fill="${DIAGRAM_PALETTE.placeholder}"/>` +
    `<polygon points="${pts([
      [cx - w, base - d / 2],
      [cx, base],
      [cx, base - h],
      [cx - w, base - h - d / 2],
    ])}" fill="#ffffff" stroke="${DIAGRAM_PALETTE.ink}" stroke-width="1"/>` +
    `<polygon points="${pts([
      [cx, base],
      [cx + w, base - d / 2],
      [cx + w, base - h - d / 2],
      [cx, base - h],
    ])}" fill="#f1efe9" stroke="${DIAGRAM_PALETTE.ink}" stroke-width="1"/>` +
    `<polygon points="${pts([
      [cx - w, base - h - d / 2],
      [cx, base - h],
      [cx + w, base - h - d / 2],
      [cx, base - h - d],
    ])}" fill="#fbfaf7" stroke="${DIAGRAM_PALETTE.ink}" stroke-width="1"/>`
  );
}

function panelSvg(
  step: DiagramStep,
  index: number,
  panel: DiagramRect,
  frame: DiagramRect,
  lang: DiagramLanguage,
  options: DiagramSheetOptions,
): string {
  const clipId = `d-clip-${index}`;
  const titleLines = wrapDiagramText(step.title[lang], 34, 2);
  const captionLines = wrapDiagramText(step.caption[lang], 50, 3);
  const titleY = panel.y + (titleLines.length > 1 ? 16 : 24);
  const annotations = step.annotations
    .map((a) => annotationSvg(a, frame, lang, "d-arrow-head"))
    .join("");
  return (
    `<g data-step="${xml(step.id)}" data-index="${index}" data-evidence="${step.evidence}">` +
    `<clipPath id="${clipId}"><rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.width)}" height="${n(frame.height)}"/></clipPath>` +
    `<rect x="${n(panel.x)}" y="${n(panel.y)}" width="${n(panel.width)}" height="${n(panel.height)}" fill="${DIAGRAM_PALETTE.panel}" stroke="${DIAGRAM_PALETTE.rule}" stroke-width="1"/>` +
    `<text x="${n(panel.x + 12)}" y="${n(panel.y + 25)}" class="d-index">${String(index + 1).padStart(2, "0")}</text>` +
    `<text class="d-title">${titleLines
      .map(
        (line, i) => `<tspan x="${n(panel.x + 40)}" y="${n(titleY + i * 16)}">${xml(line)}</tspan>`,
      )
      .join("")}</text>` +
    `<g data-frame="${index}" data-frame-x="${n(frame.x - panel.x)}" data-frame-y="${n(frame.y - panel.y)}" data-frame-width="${n(frame.width)}" data-frame-height="${n(frame.height)}">` +
    frameImage(step, frame, clipId, options) +
    `<rect x="${n(frame.x)}" y="${n(frame.y)}" width="${n(frame.width)}" height="${n(frame.height)}" fill="none" stroke="${DIAGRAM_PALETTE.ink}" stroke-width="1"/>` +
    annotations +
    `</g>` +
    `<text class="d-caption">${captionLines
      .map(
        (line, i) =>
          `<tspan x="${n(panel.x + 12)}" y="${n(panel.y + DIAGRAM_PANEL.caption.y + i * 14)}">${xml(line)}</tspan>`,
      )
      .join("")}</text>` +
    badge(panel.x + 12, panel.y + panel.height - 24, step.evidence, lang) +
    `</g>`
  );
}

const arrowMarker = (id: string, scale = 1) =>
  `<marker id="${id}" markerWidth="${n(8 * scale)}" markerHeight="${n(8 * scale)}" refX="${n(7 * scale)}" refY="${n(4 * scale)}" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0 L${n(8 * scale)} ${n(4 * scale)} L0 ${n(8 * scale)} z" fill="${DIAGRAM_PALETTE.accent}"/></marker>`;

export function layoutDiagramSheet(
  steps: readonly DiagramStep[],
  layout: DiagramLayout,
  lang: DiagramLanguage,
  options: DiagramSheetOptions = {},
): string {
  const geometry = diagramSheetGeometry(layout, steps.length);
  const { width, height } = geometry;
  const heading = options.type ? DIAGRAM_TYPE_TITLES[options.type][lang] : "";
  const title = [heading, options.title?.trim()].filter(Boolean).join(" — ");
  const panels = steps
    .map((step, i) => panelSvg(step, i, geometry.panels[i]!, geometry.frames[i]!, lang, options))
    .join("");
  const legendY = height - MARGIN - 14;
  const legend = (["verified", "inferred", "illustrative"] as const)
    .filter((e) => steps.some((s) => s.evidence === e))
    .reduce(
      (acc, evidence) => {
        const w = textWidth(diagramEvidenceLabel(evidence, lang), 10) + 14;
        return { x: acc.x + w + 10, svg: acc.svg + badge(acc.x, legendY - 12, evidence, lang) };
      },
      { x: MARGIN, svg: "" },
    );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title || heading || "diagram")}" data-layout="${layout}" data-lang="${lang}">` +
    `<defs>${arrowMarker("d-arrow-head")}<style>${styles()}</style></defs>` +
    `<rect width="${width}" height="${height}" fill="${DIAGRAM_PALETTE.background}"/>` +
    (title
      ? `<text x="${MARGIN}" y="${MARGIN + 24}" class="d-sheet-title">${xml(title)}</text>`
      : "") +
    `<text x="${MARGIN}" y="${MARGIN + 46}" class="d-sheet-sub">${xml(LEGEND_TEXT[lang])}</text>` +
    panels +
    `<g data-legend="">${legend.svg}</g>` +
    `</svg>`
  );
}

/** Size of one video frame (16:9); rasterized at the export resolution. */
export const DIAGRAM_VIDEO_FRAME = { width: 1600, height: 900 } as const;

/**
 * One step as a full 16:9 frame for the MP4: the same image frame, annotations, title,
 * caption and evidence badge as the sheet, at a fixed larger scale.
 */
export function layoutDiagramFrame(
  step: DiagramStep,
  index: number,
  total: number,
  lang: DiagramLanguage,
  options: DiagramSheetOptions = {},
): string {
  const { width, height } = DIAGRAM_VIDEO_FRAME;
  const s = 2.5;
  const frame: DiagramRect = { x: 0, y: 0, width, height };
  const clipId = "d-clip-frame";
  const titleLines = wrapDiagramText(step.title[lang], 48, 1);
  const captionLines = wrapDiagramText(step.caption[lang], 90, 2);
  const bandH = 150;
  const annotations = step.annotations
    .map((a) => annotationSvg(a, frame, lang, "d-arrow-head", s))
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" data-step="${xml(step.id)}">` +
    `<defs>${arrowMarker("d-arrow-head", s)}<style>${styles(s)}</style><clipPath id="${clipId}"><rect width="${width}" height="${height}"/></clipPath></defs>` +
    `<rect width="${width}" height="${height}" fill="${DIAGRAM_PALETTE.background}"/>` +
    frameImage(step, frame, clipId, options) +
    annotations +
    `<rect x="0" y="0" width="${width}" height="${bandH * 0.62}" fill="${DIAGRAM_PALETTE.panel}" fill-opacity="0.92"/>` +
    `<text x="40" y="62" class="d-index">${String(index + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}</text>` +
    `<text x="190" y="62" class="d-title">${xml(titleLines[0] ?? "")}</text>` +
    `<rect x="0" y="${height - bandH}" width="${width}" height="${bandH}" fill="${DIAGRAM_PALETTE.panel}" fill-opacity="0.92"/>` +
    `<text class="d-caption">${captionLines
      .map((line, i) => `<tspan x="40" y="${height - bandH + 46 + i * 36}">${xml(line)}</tspan>`)
      .join("")}</text>` +
    badge(40, height - 52, step.evidence, lang, s) +
    `</svg>`
  );
}
