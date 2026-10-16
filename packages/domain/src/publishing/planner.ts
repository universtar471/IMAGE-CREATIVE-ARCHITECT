/**
 * Exact Page Budget planner (SRS §11.3, ADR-038).
 *
 * `planPublication` always returns exactly `targetPageCount` pages. `include_all` places
 * every selected image exactly once; `ai_select` keeps a subset and records why each image
 * was kept or omitted. When there are more pages than images the extra pages are cover,
 * text or diagram pages: images are never invented. The only randomness is the tie-break of
 * `ai_select`, drawn from `seed`, so a plan is reproducible.
 */
import {
  CONTENT_BOX,
  FOOTER_BAND,
  HEADER_BAND,
  PAPER_DIMENSIONS_PT,
  fitRects,
  getLayoutTemplate,
  placeIn,
} from "./layouts";
import { seededRandom, subSeed } from "./random";
import {
  IMAGE_GROUPS,
  PublicationInputSchema,
  PublicationSchema,
  type CaptionPageSlot,
  type ImageGroup,
  type ImageSlot,
  type LayoutTemplateId,
  type NormalizedRect,
  type Page,
  type PageSlot,
  type PaperSize,
  type ParsedPublicationInput,
  type Publication,
  type PublicationAsset,
  type PublicationInput,
  type PublicationType,
  type TextDensity,
  type TextKind,
  type TextSlot,
} from "./schemas";
import { resolvePublicationStyle, type PublicationStyle } from "./styles";

export class PublicationPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationPlanError";
  }
}

/** Images per page `ai_select` aims for, by type (hero-led types keep fewer). */
export const AI_SELECT_IMAGES_PER_PAGE: Record<PublicationType, number> = {
  portfolio: 5,
  magazine: 4,
  catalog: 9,
  concept_book: 10,
};

/** Images on one page above which the planner suggests A3 or a digital format. */
export const DENSE_PAGE_IMAGE_COUNT: Record<PaperSize, number> = { A4: 10, A3: 16, "16:9": 16 };

export const DENSE_PAGE_WARNING = "dense_page_suggest_a3_or_digital";

const CAPTION_WORDS: Record<TextDensity, number> = { sparse: 12, balanced: 25, dense: 45 };

const CAPTION_KIND: Record<PublicationType, TextKind> = {
  portfolio: "editorial",
  catalog: "technical",
  concept_book: "technical",
  magazine: "editorial",
};

const DEFAULT_IMPORTANCE = 0.5;
const importanceOf = (asset: PublicationAsset) => asset.importance ?? DEFAULT_IMPORTANCE;
const groupRank = (group: ImageGroup | undefined) => IMAGE_GROUPS.indexOf(group ?? "general");

type Selection = { chosen: PublicationAsset[]; reasons: Record<string, string> };

function resolveSelectedAssets(input: ParsedPublicationInput): PublicationAsset[] {
  const byId = new Map(input.assets.map((asset) => [asset.assetId, asset]));
  const seen = new Set<string>();
  const result: PublicationAsset[] = [];
  for (const id of input.selectedImageIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const asset = byId.get(id);
    if (!asset) {
      throw new PublicationPlanError(
        `Selected image ${id} has no asset record; it cannot be pinned by sourceHash.`,
      );
    }
    result.push(asset);
  }
  return result;
}

