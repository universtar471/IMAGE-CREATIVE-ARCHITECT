/**
 * Seeded randomising of a planned publication (SRS §11.2, ADR-038, AC-18).
 *
 * - `style`: one style for the whole book, among the four of its type.
 * - `layout`: a new image layout per page, among the templates that take its image count.
 * - `smart`: both, preferring templates that fit the page's images without overflow.
 *
 * Every choice is drawn from `seed` and the page id only, never from the current state,
 * so re-applying an earlier seed restores the earlier result. Pages in `lockedPageIds`
 * are returned unchanged. Content and facts are never reshuffled: every slot keeps its id,
 * asset, text and caption, and text slots keep their place; only image frames move.
 */
import { fitRects, getLayoutTemplate, layoutsForImageCount, type LayoutTemplate } from "./layouts";
import { autoTemplate } from "./planner";
import { pick, seededRandom, subSeed } from "./random";
import { PublicationSchema, type Page, type Publication } from "./schemas";
import { stylesForPublicationType } from "./styles";

export const RANDOMIZE_LEVELS = ["style", "layout", "smart"] as const;
export type RandomizeLevel = (typeof RANDOMIZE_LEVELS)[number];

function candidateTemplates(
  publication: Publication,
  imageCount: number,
  smart: boolean,
): readonly LayoutTemplate[] {
  const all = layoutsForImageCount(publication.type, imageCount);
  if (!smart) return all;
  // Smart: templates whose fixed frames hold every image, plus the type's own choice.
  const preferred = getLayoutTemplate(autoTemplate(publication.type, imageCount));
  const fitting = all.filter(
    (template) => template.flexible || template.slotRects[publication.paper].length >= imageCount,
  );
  return fitting.some((template) => template.id === preferred.id)
    ? fitting
    : [preferred, ...fitting];
}

function relayoutPage(page: Page, publication: Publication, seed: number, smart: boolean): Page {
  if (page.kind !== "content") return structuredClone(page);
  const imageSlots = page.slots.filter((slot) => slot.type === "image");
  const templates = candidateTemplates(publication, imageSlots.length, smart);
  if (templates.length === 0) return structuredClone(page);
  const template = pick(templates, seededRandom(subSeed(seed, `layout:${page.id}`)));
  const rects = fitRects(template, publication.paper, imageSlots.length);
  let imageIndex = 0;
  return {
    ...structuredClone(page),
    layoutTemplateId: template.id,
    slots: page.slots.map((slot) => {
      if (slot.type !== "image") return structuredClone(slot);
      const rect = rects[imageIndex]!;
      imageIndex += 1;
      return { ...slot, rect, bleed: template.bleed };
    }),
  };
}

export function randomize(
  publication: Publication,
  level: RandomizeLevel,
  seed: number,
): Publication {
  const source = PublicationSchema.parse(publication);
  const result = structuredClone(source);
  const locked = new Set(source.lockedPageIds);

  if (level === "style" || level === "smart") {
    const styles = stylesForPublicationType(source.type);
    result.styleId = pick(styles, seededRandom(subSeed(seed, "style"))).id;
  }
  if (level === "layout" || level === "smart") {
    result.pages = source.pages.map((page) =>
      locked.has(page.id)
        ? structuredClone(page)
        : relayoutPage(page, source, seed, level === "smart"),
    );
  }
  result.seed = seed;
  return PublicationSchema.parse(result);
}
