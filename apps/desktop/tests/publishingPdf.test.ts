/** SRS P5b: the pure-TS PDF writer (DCTDecode pages at the paper size). */
import { describe, expect, it } from "vitest";
import { planPublication, type PaperSize } from "@arch/domain";
import { buildPdf, bytesToBase64, jpegInfo } from "../src/features/publishing/pdf";

/** A structurally valid JPEG header (SOI, APP0, SOF0, EOI) of `width` × `height`. */
function fakeJpeg(width: number, height: number, components = 3): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [
    0xff,
    0xc0,
    0x00,
    8 + components * 3,
    8,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
    ...Array.from({ length: components }, (_, i) => [i + 1, 0x11, 0]).flat(),
  ];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9]);
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

function parse(bytes: Uint8Array) {
  const text = latin1(bytes);
  const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const xref = text.slice(startxref);
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(xref)!.map(Number) as number[];
  const entries = xref.split("\n").slice(2, 2 + count!);
  return { text, startxref, first, count: count!, entries };
}

describe("jpegInfo", () => {
  it("reads the size and colour components from the frame header", () => {
    expect(jpegInfo(fakeJpeg(1754, 2480))).toEqual({ width: 1754, height: 2480, components: 3 });
    expect(jpegInfo(fakeJpeg(64, 32, 1))).toEqual({ width: 64, height: 32, components: 1 });
  });

  it("rejects data that is not a JPEG", () => {
    expect(() => jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow();
    expect(() => jpegInfo(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toThrow();
  });
});

describe("buildPdf", () => {
  it("writes a valid header, cross-reference table and trailer", () => {
    const pdf = buildPdf([{ jpeg: fakeJpeg(100, 141) }, { jpeg: fakeJpeg(100, 141) }], "A4");
    const { text, startxref, first, count, entries } = parse(pdf);
    expect(text.startsWith("%PDF-1.4\n%")).toBe(true);
    expect(text.slice(startxref, startxref + 5)).toBe("xref\n");
    expect(first).toBe(0);
    expect(count).toBe(4 + 2 * 3);
    expect(entries[0]).toBe("0000000000 65535 f ");
    entries.slice(1).forEach((entry, index) => {
      expect(entry).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj\n`), `object ${index + 1}`).toBe(
        true,
      );
    });
    expect(text).toMatch(new RegExp(`trailer\\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>`));
    expect(text.endsWith("%%EOF\n")).toBe(true);
  });

  it("embeds each JPEG unchanged with DCTDecode and its real length", () => {
    const jpeg = fakeJpeg(320, 180);
    const pdf = buildPdf([{ jpeg }], "16:9");
    const text = latin1(pdf);
    expect(text).toContain(
      `/Width 320 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    );
    const start = text.indexOf("stream\n", text.indexOf("/DCTDecode")) + "stream\n".length;
    expect([...pdf.slice(start, start + jpeg.length)]).toEqual([...jpeg]);
    expect(latin1(pdf.slice(start + jpeg.length, start + jpeg.length + 10))).toBe("\nendstream");
  });

  it.each([1, 3, 10])("has exactly targetPageCount (%i) pages", (targetPageCount) => {
    const assets = [1, 2, 3, 4].map((n) => ({ assetId: `A${n}`, sourceHash: `h${n}` }));
    const publication = planPublication({
      selectedImageIds: assets.map((a) => a.assetId),
      assets,
      targetPageCount,
      selectionMode: "include_all",
      type: "concept_book",
      paper: "A3",
      styleId: "concept_architectural_red",
      seed: 3,
    });
    const pdf = buildPdf(
      publication.pages.map(() => ({ jpeg: fakeJpeg(50, 70) })),
      publication.paper,
    );
    const text = latin1(pdf);
    expect(text).toContain(`/Count ${targetPageCount} >>`);
    expect(text.match(/\/Type \/Page /g)).toHaveLength(targetPageCount);
    expect(text.match(/\/Subtype \/Image/g)).toHaveLength(targetPageCount);
  });

  it.each<[PaperSize, string]>([
    ["A4", "[0 0 595.28 841.89]"],
    ["A3", "[0 0 841.89 1190.55]"],
    ["16:9", "[0 0 960 540]"],
  ])("sizes %s pages in points", (paper, box) => {
    const text = latin1(buildPdf([{ jpeg: fakeJpeg(10, 10) }], paper));
    expect(text).toContain(`/MediaBox ${box}`);
    const [, w, h] = /\[0 0 ([\d.]+) ([\d.]+)\]/.exec(box)!;
    expect(text).toContain(`q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ\n`);
  });

  it("stores a Vietnamese title as UTF-16 and refuses an empty book", () => {
    const text = latin1(buildPdf([{ jpeg: fakeJpeg(10, 10) }], "A4", "Nhà phố"));
    expect(text).toContain("/Title <FEFF004E006800E00020007000681ED1>");
    expect(latin1(buildPdf([{ jpeg: fakeJpeg(10, 10) }], "A4", "Villa (2)"))).toContain(
      "/Title (Villa \\(2\\))",
    );
    expect(() => buildPdf([], "A4")).toThrow();
  });

  it("base64-encodes large files in chunks", () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