function selectImages(input: ParsedPublicationInput, assets: PublicationAsset[]): Selection {
  const reasons: Record<string, string> = {};
  if (input.selectionMode === "include_all") return { chosen: assets, reasons };

  const budget = AI_SELECT_IMAGES_PER_PAGE[input.type] * input.targetPageCount;
  const random = seededRandom(subSeed(input.seed, "ai_select"));
  const ranked = assets
    .map((asset, order) => ({ asset, order, jitter: random() }))
    .sort(
      (a, b) =>
        importanceOf(b.asset) - importanceOf(a.asset) || a.jitter - b.jitter || a.order - b.order,
    );

  const kept = new Set<string>();
  const keep = (asset: PublicationAsset, reason: string) => {
    kept.add(asset.assetId);
    reasons[asset.assetId] = reason;
  };
  // Concept books first keep the best image of each evidenced group (SRS §11.3).
  if (input.type === "concept_book") {
    for (const group of IMAGE_GROUPS) {
      if (group === "general" || kept.size >= budget) continue;
      const best = ranked.find((item) => item.asset.group === group);
      if (best) {
        keep(
          best.asset,
          `ai_select: kept as the strongest "${group}" image (importance ${importanceOf(best.asset)}).`,
        );
      }
    }
  }
  for (const item of ranked) {
    if (kept.has(item.asset.assetId)) continue;
    if (kept.size < budget) {
      keep(
        item.asset,
        `ai_select: kept by rank (importance ${importanceOf(item.asset)}) within the budget of ${budget} images for a ${input.targetPageCount}-page ${input.type}.`,
      );
    } else {
      reasons[item.asset.assetId] =
        `ai_select: omitted; the budget of ${budget} images for a ${input.targetPageCount}-page ${input.type} is full of higher-ranked images (importance ${importanceOf(item.asset)}).`;
    }
  }
  return { chosen: assets.filter((asset) => kept.has(asset.assetId)), reasons };
}

/** Splits `count` items over `pages` pages as evenly as possible, earlier pages first. */
export function distributeCounts(count: number, pages: number): number[] {
  const counts: number[] = [];
  let remaining = count;
  for (let index = 0; index < pages; index += 1) {
    const share = Math.ceil(remaining / (pages - index));
    counts.push(share);
    remaining -= share;
  }
  return counts;
}

/** The automatic layout of a content page, by publication type (AC-16, AC-17). */
export function autoTemplate(type: PublicationType, imageCount: number): LayoutTemplateId {
  switch (type) {
    case "concept_book":
      if (imageCount >= 4) return "dense_contact";
      if (imageCount === 3) return "flexible_grid";
      return imageCount === 2 ? "split" : "hero_full_page";
    case "portfolio":
      return imageCount > 1 ? "hero_plus_secondary" : "hero_full_page";
    case "catalog":
      if (imageCount <= 1) return "split";
      if (imageCount <= 4) return "grid_2x2";
      return imageCount <= 6 ? "grid_2x3" : "flexible_grid";
    case "magazine":
      if (imageCount <= 1) return "hero_full_page";
      return imageCount <= 12 ? "asymmetric_editorial" : "hero_plus_secondary";
  }
}

/** Primary image first; Concept Books then group thumbnails context → massing → space → detail. */
function orderPageImages(type: PublicationType, images: PublicationAsset[]): PublicationAsset[] {
  if (images.length <= 1) return images;
  let primary = 0;
  images.forEach((asset, index) => {
    if (importanceOf(asset) > importanceOf(images[primary]!)) primary = index;
  });
  const rest = images.filter((_, index) => index !== primary);
  if (type === "concept_book") {
    rest.sort((a, b) => groupRank(a.group) - groupRank(b.group));
  }
  return [images[primary]!, ...rest];
}

type PageContext = {
  input: ParsedPublicationInput;
  style: PublicationStyle;
  pageNumber: number;
};

function pageHeightPt(paper: PaperSize, rect: NormalizedRect): number {
  return rect.h * PAPER_DIMENSIONS_PT[paper].height;
}

/** A font size from the style, shrunk so one line fits the band height. */
function fittedSize(preferred: number, paper: PaperSize, rect: NormalizedRect): number {
  return Math.round(Math.min(preferred, pageHeightPt(paper, rect) / 1.3) * 10) / 10;
}

function textSlot(
  ctx: PageContext,
  id: string,
  rect: NormalizedRect,
  role: TextSlot["role"],
  text: string,
  preferredSize: number,
): TextSlot {
  return {
    id,
    type: "text",
    rect,
    text,
    role,
    fontSizePt: fittedSize(preferredSize, ctx.input.paper, rect),
    factRef: null,
    placeholder: text.trim().length === 0,
  };
}

