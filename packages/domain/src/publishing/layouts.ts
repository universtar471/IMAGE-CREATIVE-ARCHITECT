/**
 * Layout templates (ADR-038) as normalized slot rectangles for A4, A3 and 16:9.
 *
 * Every page has three bands: a header band (headline/title), the content box (image
 * frames) and a footer band (captions). Templates only place image frames inside the
 * content box (or the whole page for a full-bleed hero), so re-laying out a page never
 * moves its text. A4 and A3 share the portrait geometry (both are 1:√2); 16:9 is landscape.
 */
import { z } from "zod";

import {
  LayoutTemplateIdSchema,
  NormalizedRectSchema,
  PaperSizeSchema,
  PublicationTypeSchema,
  type LayoutTemplateId,
  type NormalizedRect,
  type PaperSize,
  type PublicationType,
} from "./schemas";

export type Orientation = "portrait" | "landscape";

/** Physical page size in points (1 pt = 1/72 in). 16:9 is the 13.333 × 7.5 in slide. */
export const PAPER_DIMENSIONS_PT: Record<PaperSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
  "16:9": { width: 960, height: 540 },
};

/** Print papers are checked at print PPI; 16:9 is a screen format. */
export const PRINT_PAPERS: readonly PaperSize[] = ["A4", "A3"];

export function paperOrientation(paper: PaperSize): Orientation {
  const { width, height } = PAPER_DIMENSIONS_PT[paper];
  return width >= height ? "landscape" : "portrait";
}

export const HEADER_BAND: NormalizedRect = { x: 0.04, y: 0.015, w: 0.92, h: 0.07 };
export const CONTENT_BOX: NormalizedRect = { x: 0.04, y: 0.095, w: 0.92, h: 0.81 };
export const FOOTER_BAND: NormalizedRect = { x: 0.04, y: 0.915, w: 0.92, h: 0.07 };
export const FULL_PAGE: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 };

const GAP = 0.02;
const round = (value: number) => Math.round(value * 1e6) / 1e6;

const rect = (x: number, y: number, w: number, h: number): NormalizedRect =>
  NormalizedRectSchema.parse({ x: round(x), y: round(y), w: round(w), h: round(h) });

/** Maps a rectangle given in the unit square of `area` into page coordinates. */
export function placeIn(area: NormalizedRect, unit: NormalizedRect): NormalizedRect {
  return rect(area.x + unit.x * area.w, area.y + unit.y * area.h, unit.w * area.w, unit.h * area.h);
}

function gridUnits(columns: number, rows: number, count = columns * rows): NormalizedRect[] {
  const width = (1 - GAP * (columns - 1)) / columns;
  const height = (1 - GAP * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return rect(column * (width + GAP), row * (height + GAP), width, height);
  });
}

/**
 * `count` frames in a grid filling `area`, with cells close to 4:3 on the physical page.
 * Column count grows with the area's physical aspect ratio.
 */
export function gridIn(area: NormalizedRect, count: number, paper: PaperSize): NormalizedRect[] {
  if (count <= 0) return [];
  const { width, height } = PAPER_DIMENSIONS_PT[paper];
  const aspect = (area.w * width) / (area.h * height);
  const columns = Math.min(count, Math.max(1, Math.round(Math.sqrt((count * aspect) / (4 / 3)))));
  const rows = Math.ceil(count / columns);
  return gridUnits(columns, rows, count).map((unit) => placeIn(area, unit));
}

type TemplateDef = {
  id: LayoutTemplateId;
  name: string;
  supportedTypes: PublicationType[];
  minImages: number;
  maxImages: number;
  bleed?: boolean;
  /** Grid sized to the image count instead of fixed frames. */
  flexible?: boolean;
  /** Frames in the unit square of the content box (or the page for `bleed`). */
  units: Record<Orientation, NormalizedRect[]>;
  /** Keep the first `fixed` frames and grid the rest inside `area` (unit square). */
  overflow?: { fixed: number; always: boolean; area: Record<Orientation, NormalizedRect> };
};

