/**
 * Provider-neutral, deterministic Prompt Compiler.
 *
 * Structured DNA is the source of truth; the PromptBundle is derived output.
 * Identical input + identical COMPILER_VERSION must produce byte-identical output:
 * no clocks, no randomness, no locale-dependent formatting, stable ordering everywhere.
 */
import { CONTEXT_DIRECTIONS, type ContextDirection, type ContextZone } from "../schemas/context";
import type { AssetRole, ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import type { PromptBundle } from "../schemas/prompt";
import type { KnowledgePack } from "../knowledge/pack";
import { DENSITY_LABELS, PROJECT_TYPE_LABELS } from "../labels";

export const COMPILER_VERSION = "pc-1.0.0";

export type PromptReference = {
  assetId: string;
  role: AssetRole;
  /** Human label such as the original file name; display only. */
  label?: string | null;
};

export type PromptCompileInput = {
  project: {
    id: string;
    name: string;
    projectType: ProjectType;
    subtype?: string | null;
  };
  dna: ProjectDNA;
  references: readonly PromptReference[];
  pack?: KnowledgePack | null;
};

/** Order in which reference roles are described (and the role ranking for sorting). */
export const REFERENCE_ROLE_ORDER: readonly AssetRole[] = [
  "master_architecture",
  "architecture_reference",
  "material_reference",
  "context_reference",
  "landscape_reference",
  "lighting_reference",
  "mood_reference",
  "camera_reference",
  "regular_image",
];

const ROLE_INSTRUCTIONS: Record<AssetRole, string> = {
  master_architecture:
    "is the MASTER architecture image: treat it as the authoritative design. Match its building massing, proportions, floor count, roof form, facade composition and window layout exactly.",
  architecture_reference:
    "is an architecture reference: borrow architectural language and detailing only; do not copy its massing over the master design.",
  material_reference:
    "is a material reference: use it only for material, texture, finish and color of surfaces; ignore its form and composition.",
  context_reference:
    "is a context reference: use it only for surrounding streets, neighbouring buildings and urban setting; do not alter the building.",
  landscape_reference:
    "is a landscape reference: use it only for planting, hardscape, garden and terrain treatment.",
  lighting_reference:
    "is a lighting reference: use it only for light direction, time of day, light color and shadow quality.",
  mood_reference:
    "is a mood reference: use it only for atmosphere, color grading and emotional tone; do not copy its content.",
  camera_reference:
    "is a camera reference: use it only for viewpoint, lens feel, framing and composition.",
  regular_image:
    "is a general image: use it as loose inspiration only; it carries no binding design information.",
};

/** Baseline negatives every architectural image should avoid. */
const BASE_NEGATIVES = [
  "distorted perspective",
  "warped or bent vertical lines",
  "inconsistent floor count",
  "melted or impossible geometry",
  "floating structural elements",
  "illegible text or watermarks",
  "low resolution",
  "oversaturated colors",
];

export function compilePrompt(input: PromptCompileInput): PromptBundle {
  const { dna, project, pack } = input;
  const references = sortReferences(input.references);
  const typeLabel = PROJECT_TYPE_LABELS[project.projectType];
  const isInterior = project.projectType === "interior";

  const positiveSections: Array<[string, string | null]> = [
    ["subject", subjectSection(input, typeLabel, isInterior)],
    ["form", formSection(dna, isInterior)],
    ["language", languageSection(dna)],
    ["materials", materialsSection(dna)],
    ["context", contextSection(dna, isInterior)],
    ["lighting", lightingSection(dna)],
    [
      "quality",
      "Photorealistic professional architectural photography, accurate proportions, straight verticals, high detail.",
    ],
  ];
  const included = positiveSections.filter((s): s is [string, string] => s[1] !== null);

  const negatives = dedupe([...BASE_NEGATIVES, ...dna.context.negativeConstraints]);

  const roleCounts: Record<string, number> = {};
  for (const r of references) roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1;

  return {
    compilerVersion: COMPILER_VERSION,
    positivePrompt: included.map(([, text]) => text).join("\n\n"),
    negativePrompt: negatives.join(", "),
    referenceInstructions: referenceSection(references),
    preservationInstructions: preservationSection(dna, references),
    metadata: {
      projectId: project.id,
      projectType: project.projectType,
      subtype: project.subtype ?? null,
      dnaSchemaVersion: dna.schemaVersion,
      knowledgePack: pack ? `${pack.projectType}/${pack.subtype}@${pack.packVersion}` : null,
      sections: included.map(([name]) => name),
      referenceCount: references.length,
      referenceRoles: roleCounts,
      locks: {
        building: dna.locks.building,
        context: dna.locks.context,
      },
    },
  };
}

// ---------------------------------------------------------------- sections

function subjectSection(
  { dna, project, pack }: PromptCompileInput,
  typeLabel: string,
  isInterior: boolean,
): string {
  const b = dna.building;
  const noun = pack?.promptVocabulary.subjectNoun ?? b.buildingType ?? typeLabel;
  const descriptor = joinWords([b.architecturalStyle, b.subtype && humanize(b.subtype)]);
  const what = descriptor
    ? `${article(descriptor)} ${descriptor} ${noun}`
    : `${article(noun)} ${noun}`;
  const framing =
    pack?.promptVocabulary.framing ?? (isInterior ? "interior view" : "exterior view");
  return `Architectural visualization (${framing}) of ${what}, project type: ${typeLabel.toLowerCase()}${
    project.subtype && project.subtype !== "default" ? ` / ${humanize(project.subtype)}` : ""
  }.`;
}

function formSection(dna: ProjectDNA, isInterior: boolean): string | null {
  const b = dna.building;
  const parts: string[] = [];
  if (b.floors !== undefined) {
    parts.push(
      isInterior ? `${b.floors}-level space` : `${b.floors} ${b.floors === 1 ? "floor" : "floors"}`,
    );
  }
  const dims = dimensionText(b.dimensions);
  if (dims) parts.push(dims);
  const m = b.massing;
  if (m.composition) parts.push(`massing: ${m.composition}`);
  if (m.mainVolume) parts.push(`main volume: ${m.mainVolume}`);
  if (m.secondaryVolume) parts.push(`secondary volume: ${m.secondaryVolume}`);
  if (m.voids.length) parts.push(`voids: ${m.voids.join(", ")}`);
  if (m.cantilever) parts.push(`cantilever: ${m.cantilever}`);
  const roof = joinWords(
    [
      b.roof.type,
      b.roof.pitch && `${b.roof.pitch} pitch`,
      b.roof.overhang && `${b.roof.overhang} overhang`,
    ],
    ", ",
  );
  if (roof) parts.push(`roof: ${roof}`);
  const o = b.openings;
  const openings = joinWords(
    [
      o.windowType,
      o.frame && `${o.frame} frames`,
      o.rhythm && `${o.rhythm} rhythm`,
      o.glazing && `${o.glazing} glazing`,
    ],
    ", ",
  );
  if (openings) parts.push(`openings: ${openings}`);
  return parts.length ? `Building form: ${parts.join("; ")}.` : null;
}

function languageSection(dna: ProjectDNA): string | null {
  const b = dna.building;
  // The style itself is already stated in the subject section.
  const parts: string[] = [];
  if (b.specialFeatures.length) parts.push(`signature features: ${b.specialFeatures.join(", ")}`);
  const notes = b.notes.trim();
  if (notes) parts.push(`design notes: ${notes}`);
  return parts.length ? `Architectural language: ${parts.join("; ")}.` : null;
}

function materialsSection(dna: ProjectDNA): string | null {
  const b = dna.building;
  const parts: string[] = [];
  if (b.materials.length) {
    parts.push(b.materials.map((m) => `${m.zone}: ${m.description}`).join("; "));
  }
  if (b.colorPalette.length) parts.push(`color palette: ${b.colorPalette.join(", ")}`);
  return parts.length ? `Materials and colors: ${parts.join("; ")}.` : null;
}

const DIRECTION_LABEL: Record<ContextDirection, string> = {
  front: "In front",
  rear: "At the rear",
  left: "On the left side",
  right: "On the right side",
};

function contextSection(dna: ProjectDNA, isInterior: boolean): string | null {
  const c = dna.context;
  const lines: string[] = [];
  const setting = joinWords(
    [
      c.macroContext,
      c.climateContext && `${c.climateContext} climate`,
      c.density && `${DENSITY_LABELS[c.density].toLowerCase()} density`,
    ],
    ", ",
  );
  if (setting) lines.push(`${setting}.`);
  for (const dir of CONTEXT_DIRECTIONS) {
    const zone = zoneText(c[dir]);
    if (zone) lines.push(`${DIRECTION_LABEL[dir]}: ${zone}.`);
  }
  if (c.distantBackground.length)
    lines.push(`Distant background: ${c.distantBackground.join(", ")}.`);
  const atmosphere = c.atmosphereNotes.trim();
  if (atmosphere) lines.push(`Atmosphere: ${atmosphere}.`);
  if (!lines.length) return null;
  return `${isInterior ? "Surroundings and views" : "Site context"}: ${lines.join(" ")}`;
}

function zoneText(z: ContextZone): string | null {
  const parts: string[] = [];
  if (z.spaceType) parts.push(z.spaceType);
  if (z.roadType) parts.push(`road: ${z.roadType}`);
  if (z.elements.length) parts.push(z.elements.join(", "));
  if (z.vegetation.length) parts.push(`vegetation: ${z.vegetation.join(", ")}`);
  if (z.adjacentBuildings.length) parts.push(`adjacent: ${z.adjacentBuildings.join(", ")}`);
  const notes = z.notes.trim();
  if (notes) parts.push(notes);
  return parts.length ? parts.join("; ") : null;
}

function lightingSection(dna: ProjectDNA): string | null {
  // Lighting/weather/mood editing arrives in Phase 4; include only what is already present.
  const parts: string[] = [];
  const l = dna.lighting;
  if (l) {
    const text = joinWords(
      [l.timeOfDay, l.sunDirection && `sun from ${l.sunDirection}`, l.intensity, l.ambientLight],
      ", ",
    );
    if (text) parts.push(`lighting: ${text}`);
  }
  const w = dna.weather;
  if (w) {
    const text = joinWords([w.preset, w.sky, w.haze && `${w.haze} haze`], ", ");
    if (text) parts.push(`weather: ${text}`);
  }
  const m = dna.mood;
  if (m) {
    const text = joinWords([m.preset, m.atmosphere], ", ");
    if (text) parts.push(`mood: ${text}`);
  }
  return parts.length ? `Lighting and mood: ${parts.join("; ")}.` : null;
}

function referenceSection(references: readonly PromptReference[]): string {
  if (!references.length) {
    return "No reference images attached. Derive the design from the structured description only.";
  }
  return references
    .map((r, i) => `Image ${i + 1}${r.label ? ` (${r.label})` : ""} ${ROLE_INSTRUCTIONS[r.role]}`)
    .join("\n");
}

function preservationSection(dna: ProjectDNA, references: readonly PromptReference[]): string {
  const lines: string[] = [];
  const masterIndex = references.findIndex((r) => r.role === "master_architecture");
  if (masterIndex >= 0) {
    lines.push(
      `Preserve the architecture of Image ${masterIndex + 1} (master): do not change building massing, floor count, roof form, opening positions or facade proportions.`,
    );
  } else {
    lines.push(
      "No master architecture image is set; keep the building consistent with the structured DNA.",
    );
  }
  const b = dna.building;
  if (b.floors !== undefined)
    lines.push(`Keep exactly ${b.floors} ${b.floors === 1 ? "floor" : "floors"}.`);
  if (b.materials.length) lines.push("Do not substitute the specified materials.");
  if (dna.locks.building)
    lines.push("Building DNA is LOCKED: no changes to the building design are permitted.");
  if (dna.locks.context)
    lines.push("Context DNA is LOCKED: keep the surroundings exactly as described.");
  return lines.join("\n");
}

// ---------------------------------------------------------------- helpers

export function sortReferences(refs: readonly PromptReference[]): PromptReference[] {
  const rank = (role: AssetRole) => REFERENCE_ROLE_ORDER.indexOf(role);
  return [...refs].sort(
    (a, b) => rank(a.role) - rank(b.role) || compareStrings(a.assetId, b.assetId),
  );
}

/** Locale-independent comparison (localeCompare depends on the runtime locale). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dimensionText(d: ProjectDNA["building"]["dimensions"]): string | null {
  const parts: string[] = [];
  if (d.widthM !== undefined && d.depthM !== undefined)
    parts.push(`footprint ${num(d.widthM)} m x ${num(d.depthM)} m`);
  else if (d.widthM !== undefined) parts.push(`width ${num(d.widthM)} m`);
  else if (d.depthM !== undefined) parts.push(`depth ${num(d.depthM)} m`);
  if (d.heightM !== undefined) parts.push(`height ${num(d.heightM)} m`);
  if (d.siteWidthM !== undefined && d.siteDepthM !== undefined)
    parts.push(`site ${num(d.siteWidthM)} m x ${num(d.siteDepthM)} m`);
  else if (d.siteWidthM !== undefined) parts.push(`site width ${num(d.siteWidthM)} m`);
  else if (d.siteDepthM !== undefined) parts.push(`site depth ${num(d.siteDepthM)} m`);
  return parts.length ? parts.join(", ") : null;
}

/** Fixed formatting: at most 2 decimals, no trailing zeros, '.' separator. */
function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function joinWords(parts: Array<string | undefined | null | false>, sep = " "): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.trim())
    .join(sep);
}

function humanize(s: string): string {
  return s.replace(/[_-]+/g, " ").trim();
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    const k = t.toLowerCase();
    if (t && !seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}
