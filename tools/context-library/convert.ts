/** Context Library V4 converter (ADR-034 amendment 1 and amendment 2). */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCE_PRESETS_PATH = resolve(here, "source/presets.json");
export const SOURCE_REGIONS_PATH = resolve(here, "source/regions.json");
export const LABELS_PATH = resolve(here, "label-en.json");
export const OUTPUT_PATH = resolve(here, "../../knowledge/context-library/library.json");

export const CONTEXT_ARCHETYPE_ALLOWLIST = [
  "townhouse",
  "villa",
  "apartment",
  "hotel",
  "resort",
] as const;
export const CONTEXT_LIBRARY_VERSION = "cl-4.0.0" as const;

const NON_ASCII = /[^\x20-\x7e]/;
const VIETNAMESE_FOLD = /[\u00c0-\u024f\u0110\u0111]/;

const foldVietnamese = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[Đđ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type SourceContextPreset = {
  id: string;
  buildingType: string;
  buildingTypeVi: string;
  nameVi: string;
  requiredIfSupported: string[];
  optional: string[];
  forbiddenByDefault: string[];
  regionCompatibility: string;
};
export type SourceRegion = {
  name: string;
  climate: string;
  details: string[];
  avoid: string[];
};
export type SourceContextFile = { version: string; count: number; presets: SourceContextPreset[] };
export type ContextLabels = {
  buildingTypes: Record<string, string>;
  regions: Record<string, string>;
  presets: Record<string, string>;
};

export type ContextBuildingType = { id: string; nameVi: string; nameEn: string };
export type ContextRegion = {
  id: string;
  name: string;
  nameEn: string;
  climate: string;
  details: string[];
  avoid: string[];
};
export type ContextPreset = SourceContextPreset & { nameEn: string; englishPrompt: string };
export type ContextLibraryFile = {
  libraryVersion: typeof CONTEXT_LIBRARY_VERSION;
  sourceVersion: string;
  buildingTypes: ContextBuildingType[];
  regions: ContextRegion[];
  presets: ContextPreset[];
};

export class ContextLibraryBuildError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Context library build failed:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
    this.name = "ContextLibraryBuildError";
  }
}

const asLabels = (raw: Partial<ContextLabels> & Record<string, unknown>): ContextLabels => ({
  buildingTypes: (raw.buildingTypes ?? {}) as Record<string, string>,
  regions: (raw.regions ?? {}) as Record<string, string>,
  presets: (raw.presets ??
    Object.fromEntries(Object.entries(raw).filter(([key]) => !key.startsWith("__")))) as Record<
    string,
    string
  >,
});

const list = (values: readonly string[]) => values.map((value) => value.trim()).filter(Boolean);

/** Build a clean English prompt only from the structured fields, never from source englishPrompt. */
export function buildEnglishPrompt(preset: ContextPreset, buildingName: string): string {
  const required = preset.requiredIfSupported.join(", ") || "none";
  const optional = preset.optional.join(", ") || "none";
  const forbidden = preset.forbiddenByDefault.join(", ") || "none";
  return [
    `ARCHITECTURAL CONTEXT PRESET: ${preset.id}.`,
    `Depict a ${buildingName} in the specific setting of ${preset.nameEn}.`,
    "Integrate the building with its real plot and surroundings.",
    `Required site cues, only when consistent with verified site evidence: ${required}.`,
    `Optional atmospheric details: ${optional}.`,
    `Do not introduce: ${forbidden}.`,
    "Preserve documented site boundaries, access, adjacent structures, architecture, materials and scale.",
    "When a required cue conflicts with verified site evidence, prioritize the evidence and report the conflict instead of inventing it.",
  ].join(" ");
}

function englishProblems(preset: ContextPreset, buildingName: string): string[] {
  const values = [
    preset.nameEn,
    preset.englishPrompt,
    buildingName,
    ...preset.requiredIfSupported,
    ...preset.optional,
    ...preset.forbiddenByDefault,
  ];
  if (values.some((value) => NON_ASCII.test(value)))
    return [`${preset.id}: English output contains non-ASCII text`];
  if (values.some((value) => VIETNAMESE_FOLD.test(value)))
    return [`${preset.id}: English output contains Vietnamese text`];
  const foldedOutput = foldVietnamese(values.join(" "));
  const forbidden = [preset.nameVi, preset.buildingTypeVi]
    .filter((value) => VIETNAMESE_FOLD.test(value))
    .map(foldVietnamese);
  if (forbidden.some((phrase) => phrase && foldedOutput.includes(phrase)))
    return [`${preset.id}: English output contains an unaccented Vietnamese label`];
  return [];
}