const both = (units: NormalizedRect[]): Record<Orientation, NormalizedRect[]> => ({
  portrait: units,
  landscape: units,
});

const DEFS: readonly TemplateDef[] = [
  {
    id: "hero_full_page",
    name: "Hero full page",
    supportedTypes: ["portfolio", "magazine", "catalog", "concept_book"],
    minImages: 1,
    maxImages: 1,
    bleed: true,
    units: both([rect(0, 0, 1, 1)]),
  },
  {
    id: "hero_plus_secondary",
    name: "Hero plus secondary images",
    supportedTypes: ["portfolio", "magazine", "catalog"],
    minImages: 2,
    maxImages: 13,
    units: {
      portrait: [
        rect(0, 0, 1, 0.64),
        ...gridUnits(3, 1).map((u) => placeIn(rect(0, 0.66, 1, 0.34), u)),
      ],
      landscape: [
        rect(0, 0, 0.66, 1),
        ...gridUnits(1, 3).map((u) => placeIn(rect(0.68, 0, 0.32, 1), u)),
      ],
    },
    overflow: {
      fixed: 1,
      always: true,
      area: { portrait: rect(0, 0.66, 1, 0.34), landscape: rect(0.68, 0, 0.32, 1) },
    },
  },
  {
    id: "grid_2x2",
    name: "2 × 2 grid",
    supportedTypes: ["catalog", "concept_book", "portfolio"],
    minImages: 2,
    maxImages: 4,
    units: both(gridUnits(2, 2)),
  },
  {
    id: "grid_2x3",
    name: "2 × 3 grid",
    supportedTypes: ["catalog", "concept_book"],
    minImages: 3,
    maxImages: 6,
    units: { portrait: gridUnits(2, 3), landscape: gridUnits(3, 2) },
  },
  {
    id: "flexible_grid",
    name: "Flexible grid",
    supportedTypes: ["catalog", "concept_book", "portfolio"],
    minImages: 2,
    maxImages: 24,
    flexible: true,
    units: { portrait: gridUnits(3, 4), landscape: gridUnits(4, 3) },
  },
  {
    id: "split",
    name: "Split",
    supportedTypes: ["portfolio", "catalog", "concept_book", "magazine"],
    minImages: 1,
    maxImages: 2,
    units: {
      portrait: [rect(0, 0, 1, 0.49), rect(0, 0.51, 1, 0.49)],
      landscape: [rect(0, 0, 0.49, 1), rect(0.51, 0, 0.49, 1)],
    },
  },
  {
    id: "asymmetric_editorial",
    name: "Asymmetric editorial",
    supportedTypes: ["magazine", "concept_book", "portfolio"],
    minImages: 2,
    maxImages: 12,
    units: {
      portrait: [
        rect(0, 0, 0.66, 0.62),
        rect(0.68, 0, 0.32, 0.3),
        rect(0.68, 0.32, 0.32, 0.3),
        rect(0, 0.64, 0.49, 0.36),
        rect(0.51, 0.64, 0.49, 0.36),
      ],
      landscape: [
        rect(0, 0, 0.64, 0.78),
        rect(0.66, 0, 0.34, 0.38),
        rect(0.66, 0.4, 0.34, 0.38),
        rect(0, 0.8, 0.31, 0.2),
        rect(0.33, 0.8, 0.31, 0.2),
      ],
    },
    overflow: {
      fixed: 1,
      always: false,
      area: { portrait: rect(0, 0.64, 1, 0.36), landscape: rect(0.66, 0, 0.34, 1) },
    },
  },
  {
    id: "diagram_sheet",
    name: "Diagram sheet",
    supportedTypes: ["concept_book", "catalog"],
    minImages: 0,
    maxImages: 6,
    flexible: true,
    units: { portrait: gridUnits(2, 3), landscape: gridUnits(3, 2) },
  },
  {
    id: "dense_contact",
    name: "Dense contact (main frame + grouped thumbnails)",
    supportedTypes: ["concept_book", "catalog"],
    minImages: 4,
    maxImages: 21,
    units: {
      portrait: [
        rect(0, 0, 1, 0.5),
        ...gridUnits(3, 3).map((u) => placeIn(rect(0, 0.52, 1, 0.48), u)),
      ],
      landscape: [
        rect(0, 0, 0.48, 1),
        ...gridUnits(3, 3).map((u) => placeIn(rect(0.5, 0, 0.5, 1), u)),
      ],
    },
    overflow: {
      fixed: 1,
      always: true,
      area: { portrait: rect(0, 0.52, 1, 0.48), landscape: rect(0.5, 0, 0.5, 1) },
    },
  },
];

