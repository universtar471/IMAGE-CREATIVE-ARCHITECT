/**
 * Webview side of the Diagram exports (ADR-037): embed images as data URLs (an SVG drawn
 * through <img> cannot load external files), rasterize the vector sheet on a canvas, and
 * save the PNG through the backend's managed image path with its lineage.
 */
import {
  DIAGRAM_VIDEO_DEFAULTS,
  diagramVideoTimeline,
  layoutDiagramFrame,
  layoutDiagramSheet,
  type AssetDTO,
  type DiagramLanguage,
  type DiagramLayout,
  type DiagramPlan,
  type DiagramSheetOptions,
  type DiagramVideoExportResult,
} from "@arch/domain";
import { assetPreview, call } from "../../lib/bridge";

export const PNG_SIZES = { "2K": 2048, "4K": 4096 } as const;
export type PngSize = keyof typeof PNG_SIZES;

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Cannot read the image."));
    reader.readAsDataURL(blob);
  });
}

/** The asset's pixels as a data URL (bounded long edge), from the backend preview command. */
export async function assetDataUrl(
  projectId: string,
  assetId: string,
  maxEdge: number,
): Promise<string> {
  const blob = await assetPreview({ projectId, assetId, maxEdge });
  // The browser mock serves SVG placeholders under a PNG type: sniff the real format.
  const head = await blob.slice(0, 5).text();
  const typed =
    head.startsWith("<svg") || head.startsWith("<?xml")
      ? new Blob([blob], { type: "image/svg+xml" })
      : blob;
  return blobToDataUrl(typed);
}

/** Data URLs of the source render and every attached frame. Unreadable images are skipped. */
export async function sheetImages(
  projectId: string,
  plan: Pick<DiagramPlan, "steps">,
  sourceAssetId: string | null,
  maxEdge: number,
): Promise<Pick<DiagramSheetOptions, "sourceHref" | "frameHrefs">> {
  const load = (id: string) => assetDataUrl(projectId, id, maxEdge).catch(() => null);
  const sourceHref = sourceAssetId ? await load(sourceAssetId) : null;
  const frameHrefs: Record<string, string> = {};
  for (const id of new Set(plan.steps.map((s) => s.frameAssetId).filter((x): x is string => !!x))) {
    const href = await load(id);
    if (href) frameHrefs[id] = href;
  }
  return { sourceHref, frameHrefs };
}

export const svgDataUrl = (svg: string) =>
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function svgSize(svg: string): { width: number; height: number } {
  const m = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/.exec(svg);
  if (!m) throw new Error("The diagram has no view box.");
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Rasterize `svg` so its long edge is `longEdge` px (or to exactly `size`); base64 PNG. */
export async function rasterizeSvg(
  svg: string,
  target: { longEdge: number } | { width: number; height: number },
): Promise<{ base64: string; width: number; height: number }> {
  const view = svgSize(svg);
  const { width, height } =
    "longEdge" in target
      ? {
          width: Math.round((view.width * target.longEdge) / Math.max(view.width, view.height)),
          height: Math.round((view.height * target.longEdge) / Math.max(view.width, view.height)),
        }
      : target;
  // The root size is set to the target pixels, so the browser rasterizes the vectors at full
  // resolution instead of scaling a small bitmap up.
  const sized = svg.replace(
    /^<svg([^>]*?) width="[^"]*" height="[^"]*"/,
    `<svg$1 width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"`,
  );
  const img = new Image();
  img.width = width;
  img.height = height;
  img.src = svgDataUrl(sized);
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The canvas is not available.");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The diagram could not be rasterized.");
  const url = await blobToDataUrl(blob);
  return { base64: url.slice(url.indexOf(",") + 1), width, height };
}

type ExportContext = {
  projectId: string;
  sourceAssetId: string;
  plan: DiagramPlan;
  layout: DiagramLayout;
  lang: DiagramLanguage;
  title: string;
};

const meta = (ctx: ExportContext) => ({
  type: ctx.plan.type,
  layout: ctx.layout,
  lang: ctx.lang,
  stepIds: ctx.plan.steps.map((s) => s.id),
  evidence: ctx.plan.steps.map((s) => s.evidence),
});

/** PNG 2K/4K of the sheet, saved as a new asset derived from the source render. */
export async function exportSheetPng(
  ctx: ExportContext,
  size: PngSize,
  label: string,
): Promise<AssetDTO> {
  const images = await sheetImages(ctx.projectId, ctx.plan, ctx.sourceAssetId, 2048);
  const svg = layoutDiagramSheet(ctx.plan.steps, ctx.layout, ctx.lang, {
    type: ctx.plan.type,
    title: ctx.title,
    ...images,
  });
  const png = await rasterizeSvg(svg, { longEdge: PNG_SIZES[size] });
  return call("diagram_image_save", {
    projectId: ctx.projectId,
    parentAssetId: ctx.sourceAssetId,
    pngBase64: png.base64,
    label,
    kind: "sheet",
    meta: { ...meta(ctx), size, widthPx: png.width, heightPx: png.height },
  });
}

/**
 * MP4 of the approved steps: each step is rasterized as a 16:9 frame, saved as a frame asset
 * (lineage to the source), then FFmpeg assembles them. Throws when a step is not approved.
 */
export async function exportVideo(
  ctx: ExportContext,
  frameLabel: (number: number) => string,
  onProgress?: (done: number, total: number) => void,
): Promise<DiagramVideoExportResult> {
  const timeline = diagramVideoTimeline(ctx.plan);
  const images = await sheetImages(ctx.projectId, ctx.plan, ctx.sourceAssetId, 2048);
  const { width, height, fps } = DIAGRAM_VIDEO_DEFAULTS;
  const frames = [];
  for (const [i, step] of ctx.plan.steps.entries()) {
    onProgress?.(i, ctx.plan.steps.length);
    const svg = layoutDiagramFrame(step, i, ctx.plan.steps.length, ctx.lang, images);
    const png = await rasterizeSvg(svg, { width, height });
    const asset = await call("diagram_image_save", {
      projectId: ctx.projectId,
      parentAssetId: ctx.sourceAssetId,
      pngBase64: png.base64,
      label: frameLabel(i + 1),
      kind: "frame",
      meta: { ...meta(ctx), stepId: step.id },
    });
    frames.push({
      path: asset.absolutePath,
      durationMs: timeline[i]!.durationMs,
      motion: timeline[i]!.motion,
    });
  }
  onProgress?.(ctx.plan.steps.length, ctx.plan.steps.length);
  return call("diagram_video_export", { projectId: ctx.projectId, frames, width, height, fps });
}
