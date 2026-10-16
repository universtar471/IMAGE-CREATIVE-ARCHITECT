/**
 * Minimal pure-TS PDF writer for the Publishing Studio export (ADR-038, SRS P5b).
 *
 * Each page is one JPEG embedded unchanged as an image XObject (`/DCTDecode`) and drawn to
 * fill the page's MediaBox, sized in points from the paper (A4, A3 or 16:9). Text is
 * rasterised into the page image in this MVP. No dependency: the file is assembled from
 * strings and byte arrays, with a classic cross-reference table.
 */
import { PAPER_DIMENSIONS_PT, type PaperSize } from "@arch/domain";

export type JpegInfo = { width: number; height: number; components: 1 | 3 | 4 };

/** Reads the frame header (SOF0–SOF15, except DHT/JPG/DAC) of a baseline or progressive JPEG. */
export function jpegInfo(bytes: Uint8Array): JpegInfo {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("Not a JPEG file.");
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) throw new Error("Corrupt JPEG marker.");
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const height = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      const width = (bytes[offset + 7]! << 8) | bytes[offset + 8]!;
      const components = bytes[offset + 9]!;
      if (!width || !height || (components !== 1 && components !== 3 && components !== 4)) {
        throw new Error("Unsupported JPEG frame.");
      }
      return { width, height, components };
    }
    if (marker === 0xda || marker === 0xd9) break;
    offset += 2 + length;
  }
  throw new Error("JPEG has no frame header.");
}

const encoder = new TextEncoder();
const COLOR_SPACES = { 1: "/DeviceGray", 3: "/DeviceRGB", 4: "/DeviceCMYK" } as const;

/** Formats a point value without exponent notation or trailing zeros. */
const num = (value: number) => String(Math.round(value * 100) / 100);

export type PdfPage = { jpeg: Uint8Array };

/** A complete PDF with one full-page JPEG per page, at the size of `paper`. */
export function buildPdf(pages: readonly PdfPage[], paper: PaperSize, title = ""): Uint8Array {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");
  const { width, height } = PAPER_DIMENSIONS_PT[paper];
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // Binary comment after the header marks the file as binary for transfer tools.
  push("%PDF-1.4\n%âãÏÓ\n");
  // 1 catalog, 2 page tree, 3 info; then per page: page, content, image.
  const pageId = (index: number) => 4 + index * 3;
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(" ");
  object(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  object(3, `<< /Producer (Arch AI Studio) /Title ${pdfString(title)} >>`);
  pages.forEach((page, index) => {
    const info = jpegInfo(page.jpeg);
    const id = pageId(index);
    const content = encoder.encode(`q\n${num(width)} 0 0 ${num(height)} 0 0 cm\n/Im0 Do\nQ\n`);
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(width)} ${num(height)}] ` +
        `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    object(id + 1, `<< /Length ${content.length} >>`, content);
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} ` +
        `/ColorSpace ${COLOR_SPACES[info.components]} /BitsPerComponent 8 /Filter /DCTDecode ` +
        `${info.components === 4 ? "/Decode [1 0 1 0 1 0 1 0] " : ""}/Length ${page.jpeg.length} >>`,
      page.jpeg,
    );
  });

  const size = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** A PDF text string: ASCII as a literal, anything else as UTF-16BE hex with a BOM. */
function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;
  let hex = "FEFF";
  for (let index = 0; index < text.length; index += 1) {
    hex += text.charCodeAt(index).toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

/** Base64 of bytes, in chunks so large exports never overflow the argument stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
