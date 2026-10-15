import {
  PublicationInputSchema,
  PublicationSchema,
  type AssetPin,
  type ImageSlot,
  type LayoutMode,
  type Page,
  type PageSlot,
  type Publication,
  type PublicationInput,
  type PublicationType,
  type SelectedImage,
} from "./schemas";
import { fitRects, getLayoutTemplate, type LayoutTemplate } from "./layouts";

const IMAGE_GROUPS = ["context", "massing", "space", "detail"] as const;
type ImageGroup = (typeof IMAGE_GROUPS)[number];

type NormalizedSelection = {
  pins: AssetPin[];
  sourceOrder: string[];
};

function normalizeSelection(images: readonly SelectedImage[]): NormalizedSelection {
  const pins: AssetPin[] = [];
  const sourceOrder: string[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const pin = typeof image === "string" ? { assetId: image, sourceHash: `unresolved:${image}` } : image;
    if (seen.has(pin.assetId)) continue;
    seen.add(pin.assetId);
    pins.push(pin);
    sourceOrder.push(pin.assetId);
  }
  return { pins, sourceOrder };
}

function seededRandom(seed: number) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function selectedPins(
  input: PublicationInput,
  normalized: NormalizedSelection,
): { pins: AssetPin[]; reasons: Record<string, string> } {
  const reasons: Record<string, string> = {};
  if (input.selectionMode === "include_all") {
    for (const id of normalized.sourceOrder) reasons[id] = "Included because selection mode is include_all.";
    return { pins: normalized.pins, reasons };
  }

  const random = seededRandom(input.seed);
  const capacity = imageCapacity(input.type, input.targetPageCount);
  const target = Math.min(
    normalized.pins.length,
    Math.max(1, Math.min(capacity, Math.ceil(normalized.pins.length * 0.7))),
  );
  const ranked = normalized.pins
    .map((pin, index) => ({ pin, index, score: random() }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, target)
    .sort((a, b) => a.index - b.index);
  const selected = new Set(ranked.map((item) => item.pin.assetId));
  for (const pin of normalized.pins) {
    reasons[pin.assetId] = selected.has(pin.assetId)
      ? "Selected by the seeded relevance pass for this publication type."
      : "Omitted by the seeded relevance pass to preserve page readability.";
  }
  return { pins: ranked.map((item) => item.pin), reasons };
}

function imageCapacity(type: PublicationType, pageCount: number): number {
  if (type === "concept_book") return pageCount === 1 ? 10 : pageCount * 6;
  if (type === "portfolio") return pageCount === 1 ? 10 : pageCount * 6;
  if (type === "magazine") return pageCount === 1 ? 10 : pageCount * 5;
  return pageCount * 12;
}

function chooseTemplate(
  type: PublicationType,
  imageCount: number,
  requested: LayoutMode,
): LayoutTemplate {
  if (requested !== "auto") return getLayoutTemplate(requested);
  if (type === "concept_book" && imageCount >= 8) return getLayoutTemplate("dense_contact");
  if (type === "portfolio") {
    return getLayoutTemplate(imageCount > 1 ? "hero_plus_secondary" : "hero_full_page");
  }
  if (type === "catalog") return getLayoutTemplate(imageCount > 6 ? "flexible_grid" : "grid_2x3");
  return getLayoutTemplate(imageCount > 1 ? "hero_plus_secondary" : "hero_full_page");
}

function distributeCounts(imageCount: number, pageCount: number): number[] {
  const counts: number[] = [];
  let remaining = imageCount;
  for (let index = 0; index < pageCount; index += 1) {
    const pagesLeft = pageCount - index;
    const count = remaining === 0 ? 0 : Math.ceil(remaining / pagesLeft);
    counts.push(count);
    remaining -= count;
  }
  return counts;
}

function imageSlot(
  id: string,
  pin: AssetPin,
  rect: ImageSlot["rect"],
  index: number,
  type: PublicationType,
  reasons: Record<string, string>,
): ImageSlot {
  const group: ImageGroup = type === "concept_book" ? IMAGE_GROUPS[index % IMAGE_GROUPS.length]! : "general";
  return {
    id,
    type: "image",
    rect,
    overflow: false,
    assetId: pin.assetId,
    sourceHash: pin.sourceHash,
    group,
    selectionReason: reasons[pin.assetId],
    safeCrop: true,
  };
}

function pageExtras(type: PublicationType, pageIndex: number, imageSlots: readonly ImageSlot[]): PageSlot[] {
  if (type === "magazine" && imageSlots.length > 0) {
    return [
      {
        id: `TXT_${pageIndex}_headline`,
        type: "text",
        rect: { x: 0.04, y: 0.005, w: 0.61, h: 0.055 },
        overflow: false,
        text: "Selected spaces and material moments",
        role: "headline",
        fontSizePt: 20,
      },
    ];
  }
  if (type === "concept_book" && imageSlots.length > 0) {
    return [
      {
        id: `CAP_${pageIndex}_groups`,
        type: "caption",
        rect: { x: 0.04, y: 0.94, w: 0.92, h: 0.04 },
        overflow: false,
        caption: {
          id: `CAP_${pageIndex}_groups`,
          textKind: "editorial",
          sentences: [
            {
              text: "Context, massing, space and detail are grouped where the selected evidence allows.",
              needs_review: false,
            },
          ],
          needs_review: false,
        },
        fontSizePt: 8,
      },
    ];
  }
  return [];
}

function emptyPageKind(pageIndex: number): Page["kind"] {
  if (pageIndex === 0) return "cover";
  return pageIndex % 2 === 0 ? "diagram" : "text";
}

function buildPage(
  input: PublicationInput,
  pageIndex: number,
  imagePins: readonly AssetPin[],
  reasons: Record<string, string>,
): Page {
  const template = chooseTemplate(input.type, imagePins.length, input.layoutMode);
  const rects = fitRects(template, input.paper, imagePins.length);
  const images = imagePins.map((pin, index) =>
    imageSlot(`IMG_${pageIndex}_${index}`, pin, rects[index]!, index, input.type, reasons),
  );
  const slots: PageSlot[] = [...images, ...pageExtras(input.type, pageIndex, images)];
  if (slots.length === 0) {
    slots.push({
      id: `TXT_${pageIndex}_empty`,
      type: "text",
      rect: { x: 0.1, y: 0.42, w: 0.8, h: 0.16 },
      overflow: false,
      text: pageIndex === 0 ? "Publication" : "Additional editorial page",
      role: pageIndex === 0 ? "chapter" : "body",
      fontSizePt: pageIndex === 0 ? 32 : 12,
    });
  }
  return {
    id: `PAGE_${pageIndex + 1}`,
    index: pageIndex,
    kind: imagePins.length > 0 ? "content" : emptyPageKind(pageIndex),
    layoutTemplateId: template.id,
    slots,
    warnings: [],
  };
}

export function planPublication(rawInput: PublicationInput): Publication {
  const input = PublicationInputSchema.parse(rawInput);
  const normalized = normalizeSelection(input.selectedImageIds);
  const selection = selectedPins(input, normalized);
  const counts = distributeCounts(selection.pins.length, input.targetPageCount);
  const pages: Page[] = [];
  let cursor = 0;
  for (let index = 0; index < input.targetPageCount; index += 1) {
    const pagePins = selection.pins.slice(cursor, cursor + counts[index]!);
    pages.push(buildPage(input, index, pagePins, selection.reasons));
    cursor += counts[index]!;
  }

  return PublicationSchema.parse({
    schemaVersion: 1,
    targetPageCount: input.targetPageCount,
    selectionMode: input.selectionMode,
    type: input.type,
    paper: input.paper,
    textDensity: input.textDensity,
    styleId: input.styleId,
    layoutMode: input.layoutMode,
    seed: input.seed,
    lockedPageIds: input.lockedPageIds,
    assetPins: normalized.pins,
    selectionReasons: selection.reasons,
    pages,
  });
}