export function convertContextLibrary(
  source: SourceContextFile,
  sourceRegions: Record<string, SourceRegion>,
  labels: ContextLabels,
): ContextLibraryFile {
  const problems: string[] = [];
  const inScope = source.presets.filter((preset) =>
    CONTEXT_ARCHETYPE_ALLOWLIST.includes(
      preset.buildingType as (typeof CONTEXT_ARCHETYPE_ALLOWLIST)[number],
    ),
  );
  const inScopeIds = new Set(inScope.map((preset) => preset.id));
  for (const id of Object.keys(labels.presets).sort())
    if (!inScopeIds.has(id)) problems.push(`label-en.json names an unknown preset: ${id}`);
  // Preserve source order for stable review diffs; the allowlist controls scope, not grouping.
  const ordered = inScope;
  const presets: ContextPreset[] = ordered.map((raw) => {
    const nameEn = labels.presets[raw.id]?.trim();
    if (!nameEn) problems.push(`${raw.id}: missing English label`);
    const preset: ContextPreset = {
      id: raw.id,
      buildingType: raw.buildingType,
      buildingTypeVi: raw.buildingTypeVi,
      nameVi: raw.nameVi,
      requiredIfSupported: list(raw.requiredIfSupported),
      optional: list(raw.optional),
      forbiddenByDefault: list(raw.forbiddenByDefault),
      regionCompatibility: raw.regionCompatibility,
      nameEn: nameEn || raw.id,
      englishPrompt: "",
    };
    preset.englishPrompt = buildEnglishPrompt(
      preset,
      labels.buildingTypes[raw.buildingType] || raw.buildingType,
    );
    problems.push(
      ...englishProblems(preset, labels.buildingTypes[raw.buildingType] || raw.buildingType),
    );
    return preset;
  });
  const buildingTypes = CONTEXT_ARCHETYPE_ALLOWLIST.map((id) => {
    const raw = source.presets.find((preset) => preset.buildingType === id);
    const nameEn = labels.buildingTypes[id]?.trim();
    if (!nameEn) problems.push(`missing English building type label: ${id}`);
    if (nameEn && NON_ASCII.test(nameEn))
      problems.push(`${id}: building type English contains non-ASCII text`);
    if (
      nameEn &&
      VIETNAMESE_FOLD.test(raw?.buildingTypeVi ?? "") &&
      foldVietnamese(nameEn).includes(foldVietnamese(raw!.buildingTypeVi))
    )
      problems.push(`${id}: building type English contains an unaccented Vietnamese label`);
    return { id, nameVi: raw?.buildingTypeVi ?? id, nameEn: nameEn || id };
  });
  const regions = Object.entries(sourceRegions).map(([id, region]) => {
    const nameEn = labels.regions[id]?.trim();
    if (!nameEn) problems.push(`missing English region label: ${id}`);
    if (nameEn && NON_ASCII.test(nameEn))
      problems.push(`${id}: region English contains non-ASCII text`);
    if (
      nameEn &&
      VIETNAMESE_FOLD.test(region.name) &&
      foldVietnamese(nameEn).includes(foldVietnamese(region.name))
    )
      problems.push(`${id}: region English contains an unaccented Vietnamese label`);
    return {
      id,
      name: region.name,
      nameEn: nameEn || id,
      climate: region.climate,
      details: list(region.details),
      avoid: list(region.avoid),
    };
  });
  if (problems.length) throw new ContextLibraryBuildError(problems);
  return {
    libraryVersion: CONTEXT_LIBRARY_VERSION,
    sourceVersion: source.version,
    buildingTypes,
    regions,
    presets,
  };
}

export async function serializeContextLibrary(file: ContextLibraryFile): Promise<string> {
  const options = (await resolveConfig(OUTPUT_PATH)) ?? {};
  return format(JSON.stringify(file), { ...options, parser: "json", objectWrap: "preserve" });
}

export function readContextSource(): {
  source: SourceContextFile;
  regions: Record<string, SourceRegion>;
  labels: ContextLabels;
} {
  return {
    source: JSON.parse(readFileSync(SOURCE_PRESETS_PATH, "utf8")) as SourceContextFile,
    regions: JSON.parse(readFileSync(SOURCE_REGIONS_PATH, "utf8")) as Record<string, SourceRegion>,
    labels: asLabels(JSON.parse(readFileSync(LABELS_PATH, "utf8")) as Record<string, unknown>),
  };
}

export async function buildContextLibrary(): Promise<string> {
  const { source, regions, labels } = readContextSource();
  return serializeContextLibrary(convertContextLibrary(source, regions, labels));
}

async function main() {
  const text = await buildContextLibrary();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, text);
  console.log(
    `context library ${CONTEXT_LIBRARY_VERSION}: ${JSON.parse(text).presets.length} presets -> ${OUTPUT_PATH}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