function headline(ctx: PageContext): TextSlot {
  const text = ctx.pageNumber === 1 ? ctx.input.title : "";
  return textSlot(
    ctx,
    `P${ctx.pageNumber}_headline`,
    HEADER_BAND,
    "headline",
    text,
    ctx.style.typeScale.title,
  );
}

function captionSlots(
  ctx: PageContext,
  images: readonly ImageSlot[],
  groups: boolean,
): CaptionPageSlot[] {
  const wordLimit = Math.max(
    6,
    Math.round(CAPTION_WORDS[ctx.input.textDensity] * (ctx.input.type === "portfolio" ? 0.6 : 1)),
  );
  const clusters: { group?: ImageGroup; ids: string[] }[] = [];
  if (groups && images.some((image) => image.group !== "general")) {
    for (const group of IMAGE_GROUPS) {
      const ids = images.filter((image) => image.group === group).map((image) => image.assetId);
      if (ids.length > 0) clusters.push({ group, ids });
    }
  } else {
    clusters.push({ ids: images.map((image) => image.assetId) });
  }
  const width = (1 - 0.02 * (clusters.length - 1)) / clusters.length;
  return clusters.map((cluster, index) => ({
    id: `P${ctx.pageNumber}_caption_${cluster.group ?? "all"}`,
    type: "caption",
    rect: placeIn(FOOTER_BAND, { x: index * (width + 0.02), y: 0, w: width, h: 1 }),
    fontSizePt: ctx.style.typeScale.caption,
    caption: {
      textKind: CAPTION_KIND[ctx.input.type],
      sentences: [],
      needs_review: false,
      wordLimit: Math.max(4, Math.round(wordLimit / clusters.length)),
      imageAssetIds: cluster.ids,
      ...(cluster.group ? { group: cluster.group } : {}),
    },
  }));
}

function contentPage(ctx: PageContext, images: PublicationAsset[], firstImageNumber: number): Page {
  const { input } = ctx;
  const ordered = orderPageImages(input.type, images);
  const templateId =
    input.layoutMode === "auto" ? autoTemplate(input.type, ordered.length) : input.layoutMode;
  const template = getLayoutTemplate(templateId);
  const rects = fitRects(template, input.paper, ordered.length);
  const imageSlots: ImageSlot[] = ordered.map((asset, index) => ({
    id: `P${ctx.pageNumber}_img_${index + 1}`,
    type: "image",
    rect: rects[index]!,
    assetId: asset.assetId,
    sourceHash: asset.sourceHash,
    fit: "cover",
    bleed: template.bleed,
    primary: index === 0,
    group: input.type === "concept_book" ? (asset.group ?? "general") : "general",
    ...(input.type === "catalog"
      ? { label: asset.label ?? String(firstImageNumber + index).padStart(2, "0") }
      : asset.label
        ? { label: asset.label }
        : {}),
  }));

  const slots: PageSlot[] = [...imageSlots];
  if (input.type !== "portfolio") slots.push(headline(ctx));
  if (!(input.type === "portfolio" && input.textDensity === "sparse")) {
    slots.push(...captionSlots(ctx, imageSlots, input.type === "concept_book"));
  }

  const warnings: string[] = [];
  if (ordered.length >= DENSE_PAGE_IMAGE_COUNT[input.paper]) warnings.push(DENSE_PAGE_WARNING);
  return {
    id: `PAGE_${ctx.pageNumber}`,
    index: ctx.pageNumber - 1,
    kind: "content",
    layoutTemplateId: template.id,
    slots,
    warnings,
  };
}

function coverPage(ctx: PageContext, hero: PublicationAsset | null): Page {
  const titleRect: NormalizedRect = { x: 0.08, y: 0.4, w: 0.84, h: 0.14 };
  const title = textSlot(
    ctx,
    `P${ctx.pageNumber}_title`,
    titleRect,
    "chapter",
    ctx.input.title,
    ctx.style.typeScale.cover,
  );
  const slots: PageSlot[] = [];
  if (hero) {
    slots.push({
      id: `P${ctx.pageNumber}_img_1`,
      type: "image",
      rect: { x: 0, y: 0, w: 1, h: 1 },
      assetId: hero.assetId,
      sourceHash: hero.sourceHash,
      fit: "cover",
      bleed: true,
      primary: true,
      group: "general",
    });
  }
  slots.push(title);
  return {
    id: `PAGE_${ctx.pageNumber}`,
    index: ctx.pageNumber - 1,
    kind: "cover",
    layoutTemplateId: hero ? "hero_full_page" : null,
    slots,
    warnings: [],
  };
}

