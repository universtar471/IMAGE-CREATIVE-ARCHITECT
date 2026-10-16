/**
 * Page rendering for preview and export (SRS §11.5, ADR-038 MVP).
 *
 * `pageDrawOps` turns a page into drawing operations in output pixels: background, image
 * frames (cover crop or contain, from the pinned source file) and wrapped text in the
 * book's style. `drawPage` replays them on a canvas. The source images are only read
 * (through the tainted-canvas-safe `asset_preview` bridge) and never regenerated.
 */
import {
  PAPER_DIMENSIONS_PT,
  resolvePublicationStyle,
  type NormalizedRect,
  type Page,
  type PaperSize,
  type Publication,
  type PublicationStyle,
} from "@arch/domain";

/** Print papers render at 150 dpi (the validator's minimum PPI); 16:9 at 1920 × 1080. */
export const EXPORT_DPI: Record<PaperSize, number> = { A4: 150, A3: 150, "16:9": 144 };

export function exportPixelSize(paper: PaperSize, scale = 1): { width: number; height: number } {
  const { width, height } = PAPER_DIMENSIONS_PT[paper];
  const factor = (EXPORT_DPI[paper] / 72) * scale;
  return { width: Math.round(width * factor), height: Math.round(height * factor) };
}

export type Box = { x: number; y: number; w: number; h: number };

export type DrawOp =
  | { kind: "fill"; color: string; box: Box }
  | { kind: "image"; assetId: string; box: Box; fit: "cover" | "contain"; background: string }
  | { kind: "rule"; color: string; box: Box }
  | {
      kind: "text";
      lines: string[];
      box: Box;
      fontPx: number;
      font: string;
      color: string;
      lineHeightPx: number;
      align: "left" | "center";
    };

/** Width of `text` in pixels at `font` (canvas `measureText` in the app). */
export type Measure = (text: string, font: string) => number;

const toBox = (rect: NormalizedRect, size: { width: number; height: number }): Box => ({
  x: rect.x * size.width,
  y: rect.y * size.height,
  w: rect.w * size.width,
  h: rect.h * size.height,
});

const fontStack = (families: readonly string[]) =>
  families.map((family) => (/\s/.test(family) ? `"${family}"` : family)).join(", ");

/** Greedy word wrap; a word longer than the line is broken by characters. */
export function wrapText(text: string, maxWidth: number, font: string, measure: Measure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      let rest = word;
      while (measure(rest, font) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && measure(rest.slice(0, cut), font) > maxWidth) cut -= 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function textOp(
  text: string,
  box: Box,
  fontPt: number,
  pxPerPt: number,
  families: readonly string[],
  weight: number,
  color: string,
  align: "left" | "center",
  measure: Measure,
): DrawOp | null {
  if (!text.trim()) return null;
  const fontPx = fontPt * pxPerPt;
  const font = `${weight} ${fontPx}px ${fontStack(families)}`;
  const lineHeightPx = fontPx * 1.25;
  const maxLines = Math.max(1, Math.floor(box.h / lineHeightPx));
  const wrapped = wrapText(text, box.w, font, measure);
  // Text that does not fit is cut with an ellipsis (the validator warns about overflow).
  const lines = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines)
    lines[maxLines - 1] = `${lines[maxLines - 1]!.replace(/\s*\S*$/, "")}…`;
  return { kind: "text", lines, box, fontPx, font, color, lineHeightPx, align };
}

