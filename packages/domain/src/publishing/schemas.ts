/**
 * Publishing Studio data model (SRS §11, ADR-038).
 *
 * A `Publication` is a fully planned book: exactly `targetPageCount` pages, each page a list
 * of slots (`image | text | caption`) in normalized page coordinates. Images are pinned by
 * `assetId` + `sourceHash`, so a later render of the same asset never changes an old
 * publication (SRS §11.5).
 */
import { z } from "zod";

import { EvidenceStatusSchema } from "../facts/evidence";

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

/** Layout templates (ADR-038). */
export const LAYOUT_TEMPLATE_IDS = [
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
export const LayoutTemplateIdSchema = z.enum(LAYOUT_TEMPLATE_IDS);
export type LayoutTemplateId = z.infer<typeof LayoutTemplateIdSchema>;

/** `auto` lets the planner pick per publication type; any template id forces that template. */
export const LAYOUT_MODES = ["auto", ...LAYOUT_TEMPLATE_IDS] as const;
export const LayoutModeSchema = z.enum(LAYOUT_MODES);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const PAGE_KINDS = ["cover", "content", "text", "diagram"] as const;
export const PageKindSchema = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof PageKindSchema>;

/** Content groups of a Concept Book page (SRS §11.3); `general` means no group evidence. */
export const IMAGE_GROUPS = ["context", "massing", "space", "detail", "general"] as const;
export const ImageGroupSchema = z.enum(IMAGE_GROUPS);
export type ImageGroup = z.infer<typeof ImageGroupSchema>;

export const TextSlotRoleSchema = z.enum([
  "headline",
  "subheadline",
  "body",
  "pull_quote",
  "label",
  "chapter",
]);
export type TextSlotRole = z.infer<typeof TextSlotRoleSchema>;

/** Caption evidence class (SRS §11.4). */
export const TEXT_KINDS = ["technical", "editorial", "commercial"] as const;
export const TextKindSchema = z.enum(TEXT_KINDS);
export type TextKind = z.infer<typeof TextKindSchema>;

const EPS = 1e-9;

/** A rectangle in page fractions: (0,0) is the top-left corner, (1,1) the bottom-right. */
export const NormalizedRectSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    w: z.number().finite().gt(0).max(1),
    h: z.number().finite().gt(0).max(1),
  })
  .refine((rect) => rect.x + rect.w <= 1 + EPS && rect.y + rect.h <= 1 + EPS, {
    message: "Normalized rectangle must stay inside the page.",
  });
export type NormalizedRect = z.infer<typeof NormalizedRectSchema>;

export const AssetPinSchema = z.object({
  assetId: nonEmpty,
  sourceHash: nonEmpty,
});
export type AssetPin = z.infer<typeof AssetPinSchema>;

/**
 * What the planner and the validator know about an image. `group` is evidence (set by the
 * user or a confirmed classifier); the planner never guesses it. `importance` (0..1) ranks
 * images for the hero frame and for `ai_select`.
 */
export const PublicationAssetSchema = AssetPinSchema.extend({
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  group: ImageGroupSchema.optional(),
  label: nonEmpty.optional(),
  importance: z.number().min(0).max(1).optional(),
});
export type PublicationAsset = z.infer<typeof PublicationAssetSchema>;

/** A project fact a caption sentence may cite. Only `verified`/`user_declared` count. */
export const PublicationFactSchema = z.object({
  id: nonEmpty,
  text: nonEmpty,
  status: EvidenceStatusSchema,
  sourceAssetIds: z.array(nonEmpty).default([]),
});
export type PublicationFact = z.infer<typeof PublicationFactSchema>;

export const CaptionSentenceSchema = z.object({
  text: z.string(),
  /** Id of a confirmed `PublicationFact` backing this sentence. */
  factRef: nonEmpty.nullable().default(null),
  /** True when the sentence states a claim with no confirmed fact behind it. */
  needs_review: z.boolean().default(false),
});
export type CaptionSentence = z.infer<typeof CaptionSentenceSchema>;

export const CaptionSlotSchema = z.object({
  textKind: TextKindSchema,
  sentences: z.array(CaptionSentenceSchema),
  /** True when any sentence needs review. */
  needs_review: z.boolean().default(false),
  wordLimit: z.number().int().positive().optional(),
  /** Images this caption describes (a Concept group caption lists the whole group). */
  imageAssetIds: z.array(nonEmpty).default([]),
  group: ImageGroupSchema.optional(),
});
export type CaptionSlot = z.infer<typeof CaptionSlotSchema>;

