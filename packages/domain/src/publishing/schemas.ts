import { z } from "zod";

const nonEmpty = z.string().trim().min(1);
const positiveNumber = z.number().finite().gt(0);

export const PUBLICATION_TYPES = ["portfolio", "catalog", "concept_book", "magazine"] as const;
export const PublicationTypeSchema = z.enum(PUBLICATION_TYPES);
export type PublicationType = z.infer<typeof PublicationTypeSchema>;

export const PAPER_SIZES = ["A4", "A3", "16:9"] as const;
export const PaperSizeSchema = z.enum(PAPER_SIZES);
export type PaperSize = z.infer<typeof PaperSizeSchema>;

export const SELECTION_MODES = ["include_all", "ai_select"] as const;
export const SelectionModeSchema = z.enum(SELECTION_MODES);
export type SelectionMode = z.infer<typeof SelectionModeSchema>;

export const TEXT_DENSITIES = ["sparse", "balanced", "dense"] as const;
export const TextDensitySchema = z.enum(TEXT_DENSITIES);
export type TextDensity = z.infer<typeof TextDensitySchema>;

export const LAYOUT_MODES = [
  "auto",
  "hero_full_page",
  "hero_plus_secondary",
  "grid_2x2",
  "grid_2x3",
  "flexible_grid",
  "split",
  "asymmetric_editorial",
  "diagram_sheet",
  "dense_contact",
] as const;
export const LayoutModeSchema = z.enum(LAYOUT_MODES);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const PAGE_KINDS = ["cover", "content", "text", "diagram"] as const;
export const PageKindSchema = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKindSchema>;

export const TextSlotRoleSchema = z.enum([
  "headline",
  "subheadline",
  "body",
  "pull_quote",
  "label",
  "chapter",
]);
export type TextSlotRole = z.infer<typeof TextSlotRoleSchema>;

export const TextKindSchema = z.enum(["technical", "editorial", "commercial"]);
export type TextKind = z.infer<typeof TextKindSchema>;

export const NormalizedRectSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    w: z.number().finite().gt(0).max(1),
    h: z.number().finite().gt(0).max(1),
  })
  .refine((rect) => rect.x + rect.w <= 1 && rect.y + rect.h <= 1, {
    message: "Normalized rectangle must stay inside the page.",
  });
export type NormalizedRect = z.infer<typeof NormalizedRectSchema>;

export const AssetPinSchema = z.object({
  assetId: nonEmpty,
  sourceHash: nonEmpty,
});
export type AssetPin = z.infer<typeof AssetPinSchema>;

export const SelectedImageSchema = z.union([nonEmpty, AssetPinSchema]);
export type SelectedImage = z.infer<typeof SelectedImageSchema>;

export const PublicationFactSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  status: z.enum(["verified", "user_declared", "inferred", "unknown"]).default("verified"),
  sourceAssetIds: z.array(nonEmpty).default([]),
});
export type PublicationFact = z.infer<typeof PublicationFactSchema>;

export const CaptionSentenceSchema = z.object({
  text: z.string(),
  factRef: nonEmpty.nullable().optional(),
  needs_review: z.boolean().default(false),
});
export type CaptionSentence = z.infer<typeof CaptionSentenceSchema>;

export const CaptionSlotSchema = z.object({
  id: nonEmpty.optional(),
  textKind: TextKindSchema,
  sentences: z.array(CaptionSentenceSchema),
  needs_review: z.boolean().default(false),
  wordLimit: z.number().int().positive().optional(),
});
export type CaptionSlot = z.infer<typeof CaptionSlotSchema>;

const SlotBaseSchema = z.object({
  id: nonEmpty,
  rect: NormalizedRectSchema,
  overflow: z.boolean().default(false),
});

export const ImageSlotSchema = SlotBaseSchema.extend({
  type: z.literal("image"),
  assetId: nonEmpty,
  sourceHash: nonEmpty,
  label: nonEmpty.optional(),
  group: z.enum(["context", "massing", "space", "detail", "general"]).default("general"),
  selectionReason: nonEmpty.optional(),
  safeCrop: z.boolean().default(true),
});
export type ImageSlot = z.infer<typeof ImageSlotSchema>;

export const TextSlotSchema = SlotBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  role: TextSlotRoleSchema.default("body"),
  fontSizePt: positiveNumber.optional(),
});
export type TextSlot = z.infer<typeof TextSlotSchema>;

export const CaptionSlotEntrySchema = SlotBaseSchema.extend({
  type: z.literal("caption"),
  caption: CaptionSlotSchema,
  fontSizePt: positiveNumber.optional(),
});
export type CaptionSlotEntry = z.infer<typeof CaptionSlotEntrySchema>;

export const PageSlotSchema = z.discriminatedUnion("type", [
  ImageSlotSchema,
  TextSlotSchema,
  CaptionSlotEntrySchema,
]);
export type PageSlot = z.infer<typeof PageSlotSchema>;

export const PageSchema = z.object({
  id: nonEmpty,
  index: z.number().int().min(0),
  kind: PageKindSchema,
  layoutTemplateId: nonEmpty,
  slots: z.array(PageSlotSchema),
  warnings: z.array(nonEmpty).default([]),
});
export type Page = z.infer<typeof PageSchema>;

export const PublicationInputSchema = z.object({
  selectedImageIds: z.array(SelectedImageSchema),
  targetPageCount: z.number().int().min(1),
  selectionMode: SelectionModeSchema,
  type: PublicationTypeSchema,
  paper: PaperSizeSchema,
  textDensity: TextDensitySchema,
  styleId: nonEmpty,
  layoutMode: LayoutModeSchema,
  seed: z.number().int(),
  lockedPageIds: z.array(nonEmpty).default([]),
  allowImageRepeat: z.boolean().default(false),
});
export type PublicationInput = z.infer<typeof PublicationInputSchema>;

export const PublicationSchema = z.object({
  schemaVersion: z.literal(1),
  targetPageCount: z.number().int().min(1),
  selectionMode: SelectionModeSchema,
  type: PublicationTypeSchema,
  paper: PaperSizeSchema,
  textDensity: TextDensitySchema,
  styleId: nonEmpty,
  layoutMode: LayoutModeSchema,
  seed: z.number().int(),
  lockedPageIds: z.array(nonEmpty),
  assetPins: z.array(AssetPinSchema),
  selectionReasons: z.record(nonEmpty, z.string()),
  pages: z.array(PageSchema),
});
export type Publication = z.infer<typeof PublicationSchema>;

export const PublicationAssetSchema = z.object({
  assetId: nonEmpty,
  sourceHash: nonEmpty.optional(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
});
export type PublicationAsset = z.infer<typeof PublicationAssetSchema>;

export type PublicationValidationIssue = {
  code:
    | "PAGE_COUNT_MISMATCH"
    | "REQUIRED_IMAGE_MISSING"
    | "PRINT_READABILITY_LOW"
    | "UNVERIFIED_PUBLICATION_FACT";
  severity: "BLOCK" | "WARN";
  path: string;
  messageKey: `conflicts.${PublicationValidationIssue["code"]}`;
  params: Record<string, string | number | boolean>;
};

export type PublicationValidation = {
  verdict: "BLOCK" | "WARN" | "ALLOW";
  issues: PublicationValidationIssue[];
  validatorVersion: string;
};