/** Drawing operations of one page at `size` output pixels. */
export function pageDrawOps(
  publication: Publication,
  page: Page,
  size: { width: number; height: number },
  measure: Measure,
  style: PublicationStyle = resolvePublicationStyle(publication.type, publication.styleId),
): DrawOp[] {
  const pxPerPt = size.width / PAPER_DIMENSIONS_PT[publication.paper].width;
  const { palette, typeScale, fontFamilies } = style;
  const ops: DrawOp[] = [
    { kind: "fill", color: palette.background, box: { x: 0, y: 0, w: size.width, h: size.height } },
  ];
  const hasFullBleed = page.slots.some((slot) => slot.type === "image" && slot.bleed);
  for (const slot of page.slots) {
    const box = toBox(slot.rect, size);
    if (slot.type === "image") {
      ops.push({
        kind: "image",
        assetId: slot.assetId,
        box,
        fit: slot.fit,
        background: palette.muted,
      });
      continue;
    }
    if (slot.type === "text") {
      const headline = slot.role === "headline" || slot.role === "chapter";
      const sizePt =
        slot.fontSizePt ??
        (slot.role === "chapter" ? typeScale.cover : headline ? typeScale.title : typeScale.body);
      const op = textOp(
        slot.text,
        box,
        sizePt,
        pxPerPt,
        headline ? fontFamilies.display : fontFamilies.body,
        headline ? 600 : 400,
        hasFullBleed && slot.role === "chapter" ? "#ffffff" : palette.foreground,
        slot.role === "chapter" ? "center" : "left",
        measure,
      );
      if (op) ops.push(op);
      if (headline && op && style.divider.enabled && slot.role === "headline") {
        const weightPx = Math.max(1, style.divider.weight * pxPerPt);
        ops.push({
          kind: "rule",
          color: style.divider.style === "accent" ? palette.accent : palette.muted,
          box: { x: box.x, y: box.y + box.h - weightPx, w: box.w, h: weightPx },
        });
      }
      continue;
    }
    const text = slot.caption.sentences.map((sentence) => sentence.text).join(" ");
    const op = textOp(
      style.caption.uppercase ? text.toUpperCase() : text,
      box,
      slot.fontSizePt ?? typeScale.caption,
      pxPerPt,
      fontFamilies.body,
      400,
      palette.foreground,
      "left",
      measure,
    );
    if (op) ops.push(op);
  }
  return ops;
}

/** Source rectangle of a `cover` crop (centered) or the target box of a `contain` fit. */
export function fitImage(
  image: { width: number; height: number },
  box: Box,
  fit: "cover" | "contain",
): { source: Box; target: Box } {
  const full = { x: 0, y: 0, w: image.width, h: image.height };
  const imageAspect = image.width / image.height;
  const boxAspect = box.w / box.h;
  if (fit === "cover") {
    if (imageAspect > boxAspect) {
      const w = image.height * boxAspect;
      return { source: { ...full, x: (image.width - w) / 2, w }, target: box };
    }
    const h = image.width / boxAspect;
    return { source: { ...full, y: (image.height - h) / 2, h }, target: box };
  }
  if (imageAspect > boxAspect) {
    const h = box.w / imageAspect;
    return { source: full, target: { ...box, y: box.y + (box.h - h) / 2, h } };
  }
  const w = box.h * imageAspect;
  return { source: full, target: { ...box, x: box.x + (box.w - w) / 2, w } };
}

/** Longest edge to request from `asset_preview` so a frame gets full resolution (≤ 4096). */
export function neededSourceEdge(
  image: { width: number; height: number },
  box: Box,
  fit: "cover" | "contain",
): number {
  const scale =
    fit === "cover"
      ? Math.max(box.w / image.width, box.h / image.height)
      : Math.min(box.w / image.width, box.h / image.height);
  const needed = Math.ceil(scale * Math.max(image.width, image.height));
  return Math.max(256, Math.min(4096, Math.max(image.width, image.height), needed));
}

export type LoadedImage = { source: CanvasImageSource; width: number; height: number };

/** Replays draw ops on a 2D context; `images` maps asset ids to decoded sources. */
export function drawPage(
  ctx: CanvasRenderingContext2D,
  ops: readonly DrawOp[],
  images: ReadonlyMap<string, LoadedImage>,
) {
  for (const op of ops) {
    if (op.kind === "fill" || op.kind === "rule") {
      ctx.fillStyle = op.color;
      ctx.fillRect(op.box.x, op.box.y, op.box.w, op.box.h);
    } else if (op.kind === "image") {
      const image = images.get(op.assetId);
      ctx.fillStyle = op.background;
      ctx.fillRect(op.box.x, op.box.y, op.box.w, op.box.h);
      if (!image) continue;
      const { source, target } = fitImage(image, op.box, op.fit);
      ctx.drawImage(
        image.source,
        source.x,
        source.y,
        source.w,
        source.h,
        target.x,
        target.y,
        target.w,
        target.h,
      );
    } else {
      ctx.fillStyle = op.color;
      ctx.font = op.font;
      ctx.textBaseline = "top";
      ctx.textAlign = op.align;
      const x = op.align === "center" ? op.box.x + op.box.w / 2 : op.box.x;
      op.lines.forEach((line, index) => {
        ctx.fillText(line, x, op.box.y + index * op.lineHeightPx, op.box.w);
      });
    }
  }
}
