/**
 * Webview export (SRS §11.5, ADR-038 MVP): each page is drawn on a canvas from its layout
 * and the pinned source files, encoded as PNG or JPEG, and, for PDF, wrapped by the pure-TS
 * writer. The bytes go to the backend's `publication_export_save`, which asks where to save.
 */
import type { AssetDTO, Page, Publication } from "@arch/domain";
import { assetPreview, call, type PublicationExportFormat } from "../../lib/bridge";
import { buildPdf, bytesToBase64 } from "./pdf";
import {
  drawPage,
  exportPixelSize,
  neededSourceEdge,
  pageDrawOps,
  type LoadedImage,
} from "./render";

export const JPEG_QUALITY = 0.92;

type ImageCache = Map<string, Promise<LoadedImage | null>>;

async function loadImage(
  projectId: string,
  asset: AssetDTO | undefined,
  maxEdge: number,
): Promise<LoadedImage | null> {
  if (!asset || asset.status !== "ready") return null;
  const blob = await assetPreview({ projectId, assetId: asset.id, maxEdge });
  const bitmap = await createImageBitmap(blob);
  return { source: bitmap, width: bitmap.width, height: bitmap.height };
}

/** Draws one page at `scale` × the export size (1 = 150 dpi print / 1920 px wide 16:9). */
export async function renderPage(
  publication: Publication,
  page: Page,
  assets: readonly AssetDTO[],
  projectId: string,
  scale = 1,
  cache: ImageCache = new Map(),
): Promise<HTMLCanvasElement> {
  const size = exportPixelSize(publication.paper, scale);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is not available.");
  const measure = (text: string, font: string) => {
    ctx.font = font;
    return ctx.measureText(text).width;
  };
  const ops = pageDrawOps(publication, page, size, measure);
  const images = new Map<string, LoadedImage>();
  for (const op of ops) {
    if (op.kind !== "image" || images.has(op.assetId)) continue;
    const asset = assets.find((item) => item.id === op.assetId);
    const edge =
      asset?.widthPx && asset.heightPx
        ? neededSourceEdge({ width: asset.widthPx, height: asset.heightPx }, op.box, op.fit)
        : 2048;
    const key = `${op.assetId}@${edge}`;
    if (!cache.has(key)) cache.set(key, loadImage(projectId, asset, edge));
    const image = await cache.get(key)!;
    if (image) images.set(op.assetId, image);
  }
  drawPage(ctx, ops, images);
  return canvas;
}

export async function canvasBytes(
  canvas: HTMLCanvasElement,
  mime: "image/png" | "image/jpeg",
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, mime === "image/jpeg" ? JPEG_QUALITY : undefined),
  );
  if (!blob) throw new Error("The page could not be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}

/** Renders every page and hands the files to the backend. Resolves to the written paths. */
export async function exportPublication(
  publication: Publication,
  format: PublicationExportFormat,
  assets: readonly AssetDTO[],
  projectId: string,
  onProgress?: (done: number, total: number) => void,
) {
  const cache: ImageCache = new Map();
  const mime = format === "png" ? "image/png" : "image/jpeg";
  const pages: Uint8Array[] = [];
  for (const [index, page] of publication.pages.entries()) {
    const canvas = await renderPage(publication, page, assets, projectId, 1, cache);
    pages.push(await canvasBytes(canvas, mime));
    onProgress?.(index + 1, publication.pages.length);
  }
  const files =
    format === "pdf"
      ? [
          bytesToBase64(
            buildPdf(
              pages.map((jpeg) => ({ jpeg })),
              publication.paper,
              publication.title,
            ),
          ),
        ]
      : pages.map(bytesToBase64);
  return call("publication_export_save", {
    projectId,
    format,
    baseName: publication.title.trim() || "publication",
    files,
  });
}
