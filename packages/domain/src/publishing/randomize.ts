import { fitRects, layoutsForPublicationType, type LayoutTemplate } from "./layouts";
import { PUBLICATION_STYLES, stylesForPublicationType } from "./styles";
import { PublicationSchema, type Page, type Publication } from "./schemas";

export type RandomizeLevel = "style" | "layout" | "smart";

function seededRandom(seed: number) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clonePublication(publication: Publication): Publication {
  return structuredClone(publication);
}

function randomStyleId(publication: Publication, random: () => number): string {
  const styles = stylesForPublicationType(publication.type);
  if (styles.length <= 1) return styles[0]?.id ?? publication.styleId;
  const currentIndex = styles.findIndex((style) => style.id === publication.styleId);
  const offset = 1 + Math.floor(random() * (styles.length - 1));
  return styles[(Math.max(0, currentIndex) + offset) % styles.length]?.id ?? styles[0]!.id;
}

function randomTemplate(
  page: Page,
  publication: Publication,
  random: () => number,
): LayoutTemplate {
  const templates = layoutsForPublicationType(publication.type);
  if (templates.length <= 1) return templates[0]!;
  const currentIndex = templates.findIndex((template) => template.id === page.layoutTemplateId);
  const offset = 1 + Math.floor(random() * (templates.length - 1));
  return templates[(Math.max(0, currentIndex) + offset) % templates.length] ?? templates[0]!;
}

function relayoutPage(page: Page, publication: Publication, random: () => number): Page {
  const template = randomTemplate(page, publication, random);
  const rects = fitRects(template, publication.paper, page.slots.length);
  return {
    ...page,
    layoutTemplateId: template.id,
    slots: page.slots.map((slot, index) => ({ ...slot, rect: rects[index]! })),
  };
}

export function randomize(
  publication: Publication,
  level: RandomizeLevel,
  seed: number,
): Publication {
  const source = PublicationSchema.parse(publication);
  const result = clonePublication(source);
  const random = seededRandom(seed);
  const locked = new Set(source.lockedPageIds);

  if (level === "style" || level === "smart") {
    result.styleId = randomStyleId(source, random);
  }
  if (level === "layout" || level === "smart") {
    result.pages = source.pages.map((page) =>
      locked.has(page.id) ? structuredClone(page) : relayoutPage(page, source, random),
    );
  }

  result.seed = seed;
  return PublicationSchema.parse(result);
}

export const RANDOMIZABLE_STYLE_COUNT = PUBLICATION_STYLES.length;
