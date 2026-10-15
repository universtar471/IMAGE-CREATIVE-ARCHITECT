import { z } from "zod";

import { PublicationTypeSchema, type PublicationType } from "./schemas";

export const PublicationStyleSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: PublicationTypeSchema,
  palette: z.object({
    background: z.string().trim().min(1),
    foreground: z.string().trim().min(1),
    accent: z.string().trim().min(1),
    muted: z.string().trim().min(1),
  }),
  fontFamilies: z.object({
    display: z.array(z.string().trim().min(1)).min(1),
    body: z.array(z.string().trim().min(1)).min(1),
  }),
  typeScale: z.object({
    cover: z.number().positive(),
    title: z.number().positive(),
    subtitle: z.number().positive(),
    body: z.number().positive(),
    caption: z.number().positive(),
    label: z.number().positive(),
    minimum: z.number().positive(),
  }),
  spacing: z.object({
    unit: z.number().positive(),
    gutter: z.number().positive(),
    paragraph: z.number().positive(),
  }),
  margins: z.object({
    top: z.number().min(0),
    right: z.number().min(0),
    bottom: z.number().min(0),
    left: z.number().min(0),
  }),
  divider: z.object({
    enabled: z.boolean(),
    style: z.enum(["none", "line", "rule", "accent"]),
    weight: z.number().min(0),
  }),
  caption: z.object({
    position: z.enum(["below", "beside", "overlay"]),
    uppercase: z.boolean(),
    maxLines: z.number().int().positive(),
  }),
  cover: z.object({
    enabled: z.boolean(),
    treatment: z.enum(["image", "typographic", "editorial"]),
    showTitle: z.boolean(),
  }),
});
export type PublicationStyle = z.infer<typeof PublicationStyleSchema>;

const style = (
  id: string,
  name: string,
  type: PublicationType,
  palette: PublicationStyle["palette"],
  fontFamilies: PublicationStyle["fontFamilies"],
  typeScale: PublicationStyle["typeScale"],
  options: Pick<PublicationStyle, "spacing" | "margins" | "divider" | "caption" | "cover">,
): PublicationStyle =>
  PublicationStyleSchema.parse({
    id,
    name,
    type,
    palette,
    fontFamilies,
    typeScale,
    ...options,
  });

const sans = ["Inter", "Arial", "sans-serif"];
const serif = ["Cormorant Garamond", "Georgia", "serif"];
const mono = ["IBM Plex Mono", "Consolas", "monospace"];
const neutralSpacing = { unit: 4, gutter: 12, paragraph: 8 };
const neutralMargins = { top: 18, right: 18, bottom: 18, left: 18 };
const lineDivider = { enabled: true, style: "line" as const, weight: 0.5 };
const noDivider = { enabled: false, style: "none" as const, weight: 0 };

const minimalScale = {
  cover: 44,
  title: 28,
  subtitle: 16,
  body: 10,
  caption: 8,
  label: 7,
  minimum: 7,
};
const editorialScale = {
  cover: 56,
  title: 34,
  subtitle: 19,
  body: 11,
  caption: 8.5,
  label: 7.5,
  minimum: 7,
};