/** A page for budget beyond the images: a diagram sheet (Concept Book) or a text page. */
function extraPage(ctx: PageContext): Page {
  const { input } = ctx;
  if (input.type === "concept_book") {
    const frames = fitRects(getLayoutTemplate("diagram_sheet"), input.paper, 4);
    return {
      id: `PAGE_${ctx.pageNumber}`,
      index: ctx.pageNumber - 1,
      kind: "diagram",
      layoutTemplateId: "diagram_sheet",
      slots: [
        headline(ctx),
        ...frames.map((rect, index) =>
          textSlot(
            ctx,
            `P${ctx.pageNumber}_diagram_${index + 1}`,
            rect,
            "label",
            "",
            ctx.style.typeScale.label,
          ),
        ),
      ],
      warnings: [],
    };
  }
  return {
    id: `PAGE_${ctx.pageNumber}`,
    index: ctx.pageNumber - 1,
    kind: "text",
    layoutTemplateId: null,
    slots: [
      headline(ctx),
      textSlot(ctx, `P${ctx.pageNumber}_body`, CONTENT_BOX, "body", "", ctx.style.typeScale.body),
    ],
    warnings: [],
  };
}

export function planPublication(rawInput: PublicationInput): Publication {
  const input = PublicationInputSchema.parse(rawInput);
  const style = resolvePublicationStyle(input.type, input.styleId);
  const assets = resolveSelectedAssets(input);
  const { chosen, reasons } = selectImages(input, assets);
  const pageCount = input.targetPageCount;
  const pages: Page[] = [];
  const ctx = (pageNumber: number): PageContext => ({ input, style, pageNumber });
  const placedOn = new Map<string, string>();

  if (chosen.length >= pageCount) {
    let cursor = 0;
    distributeCounts(chosen.length, pageCount).forEach((count, index) => {
      const page = contentPage(ctx(index + 1), chosen.slice(cursor, cursor + count), cursor + 1);
      cursor += count;
      pages.push(page);
    });
  } else {
    // More pages than images: a cover, one image per page, then text or diagram pages.
    const hero = input.allowImageRepeat ? (orderPageImages(input.type, chosen)[0] ?? null) : null;
    pages.push(coverPage(ctx(1), hero));
    chosen.forEach((asset, index) => pages.push(contentPage(ctx(index + 2), [asset], index + 1)));
    for (let number = pages.length + 1; number <= pageCount; number += 1) {
      pages.push(extraPage(ctx(number)));
    }
  }

  for (const page of pages) {
    if (page.kind !== "content") continue;
    for (const slot of page.slots) if (slot.type === "image") placedOn.set(slot.assetId, page.id);
  }
  if (input.selectionMode === "include_all") {
    for (const asset of chosen) {
      reasons[asset.assetId] = `include_all: placed once on ${placedOn.get(asset.assetId)}.`;
    }
  } else {
    for (const asset of chosen) {
      reasons[asset.assetId] =
        `${reasons[asset.assetId]} Placed on ${placedOn.get(asset.assetId)}.`;
    }
  }

  return PublicationSchema.parse({
    schemaVersion: 1,
    title: input.title,
    targetPageCount: pageCount,
    selectionMode: input.selectionMode,
    type: input.type,
    paper: input.paper,
    textDensity: input.textDensity,
    styleId: style.id,
    layoutMode: input.layoutMode,
    seed: input.seed,
    lockedPageIds: input.lockedPageIds,
    allowImageRepeat: input.allowImageRepeat,
    selectedImageIds: assets.map((asset) => asset.assetId),
    assetPins: assets.map(({ assetId, sourceHash }) => ({ assetId, sourceHash })),
    selectionReasons: reasons,
    pages,
  });
}
