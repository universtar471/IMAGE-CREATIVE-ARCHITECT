/**
 * Space Catalog V3 converter (ADR-034 P1a, amendments 1 and 2).
 *
 *   npm run catalog:build
 *
 * Reads the user's raw V3 catalog (`source/building-space-catalog-v3.json`, stored verbatim)
 * and the curated English labels (`label-en.json`), and writes
 * `knowledge/space-catalog/catalog.json`.
 *
 * - Only the allowlisted archetypes are imported; every other record is skipped, not stored.
 * - A curated label replaces the record's `labelEn` and every occurrence of the old label in
 *   its `englishPrompt`.
 * - The build fails when English output still contains non-ASCII text or an unaccented
 *   Vietnamese label, or when a record has no usable English label.
 * - Output is deterministic: allowlist order, then source order; Prettier-formatted JSON.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  CATALOG_VERSION,
  SPACE_ARCHETYPE_IDS,
  SpaceCatalogFileSchema,
  type SpaceCatalogFile,
  type SpaceItem,
  type SpacePreset,
  type SpaceVariant,
  type SpaceZone,
} from "../../packages/domain/src/spaceCatalog/schemas";

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE_PATH = resolve(here, "source/building-space-catalog-v3.json");
export const LABELS_PATH = resolve(here, "label-en.json");
export const OUTPUT_PATH = resolve(here, "../../knowledge/space-catalog/catalog.json");

/** In-scope archetypes (ADR-034 amendment 2), in output order. */
export const ARCHETYPE_ALLOWLIST: readonly string[] = SPACE_ARCHETYPE_IDS;

const ARCHETYPE_LABEL_EN: Readonly<Record<string, string>> = {
  townhouse: "Townhouse",
  villa: "Villa",
  apartment: "Apartment",
  hotel: "Hotel",
  resort: "Resort",
};

type SourceVariant = string | { id?: string; labelVi?: string; labelEn?: string };

type SourcePreset = {
  id: string;
  buildingType: string;
  buildingLabelVi: string;
  category: string;
  labelVi: string;
  labelEn: string;
  availability: string;
  required: string[];
  optional: string[];
  forbiddenUnlessConfirmed: string[];
  variants: SourceVariant[];
  englishPrompt: string;
  source: string;
};

export type SourceCatalog = {
  version: string;
  buildings: Array<{ id: string; labelVi: string; presetIds: string[] }>;
  presets: SourcePreset[];
};

export type LabelMap = Readonly<Record<string, string>>;

export class CatalogBuildError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Space catalog build failed:\n- ${problems.join("\n- ")}`);
    this.name = "CatalogBuildError";
  }
}

// ---------------------------------------------------------------- text helpers

/** Lower case, diacritics stripped ("đ" → "d"), punctuation collapsed to single spaces. */
export function foldVietnamese(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NON_ASCII = /[^\x20-\x7e]/;

/** Stable item id: "beds blocking doors" → "beds_blocking_doors". */
export function itemId(text: string): string {
  return foldVietnamese(text).replace(/ /g, "_");
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive replacement (so "spa" never touches "space"). */
function replaceWords(text: string, from: string, to: string): string {
  return text.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(from)}(?![A-Za-z0-9])`, "gi"), to);
}