export const LayoutTemplateSchema = z.object({
  id: LayoutTemplateIdSchema,
  name: z.string().trim().min(1),
  supportedTypes: z.array(PublicationTypeSchema).min(1),
  minImages: z.number().int().min(0),
  maxImages: z.number().int().min(1),
  bleed: z.boolean(),
  flexible: z.boolean(),
  /** Image frames in page coordinates, per paper. */
  slotRects: z.record(PaperSizeSchema, z.array(NormalizedRectSchema).min(1)),
  overflow: z
    .object({
      fixed: z.number().int().min(0),
      always: z.boolean(),
      area: z.record(PaperSizeSchema, NormalizedRectSchema),
    })
    .nullable(),
});
export type LayoutTemplate = z.infer<typeof LayoutTemplateSchema>;

function build(def: TemplateDef): LayoutTemplate {
  const frame = def.bleed ? FULL_PAGE : CONTENT_BOX;
  const perPaper = <T>(make: (orientation: Orientation) => T): Record<PaperSize, T> => ({
    A4: make(paperOrientation("A4")),
    A3: make(paperOrientation("A3")),
    "16:9": make(paperOrientation("16:9")),
  });
  return LayoutTemplateSchema.parse({
    id: def.id,
    name: def.name,
    supportedTypes: def.supportedTypes,
    minImages: def.minImages,
    maxImages: def.maxImages,
    bleed: def.bleed ?? false,
    flexible: def.flexible ?? false,
    slotRects: perPaper((o) => def.units[o].map((unit) => placeIn(frame, unit))),
    overflow: def.overflow
      ? {
          fixed: def.overflow.fixed,
          always: def.overflow.always,
          area: perPaper((o) => placeIn(frame, def.overflow!.area[o])),
        }
      : null,
  });
}

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = DEFS.map(build);

export function getLayoutTemplate(id: LayoutTemplateId): LayoutTemplate {
  const template = LAYOUT_TEMPLATES.find((item) => item.id === id);
  if (!template) throw new Error(`Unknown layout template: ${id}`);
  return template;
}

export function layoutsForPublicationType(type: PublicationType): readonly LayoutTemplate[] {
  return LAYOUT_TEMPLATES.filter((template) => template.supportedTypes.includes(type));
}

/** Templates of a type that take `imageCount` images (content pages only). */
export function layoutsForImageCount(
  type: PublicationType,
  imageCount: number,
): readonly LayoutTemplate[] {
  return layoutsForPublicationType(type).filter(
    (template) =>
      template.id !== "diagram_sheet" &&
      imageCount >= template.minImages &&
      imageCount <= template.maxImages,
  );
}

/**
 * The image frames of `template` for `count` images on `paper`, in page coordinates.
 * Always returns exactly `count` rectangles.
 */
export function fitRects(
  template: LayoutTemplate,
  paper: PaperSize,
  count: number,
): NormalizedRect[] {
  if (count <= 0) return [];
  const fixedRects = template.slotRects[paper];
  if (template.flexible) return gridIn(template.bleed ? FULL_PAGE : CONTENT_BOX, count, paper);
  const overflow = template.overflow;
  if (overflow && count > overflow.fixed && (overflow.always || count > fixedRects.length)) {
    return [
      ...fixedRects.slice(0, overflow.fixed),
      ...gridIn(overflow.area[paper], count - overflow.fixed, paper),
    ];
  }
  if (count <= fixedRects.length) return fixedRects.slice(0, count);
  return gridIn(CONTENT_BOX, count, paper);
}