export const PUBLICATION_STYLES: readonly PublicationStyle[] = [
  style(
    "portfolio_minimal_white",
    "Minimal White",
    "portfolio",
    { background: "#FFFFFF", foreground: "#171717", accent: "#171717", muted: "#737373" },
    { display: sans, body: sans },
    minimalScale,
    {
      spacing: neutralSpacing,
      margins: neutralMargins,
      divider: lineDivider,
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "image", showTitle: true },
    },
  ),
  style(
    "portfolio_warm_beige",
    "Warm Beige",
    "portfolio",
    { background: "#F4EFE7", foreground: "#302B27", accent: "#A65A3A", muted: "#8A7B70" },
    { display: serif, body: sans },
    { ...minimalScale, cover: 48, title: 30 },
    {
      spacing: { unit: 4, gutter: 14, paragraph: 9 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      divider: { enabled: true, style: "accent", weight: 1 },
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "typographic", showTitle: true },
    },
  ),
  style(
    "portfolio_dark_luxury",
    "Dark Luxury",
    "portfolio",
    { background: "#171717", foreground: "#F5F5F0", accent: "#D6B36A", muted: "#A3A3A3" },
    { display: serif, body: sans },
    { ...minimalScale, cover: 48, title: 30, minimum: 8 },
    {
      spacing: { unit: 4, gutter: 13, paragraph: 8 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      divider: { enabled: true, style: "accent", weight: 0.75 },
      caption: { position: "overlay", uppercase: true, maxLines: 2 },
      cover: { enabled: true, treatment: "image", showTitle: true },
    },
  ),
  style(
    "portfolio_earth_tones",
    "Earth Tones",
    "portfolio",
    { background: "#E9E3D6", foreground: "#30332B", accent: "#65734E", muted: "#7D806F" },
    { display: sans, body: serif },
    { ...minimalScale, title: 27 },
    {
      spacing: { unit: 4, gutter: 14, paragraph: 9 },
      margins: { top: 19, right: 19, bottom: 19, left: 19 },
      divider: lineDivider,
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "image", showTitle: true },
    },
  ),
  style(
    "catalog_corporate_blue",
    "Corporate Blue",
    "catalog",
    { background: "#F7F9FC", foreground: "#152238", accent: "#2563A8", muted: "#607089" },
    { display: sans, body: sans },
    { cover: 40, title: 24, subtitle: 14, body: 9.5, caption: 7.5, label: 7, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 9, paragraph: 6 },
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      divider: lineDivider,
      caption: { position: "below", uppercase: false, maxLines: 2 },
      cover: { enabled: true, treatment: "typographic", showTitle: true },
    },
  ),
  style(
    "catalog_modern_grid",
    "Modern Grid",
    "catalog",
    { background: "#FFFFFF", foreground: "#202020", accent: "#E4572E", muted: "#777777" },
    { display: sans, body: sans },
    { cover: 42, title: 25, subtitle: 14, body: 9.5, caption: 7.5, label: 7, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 8, paragraph: 6 },
      margins: { top: 14, right: 14, bottom: 14, left: 14 },
      divider: { enabled: true, style: "rule", weight: 1 },
      caption: { position: "below", uppercase: true, maxLines: 2 },
      cover: { enabled: true, treatment: "typographic", showTitle: true },
    },
  ),
  style(
    "catalog_premium_gold",
    "Premium Gold",
    "catalog",
    { background: "#F5F0E6", foreground: "#25211B", accent: "#A47A2C", muted: "#817661" },
    { display: serif, body: sans },
    { cover: 42, title: 25, subtitle: 14, body: 9.5, caption: 7.5, label: 7, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 10, paragraph: 6 },
      margins: { top: 16, right: 16, bottom: 16, left: 16 },
      divider: { enabled: true, style: "accent", weight: 0.75 },
      caption: { position: "below", uppercase: false, maxLines: 2 },
      cover: { enabled: true, treatment: "image", showTitle: true },
    },
  ),
  style(
    "catalog_urban_grey",
    "Urban Grey",
    "catalog",
    { background: "#E7E9EA", foreground: "#25292B", accent: "#59656B", muted: "#7A8285" },
    { display: sans, body: mono },
    { cover: 40, title: 24, subtitle: 14, body: 9, caption: 7.5, label: 7, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 9, paragraph: 6 },
      margins: { top: 15, right: 15, bottom: 15, left: 15 },
      divider: lineDivider,
      caption: { position: "below", uppercase: true, maxLines: 2 },
      cover: { enabled: true, treatment: "typographic", showTitle: true },
    },
  ),
  style(
    "concept_architectural_red",
    "Architectural Red",
    "concept_book",
    { background: "#F6F2ED", foreground: "#282321", accent: "#A64332", muted: "#796E68" },
    { display: sans, body: serif },
    editorialScale,
    {
      spacing: { unit: 4, gutter: 14, paragraph: 10 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      divider: { enabled: true, style: "accent", weight: 1 },
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "editorial", showTitle: true },
    },
  ),
  style(
    "concept_blueprint_blue",
    "Blueprint Blue",
    "concept_book",
    { background: "#102D4E", foreground: "#F2F4F7", accent: "#8CC9E8", muted: "#B4C5D2" },
    { display: sans, body: mono },
    { ...editorialScale, body: 10, caption: 8, minimum: 7.5 },
    {
      spacing: { unit: 4, gutter: 12, paragraph: 8 },
      margins: { top: 18, right: 18, bottom: 18, left: 18 },
      divider: { enabled: true, style: "line", weight: 0.5 },
      caption: { position: "below", uppercase: true, maxLines: 3 },
      cover: { enabled: true, treatment: "typographic", showTitle: true },
    },
  ),
  style(
    "concept_concrete_grey",
    "Concrete Grey",
    "concept_book",
    { background: "#D8D5D0", foreground: "#282828", accent: "#565656", muted: "#707070" },
    { display: sans, body: sans },
    { ...editorialScale, cover: 48, title: 31 },
    {
      spacing: { unit: 4, gutter: 13, paragraph: 9 },
      margins: { top: 19, right: 19, bottom: 19, left: 19 },
      divider: lineDivider,
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "image", showTitle: true },
    },
  ),
  style(
    "concept_natural_green",
    "Natural Green",
    "concept_book",
    { background: "#EDF0E8", foreground: "#253126", accent: "#54745C", muted: "#748274" },
    { display: serif, body: sans },
    { ...editorialScale, title: 31 },
    {
      spacing: { unit: 4, gutter: 14, paragraph: 10 },
      margins: { top: 20, right: 20, bottom: 20, left: 20 },
      divider: { enabled: true, style: "accent", weight: 0.75 },
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "editorial", showTitle: true },
    },
  ),
  style(
    "magazine_editorial_black",
    "Editorial Black",
    "magazine",
    { background: "#FFFFFF", foreground: "#111111", accent: "#111111", muted: "#6D6D6D" },
    { display: serif, body: sans },
    { cover: 64, title: 40, subtitle: 20, body: 11, caption: 8, label: 7.5, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 16, paragraph: 10 },
      margins: { top: 18, right: 18, bottom: 18, left: 18 },
      divider: noDivider,
      caption: { position: "overlay", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "editorial", showTitle: true },
    },
  ),
  style(
    "magazine_vogue_minimal",
    "Vogue Minimal",
    "magazine",
    { background: "#F6F3EE", foreground: "#252322", accent: "#9D2B39", muted: "#817873" },
    { display: serif, body: serif },
    { cover: 62, title: 38, subtitle: 19, body: 11, caption: 8, label: 7.5, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 15, paragraph: 10 },
      margins: { top: 19, right: 19, bottom: 19, left: 19 },
      divider: { enabled: true, style: "line", weight: 0.5 },
      caption: { position: "below", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "typographic", showTitle: true },
    },
  ),
  style(
    "magazine_contemporary_art",
    "Contemporary Art",
    "magazine",
    { background: "#F3F1E9", foreground: "#202020", accent: "#C65A34", muted: "#77756B" },
    { display: sans, body: sans },
    { cover: 60, title: 37, subtitle: 19, body: 10.5, caption: 8, label: 7.5, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 16, paragraph: 10 },
      margins: { top: 18, right: 18, bottom: 18, left: 18 },
      divider: { enabled: true, style: "accent", weight: 1 },
      caption: { position: "beside", uppercase: false, maxLines: 3 },
      cover: { enabled: true, treatment: "editorial", showTitle: true },
    },
  ),
  style(
    "magazine_retro_modern",
    "Retro Modern",
    "magazine",
    { background: "#F0E4D0", foreground: "#272421", accent: "#2C6E70", muted: "#7D7568" },
    { display: sans, body: serif },
    { cover: 58, title: 36, subtitle: 18, body: 10.5, caption: 8, label: 7.5, minimum: 7 },
    {
      spacing: { unit: 4, gutter: 14, paragraph: 9 },
      margins: { top: 18, right: 18, bottom: 18, left: 18 },
      divider: { enabled: true, style: "rule", weight: 1 },
      caption: { position: "below", uppercase: true, maxLines: 3 },
      cover: { enabled: true, treatment: "image", showTitle: true },
    },
  ),
] as const;

export const PUBLICATION_STYLE_IDS = PUBLICATION_STYLES.map((item) => item.id);

export function getPublicationStyle(styleId: string): PublicationStyle {
  return (
    PUBLICATION_STYLES.find((item) => item.id === styleId) ??
    PUBLICATION_STYLES.find((item) => item.type === "portfolio")!
  );
}

export function stylesForPublicationType(type: PublicationType): readonly PublicationStyle[] {
  return PUBLICATION_STYLES.filter((item) => item.type === type);
}