/** True when `phrase` occurs in `text` as whole words, after folding both. */
function containsFolded(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${foldVietnamese(text)} `.includes(` ${phrase} `);
}

// ---------------------------------------------------------------- mapping

const SEMI_OUTDOOR = /\b(?:balcony|loggia|terrace|rooftop)\b/i;

/** ADR-034: outdoor → exterior, or semi_outdoor for balconies, loggias, terraces and rooftops. */
export function zoneFor(category: string, labelEn: string): SpaceZone {
  if (category !== "outdoor") return "interior";
  return SEMI_OUTDOOR.test(labelEn) ? "semi_outdoor" : "exterior";
}

function items(list: readonly string[]): SpaceItem[] {
  return list.map((en) => ({ id: itemId(en), en: en.trim() }));
}

function variants(list: readonly SourceVariant[]): SpaceVariant[] {
  return list.map((v) => {
    if (typeof v === "string") return { id: itemId(v), labelVi: v, labelEn: v };
    const labelEn = v.labelEn ?? v.labelVi ?? v.id ?? "";
    return { id: v.id ?? itemId(labelEn), labelVi: v.labelVi ?? labelEn, labelEn };
  });
}

/** Curated `englishPrompt`: the new label substituted, plus a fixed "a apartment" article. */
function scopeText(prompt: string, oldLabel: string, newLabel: string): string {
  const relabelled = oldLabel === newLabel ? prompt : replaceWords(prompt, oldLabel, newLabel);
  return relabelled.replace(/\ba (?=apartment\b)/g, "an ").trim();
}

// ---------------------------------------------------------------- conversion

export function convertCatalog(source: SourceCatalog, labels: LabelMap): SpaceCatalogFile {
  const problems: string[] = [];
  const inScope = source.presets.filter((p) => ARCHETYPE_ALLOWLIST.includes(p.buildingType));
  const inScopeIds = new Set(inScope.map((p) => p.id));
  for (const key of Object.keys(labels).sort())
    if (!inScopeIds.has(key)) problems.push(`label-en.json names an unknown preset: ${key}`);

  const byArchetype = (p: SourcePreset) => ARCHETYPE_ALLOWLIST.indexOf(p.buildingType);
  const ordered = inScope
    .map((p, index) => ({ p, index }))
    .sort((a, b) => byArchetype(a.p) - byArchetype(b.p) || a.index - b.index)
    .map(({ p }) => p);

  const presets: SpacePreset[] = ordered.map((p) => {
    const curated = labels[p.id]?.trim();
    const labelEn = curated || p.labelEn.trim();
    return {
      id: p.id,
      buildingArchetypes: [p.buildingType],
      zone: zoneFor(p.category, labelEn),
      category: p.category as SpacePreset["category"],
      labelVi: p.labelVi.trim(),
      labelEn,
      availability: p.availability as SpacePreset["availability"],
      variants: variants(p.variants),
      requiredIfVerified: items(p.required),
      optional: items(p.optional),
      forbiddenUnlessConfirmed: items(p.forbiddenUnlessConfirmed),
      scopeEn: scopeText(p.englishPrompt, p.labelEn.trim(), labelEn),
      source: p.source,
    };
  });

  for (const preset of presets) problems.push(...englishProblems(preset, source));

  const archetypes = ARCHETYPE_ALLOWLIST.map((archetypeId) => {
    const building = source.buildings.find((b) => b.id === archetypeId);
    if (!building) problems.push(`source has no building type ${archetypeId}`);
    return {
      id: archetypeId,
      labelVi: building?.labelVi ?? archetypeId,
      labelEn: ARCHETYPE_LABEL_EN[archetypeId] ?? archetypeId,
    };
  });

  const file: SpaceCatalogFile = {
    catalogVersion: CATALOG_VERSION,
    sourceVersion: source.version,
    archetypes,
    presets,
  };
  const parsed = SpaceCatalogFileSchema.safeParse(file);
  if (!parsed.success)
    problems.push(
      ...parsed.error.issues.map((issue) => `schema: ${issue.path.join(".")}: ${issue.message}`),
    );
  if (problems.length) throw new CatalogBuildError(problems);
  return file;
}

/** The English guard: ASCII only, and no unaccented Vietnamese label left anywhere. */
function englishProblems(preset: SpacePreset, source: SourceCatalog): string[] {
  const problems: string[] = [];
  const raw = source.presets.find((p) => p.id === preset.id)!;
  const english: Array<[string, string]> = [
    ["labelEn", preset.labelEn],
    ["scopeEn", preset.scopeEn],
    ...preset.variants.map((v): [string, string] => [`variant ${v.id}`, v.labelEn]),
    ...[...preset.requiredIfVerified, ...preset.optional, ...preset.forbiddenUnlessConfirmed].map(
      (item): [string, string] => [`item ${item.id}`, item.en],
    ),
  ];
  for (const [field, text] of english)
    if (NON_ASCII.test(text)) problems.push(`${preset.id}: ${field} contains non-ASCII text`);

  // A label written in Vietnamese (it has diacritics) must never reach English output
  // without them: "Phòng khách riêng" → "phong khach rieng". Loanword labels ("Spa",
  // "Walk-in closet") are plain ASCII and legitimately appear in English.
  const vietnamese = [raw.labelVi, raw.buildingLabelVi].filter((label) => NON_ASCII.test(label));
  const slug = raw.id.split(".").pop()!.replace(/_/g, " ");
  const forbidden = new Set(vietnamese.map(foldVietnamese));
  if (NON_ASCII.test(raw.labelVi)) forbidden.add(slug);
  for (const phrase of [...forbidden].sort()) {
    if (containsFolded(preset.labelEn, phrase))
      problems.push(
        `${preset.id}: no English label (labelEn "${preset.labelEn}" is unaccented Vietnamese)`,
      );
    if (containsFolded(preset.scopeEn, phrase))
      problems.push(`${preset.id}: scopeEn still contains the unaccented label "${phrase}"`);
  }
  return problems;
}

/** The catalog file as written to disk (Prettier-formatted, trailing newline). */
export async function serializeCatalog(file: SpaceCatalogFile): Promise<string> {
  const options = (await resolveConfig(OUTPUT_PATH)) ?? {};
  return format(JSON.stringify(file), { ...options, parser: "json" });
}

export function readSource(): { source: SourceCatalog; labels: LabelMap } {
  return {
    source: JSON.parse(readFileSync(SOURCE_PATH, "utf8")) as SourceCatalog,
    labels: JSON.parse(readFileSync(LABELS_PATH, "utf8")) as LabelMap,
  };
}

export async function buildCatalog(): Promise<string> {
  const { source, labels } = readSource();
  return serializeCatalog(convertCatalog(source, labels));
}

async function main() {
  const text = await buildCatalog();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, text);
  const count = (JSON.parse(text) as SpaceCatalogFile).presets.length;
  console.log(`space catalog ${CATALOG_VERSION}: ${count} presets → ${OUTPUT_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