const SlotBaseSchema = z.object({
  id: nonEmpty,
  rect: NormalizedRectSchema,
});

export const ImageSlotSchema = SlotBaseSchema.extend({
  type: z.literal("image"),
  assetId: nonEmpty,
  sourceHash: nonEmpty,
  /** `cover` crops to fill the frame; `contain` letterboxes. */
  fit: z.enum(["cover", "contain"]).default("cover"),
  /** Full-bleed frames ignore the page margins. */
  bleed: z.boolean().default(false),
  /** The dominant/hero frame of the page. */
  primary: z.boolean().default(false),
  group: ImageGroupSchema.default("general"),
  label: nonEmpty.optional(),
});
export type ImageSlot = z.infer<typeof ImageSlotSchema>;

export const TextSlotSchema = SlotBaseSchema.extend({
  type: z.literal("text"),
  text: z.string(),
  role: TextSlotRoleSchema.default("body"),
  fontSizePt: positiveNumber.optional(),
  /** Confirmed fact backing a factual claim in this text, if any. */
  factRef: nonEmpty.nullable().default(null),
  /** An empty frame the user (or the caption step) still has to fill. */
  placeholder: z.boolean().default(false),
});
export type TextSlot = z.infer<typeof TextSlotSchema>;

export const CaptionPageSlotSchema = SlotBaseSchema.extend({
  type: z.literal("caption"),
  caption: CaptionSlotSchema,
  fontSizePt: positiveNumber.optional(),
});
export type CaptionPageSlot = z.infer<typeof CaptionPageSlotSchema>;

export const PageSlotSchema = z.discriminatedUnion("type", [
  ImageSlotSchema,
  TextSlotSchema,
  CaptionPageSlotSchema,
]);
export type PageSlot = z.infer<typeof PageSlotSchema>;

export const PageSchema = z.object({
  id: nonEmpty,
  index: z.number().int().min(0),
  kind: PageKindSchema,
  /** The image layout; null for cover and text pages without image frames. */
  layoutTemplateId: LayoutTemplateIdSchema.nullable(),
  slots: z.array(PageSlotSchema),
  /** Planner notes for the UI, e.g. `dense_page_suggest_a3_or_digital`. */
  warnings: z.array(nonEmpty).default([]),
});
export type Page = z.infer<typeof PageSchema>;

export const PublicationInputSchema = z.object({
  /** Images in the user's order. Every id must have a record in `assets`. */
  selectedImageIds: z.array(nonEmpty),
  assets: z.array(PublicationAssetSchema),
  targetPageCount: z.number().int().min(1),
  selectionMode: SelectionModeSchema,
  type: PublicationTypeSchema,
  paper: PaperSizeSchema,
  textDensity: TextDensitySchema.default("balanced"),
  styleId: nonEmpty,
  layoutMode: LayoutModeSchema.default("auto"),
  seed: z.number().int(),
  lockedPageIds: z.array(nonEmpty).default([]),
  /** Intentional repeats: the cover may reuse the hero image (SRS §11.3). */
  allowImageRepeat: z.boolean().default(false),
  title: z.string().default(""),
});
export type PublicationInput = z.input<typeof PublicationInputSchema>;
export type ParsedPublicationInput = z.output<typeof PublicationInputSchema>;

export const PublicationSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().default(""),
  targetPageCount: z.number().int().min(1),
  selectionMode: SelectionModeSchema,
  type: PublicationTypeSchema,
  paper: PaperSizeSchema,
  textDensity: TextDensitySchema,
  styleId: nonEmpty,
  layoutMode: LayoutModeSchema,
  seed: z.number().int(),
  lockedPageIds: z.array(nonEmpty),
  allowImageRepeat: z.boolean().default(false),
  selectedImageIds: z.array(nonEmpty),
  /** Pins of every selected image (placed or omitted by `ai_select`). */
  assetPins: z.array(AssetPinSchema),
  /** Why each selected image was placed or omitted, keyed by asset id. */
  selectionReasons: z.record(z.string(), z.string()),
  pages: z.array(PageSchema),
});
export type Publication = z.infer<typeof PublicationSchema>;
