import { z } from "zod";

import {
  LAYOUT_MODES,
  NormalizedRectSchema,
  PaperSizeSchema,
  PublicationTypeSchema,
  type LayoutMode,
  type NormalizedRect,
  type PaperSize,
  type PublicationType,
} from "./schemas";

const rect = (x: number, y: number, w: number, h: number): NormalizedRect =>
  NormalizedRectSchema.parse({ x, y, w, h });

const repeatGrid = (columns: number, rows: number, gap = 0.025): NormalizedRect[] => {
  const width = (1 - gap * (columns + 1)) / columns;
  const height = (1 - gap * (rows + 1)) / rows;
  return Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return rect(gap + column * (width + gap), gap + row * (height + gap), width, height);
  });
};

const templateRects = (make: () => NormalizedRect[]): Record<PaperSize, NormalizedRect[]> => ({
  A4: make(),
  A3: make(),
  "16:9": make(),
});

export const LayoutTemplateSchema = z.object({
  id: z.enum(LAYOUT_MODES),
  name: z.string().trim().min(1),
  supportedTypes: z.array(PublicationTypeSchema).min(1),
  slotRects: z.record(PaperSizeSchema, z.array(NormalizedRectSchema).min(1)),
});
export type LayoutTemplate = z.infer<typeof LayoutTemplateSchema>;

const heroPlusSecondaryRects = () => [
  rect(0.04, 0.04, 0.61, 0.92),
  ...Array.from({ length: 9 }, (_, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    return rect(0.69 + column * 0.095, 0.04 + row * 0.31, 0.08, 0.26);
  }),
];

const denseContactRects = () => [
  rect(0.04, 0.08, 0.43, 0.84),
  ...repeatGrid(3, 3, 0.025).map((item) =>
    rect(0.52 + item.x * 0.44, 0.08 + item.y * 0.84, item.w * 0.88, item.h * 0.84),
  ),
];

export const LAYOUT_TEMPLATES: readonly LayoutTemplate[] = [
  LayoutTemplateSchema.parse({
    id: "hero_full_page",
    name: "Hero full page",
    supportedTypes: ["portfolio", "magazine"],
    slotRects: templateRects(() => [rect(0, 0, 1, 1)]),
  }),
  LayoutTemplateSchema.parse({
    id: "hero_plus_secondary",
    name: "Hero plus secondary images",
    supportedTypes: ["portfolio", "magazine"],
    slotRects: templateRects(heroPlusSecondaryRects),
  }),
  LayoutTemplateSchema.parse({
    id: "grid_2x2",
    name: "2 x 2 grid",
    supportedTypes: ["catalog", "concept_book"],
    slotRects: templateRects(() => repeatGrid(2, 2)),
  }),
  LayoutTemplateSchema.parse({
    id: "grid_2x3",
    name: "2 x 3 grid",
    supportedTypes: ["catalog", "concept_book"],
    slotRects: templateRects(() => repeatGrid(3, 2)),
  }),
  LayoutTemplateSchema.parse({
    id: "flexible_grid",
    name: "Flexible grid",
    supportedTypes: ["catalog", "concept_book", "portfolio"],
    slotRects: templateRects(() => repeatGrid(4, 3, 0.02)),
  }),
  LayoutTemplateSchema.parse({
    id: "split",
    name: "Split",
    supportedTypes: ["portfolio", "catalog", "concept_book"],
    slotRects: templateRects(() => [rect(0.04, 0.04, 0.44, 0.92), rect(0.54, 0.12, 0.42, 0.76)]),
  }),
  LayoutTemplateSchema.parse({
    id: "asymmetric_editorial",
    name: "Asymmetric editorial",
    supportedTypes: ["magazine", "concept_book"],
    slotRects: templateRects(() => [
      rect(0.04, 0.08, 0.58, 0.72),
      rect(0.67, 0.08, 0.29, 0.29),
      rect(0.67, 0.42, 0.29, 0.29),
      rect(0.04, 0.84, 0.28, 0.1),
      rect(0.37, 0.84, 0.28, 0.1),
    ]),
  }),
  LayoutTemplateSchema.parse({
    id: "diagram_sheet",
    name: "Diagram sheet",
    supportedTypes: ["concept_book", "catalog"],
    slotRects: templateRects(() => repeatGrid(3, 2)),
  }),
  LayoutTemplateSchema.parse({
    id: "dense_contact",
    name: "Dense contact",
    supportedTypes: ["concept_book", "catalog"],
    slotRects: templateRects(denseContactRects),
  }),
] as const;

export const LAYOUT_TEMPLATE_IDS = LAYOUT_TEMPLATES.map((template) => template.id);

export function getLayoutTemplate(id: LayoutMode): LayoutTemplate {
  return LAYOUT_TEMPLATES.find((template) => template.id === id) ?? LAYOUT_TEMPLATES[0]!;
}

export function layoutsForPublicationType(type: PublicationType): readonly LayoutTemplate[] {
  return LAYOUT_TEMPLATES.filter((template) => template.supportedTypes.includes(type));
}

export function fitRects(
  template: LayoutTemplate,
  paper: PaperSize,
  count: number,
): NormalizedRect[] {
  if (count <= 0) return [];
  const available = template.slotRects[paper];
  if (count <= available.length) return available.slice(0, count);

  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return repeatGrid(columns, rows, 0.02).slice(0, count);
}
