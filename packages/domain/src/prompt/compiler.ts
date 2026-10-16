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
import { cameraSectionText } from "../camera/describe";
import type { CameraDNA, LightingDNA, MoodDNA, WeatherDNA } from "../schemas/future";
import { sceneObjectLines } from "../regions/scene";
import { interiorPromptLines } from "../interior/helpers";
import { cameraSitePlan, viewTypeFraming } from "./topology";
import { siteCameraText, siteOcclusionLines } from "./sections/siteOcclusion";
import { stylePhrase } from "./stylePhrases";
import { canonicalHash } from "./hash";
import { VALIDATOR_VERSION } from "../validation/codes";
import { CATALOG_VERSION } from "../spaceCatalog/schemas";
import { allowsInteriorFurnishing, spaceScopeSection } from "./sections/spaceScope";
import { sceneObjectsSection } from "./sections/sceneObjects";
import { detailTargetSection } from "./sections/detailTarget";
import { effectsSection } from "./sections/effects";
import { hasEffects } from "../effects/schemas";
import { contextSuggestionsSection, usedContextLibrary } from "./sections/contextSuggestions";
import type { ShotIntent } from "../validation/shotIntent";
import { CONTEXT_LIBRARY_VERSION } from "../contextLibrary";

export const COMPILER_VERSION = "pc-1.8.0";

/** `PromptBundle.catalogVersion` of a DNA without the Space Catalog extension (ADR-034). */
export const NO_CATALOG_VERSION = "none";

export type PromptReference = {
  assetId: string;
  role: AssetRole;
  /** Human label such as the original file name; display only. */
  label?: string | null;
  /**
   * The approved anchor image of the camera being rendered (ADR-016). Numbered right after
   * the master and described as the view to match. Ignored on the master itself.
   */
  isAnchor?: boolean;
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
  /** Camera this prompt renders (Phase 3). Unknown ids are ignored (no camera section). */
  cameraId?: string | null;
  /**
   * Per-shot choices (ADR-036), recorded in `PromptBundle.shotIntent`; never written into
   * ProjectDNA. `projectType` and `cameraId` always come from the project and `cameraId`.
   */
  shotIntent?: ShotIntent;
};

export type PromptSectionOverrides = {
  lighting?: Partial<LightingDNA> | null;
  weather?: Partial<WeatherDNA> | null;
  mood?: Partial<MoodDNA> | null;
};

/** Order in which reference roles are described (and the role ranking for sorting). */
export const REFERENCE_ROLE_ORDER: readonly AssetRole[] = [
  "master_architecture",
  "structure_sketch",
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
    "is the MASTER architecture image: treat it as the authoritative design. Match its building massing, proportions, floor count, roof form, facade composition, window layout and visible materials exactly. Where the text description differs from this image, follow this image.",
  structure_sketch:
    "is the STRUCTURE source (sketch, massing model or 3D view): keep its building geometry, camera viewpoint, proportions, floor count, openings and roof form exactly; render it as a finished photorealistic building with the materials, lighting and context described below; do not add or remove building parts.",
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

const ANCHOR_INSTRUCTION =
  "is the APPROVED ANCHOR view for this camera: match its viewpoint, framing, composition and design exactly. The master stays authoritative for the architecture; where they differ, follow the master's building design.";

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
  return compilePromptInternal(input, input.dna);
}

/** Compile a variation while preserving locked DNA sections. */
export function compileWithOverrides(
  input: PromptCompileInput | ProjectDNA,
  overrides: PromptSectionOverrides,
): PromptBundle {
  const compileInput: PromptCompileInput =
    "building" in input
      ? { project: { id: "", name: "", projectType: "custom" }, dna: input, references: [] }
      : input;
  const dna = structuredClone(compileInput.dna);
  if (!dna.locks.lighting && overrides.lighting)
    dna.lighting = {
      schemaVersion: 1,
      artificialLighting: [],
      ...(dna.lighting ?? {}),
      ...overrides.lighting,
    };
  if (!dna.locks.weather && overrides.weather)
    dna.weather = { schemaVersion: 1, notes: "", ...(dna.weather ?? {}), ...overrides.weather };
  if (!dna.locks.mood && overrides.mood)
    dna.mood = { schemaVersion: 1, notes: "", ...(dna.mood ?? {}), ...overrides.mood };
  return compilePromptInternal(compileInput, dna);
}

/**
 * The bundle with more accepted WARN codes recorded (for example the extra prompt's, once
 * the gate has validated it); the list stays sorted and unique.
 */
/**
 * The shot intent as compiled and snapshotted: the project's type and the compiled camera
 * win over the stored values, unset or empty choices are dropped, and no choice means `undefined`.
 */
export function normalizeShotIntent(
  shotIntent: ShotIntent | undefined,
  projectType: ProjectType,
  cameraId: string | null,
): ShotIntent | undefined {
  if (!shotIntent) return undefined;
  // Every choice is kept (later phases add their own fields); unset or empty ones are dropped.
  const choices = Object.fromEntries(
    Object.entries(shotIntent).filter(
      ([key, value]) =>
        key !== "projectType" &&
        key !== "cameraId" &&
        value !== undefined &&
        value !== null &&
        value !== "" &&
        !(Array.isArray(value) && value.length === 0) &&
        !(key === "effects" && !hasEffects(value as ShotIntent["effects"])),
    ),
  );
  if (!Object.keys(choices).length) return undefined;
  return { ...choices, projectType, cameraId };
}

export function withResolvedWarnings(bundle: PromptBundle, codes: readonly string[]): PromptBundle {
  const merged = [...new Set([...(bundle.resolvedWarnings ?? []), ...codes])].sort(compareStrings);
  return { ...bundle, resolvedWarnings: merged };
}

function compilePromptInternal(input: PromptCompileInput, dna: ProjectDNA): PromptBundle {
  const { project, pack } = input;
  const references = sortReferences(input.references);
  const typeLabel = PROJECT_TYPE_LABELS[project.projectType];
  const isInterior = project.projectType === "interior";
  const usesInteriorDna = isInterior && dna.interior !== undefined;
  const interiorLines = usesInteriorDna ? interiorPromptLines(dna.interior!) : [];
  const camera = input.cameraId ? dna.cameras.find((c) => c.id === input.cameraId) : undefined;
  const shotIntent = normalizeShotIntent(input.shotIntent, project.projectType, camera?.id ?? null);

  // Positive section order is stable: subject, spaceScope, form, language, materials,
  // furnishing, context, lighting, weather, mood, camera, detailTarget, sceneObjects, effects,
  // contextSuggestions, quality. Furnishing is interior-only; spaceScope appears only with an
  // active catalog space; sceneObjects only when the shot adds objects (SRS §12.2 item 7,
  // after the camera); effects only when the shot turns one on (SRS §6.2); contextSuggestions
  // only with `context.library` (lowest priority).
  const positiveSections: Array<[string, string | null]> = [
    ["subject", subjectSection(input, typeLabel, isInterior, camera)],
    ["spaceScope", spaceScopeSection(dna)],
    [
      "form",
      usesInteriorDna
        ? interiorLine(interiorLines, "Interior space:")
        : formSection(dna, isInterior),
    ],
    [
      "language",
      usesInteriorDna ? interiorLine(interiorLines, "Interior style:") : languageSection(dna),
    ],
    [
      "materials",
      usesInteriorDna
        ? interiorLine(interiorLines, "Materials and colors:")
        : materialsSection(dna),
    ],
    [
      "furnishing",
      allowsInteriorFurnishing(dna) ? interiorLine(interiorLines, "Furnishing:") : null,
    ],
    ["context", contextSection(dna, isInterior)],
    [
      "lighting",
      joinWords([lightingSection(dna), interiorLine(interiorLines, "Interior lighting:")], " ") ||
        null,
    ],
    ["weather", weatherSection(dna)],
    ["mood", moodSection(dna)],
    [
      "camera",
      camera
        ? cameraSectionTextForPlan(camera, dna, project.projectType)
        : (interiorLine(interiorLines, "Camera:") ?? null),
    ],
    ["detailTarget", detailTargetSection(dna, shotIntent?.targetDetailId, project.projectType)],
    ["sceneObjects", sceneObjectsSection(dna, project.projectType, shotIntent?.sceneObjects)],
    ["effects", shotIntent ? effectsSection(dna, shotIntent) : null],
    ["contextSuggestions", contextSuggestionsSection(dna, project.projectType)],
    [
      "quality",
      "Photorealistic professional architectural photography, accurate proportions, straight verticals, high detail.",
    ],
  ];
  const included = positiveSections.filter((s): s is [string, string] => s[1] !== null);

  const plan = cameraSitePlan(camera, dna.context, project.projectType);
  const contextualNegatives =
    plan.mode === "oblique_street"
      ? [
          "corner plot",
          "street intersection",
          "exposed side wall",
          "side alley",
          "side yard",
          "detached building",
          "side windows on party walls",
        ]
      : plan.mode === "aerial_block"
        ? [
            "new street intersection",
            "corner lot",
            "detached neighbours",
            "merged neighbour buildings",
            "vacant plot",
          ]
        : [];
  const negatives = dedupe([
    ...BASE_NEGATIVES,
    ...(pack?.negativeConstraints ?? []),
    ...dna.context.negativeConstraints,
    ...contextualNegatives,
  ]);

  const roleCounts: Record<string, number> = {};
  for (const r of references) roleCounts[r.role] = (roleCounts[r.role] ?? 0) + 1;
  const anchorIndex = references.findIndex(isAnchorRef);

  // Provenance (ADR-034): hashes of exactly what was compiled. Display-only fields (project
  // name, reference labels) are left out so they do not change the hashes.
  const cameraId = camera?.id ?? null;
  const sourceHash = canonicalHash({
    dna,
    shot: {
      projectId: project.id,
      projectType: project.projectType,
      subtype: project.subtype ?? null,
      cameraId,
      // Only present with per-shot choices, so a shot without them hashes as before.
      ...(shotIntent ? { shotIntent } : {}),
      references: references.map((r) => ({
        assetId: r.assetId,
        role: r.role,
        isAnchor: r.isAnchor === true,
      })),
    },
  });
  const catalogVersion = dna.spaceCatalog ? CATALOG_VERSION : NO_CATALOG_VERSION;
  // Only present when the Context Library section is compiled, so other DNA hashes as before.
  const contextLibraryVersion = usedContextLibrary(dna, project.projectType)
    ? CONTEXT_LIBRARY_VERSION
    : undefined;
  const configHash = canonicalHash({
    compilerVersion: COMPILER_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    catalogVersion,
    ...(contextLibraryVersion ? { contextLibraryVersion } : {}),
    knowledgePack: pack ?? null,
  });

  return {
    compilerVersion: COMPILER_VERSION,
    validatorVersion: VALIDATOR_VERSION,
    catalogVersion,
    sourceHash,
    configHash,
    // Only WARN codes the user ACCEPTED belong here; the desktop gate sets them through
    // `withValidation`. Codes found but not accepted live in `validation.issueCodes`.
    resolvedWarnings: [],
    ...(shotIntent ? { shotIntent } : {}),
    positivePrompt: included.map(([, text]) => text).join("\n\n"),
    negativePrompt: negatives.join(", "),
    referenceInstructions: referenceSection(references),
    preservationInstructions: preservationSection(dna, references, camera, project.projectType),
    metadata: {
      projectId: project.id,
      projectType: project.projectType,
      subtype: project.subtype ?? null,
      dnaSchemaVersion: dna.schemaVersion,
      knowledgePack: pack ? `${pack.projectType}/${pack.subtype}@${pack.packVersion}` : null,
      ...(contextLibraryVersion ? { contextLibraryVersion } : {}),
      sections: included.map(([name]) => name),
      referenceCount: references.length,
      referenceRoles: roleCounts,
      cameraId: camera?.id ?? null,
      anchorImage: anchorIndex >= 0 ? anchorIndex + 1 : null,
      locks: {
        building: dna.locks.building,
        context: dna.locks.context,
        camera: dna.locks.camera,
        lighting: dna.locks.lighting,
        weather: dna.locks.weather,
        mood: dna.locks.mood,
      },
    },
  };
}

// ---------------------------------------------------------------- sections

function subjectSection(
  { dna, project, pack }: PromptCompileInput,
  typeLabel: string,
  isInterior: boolean,
  camera: CameraDNA | undefined,
): string {
  const b = dna.building;
  const noun = pack?.promptVocabulary.subjectNoun ?? b.buildingType ?? typeLabel;
  const descriptor = joinWords([b.architecturalStyle, b.subtype && humanize(b.subtype)]);
  const what = descriptor
    ? `${article(descriptor)} ${descriptor} ${noun}`
    : `${article(noun)} ${noun}`;
  const framing = camera
    ? viewTypeFraming(camera.viewType, isInterior)
    : (pack?.promptVocabulary.framing ?? (isInterior ? "interior view" : "exterior view"));
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
  const phrase = stylePhrase(b.architecturalStyle);
  if (phrase) parts.push(phrase);
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
  const l = dna.lighting;
  if (!l) return null;
  const parts = [
    l.presetId && `preset ${l.presetId}`,
    l.timeOfDay,
    l.sunDirection && `sun from ${l.sunDirection}`,
    l.sunElevation && `sun elevation ${l.sunElevation}`,
    l.intensity,
    l.shadowLength && `shadow length ${l.shadowLength}`,
    l.shadowSoftness && `shadow softness ${l.shadowSoftness}`,
    l.ambientLight && `ambient ${l.ambientLight}`,
  ];
  for (const light of l.artificialLighting) {
    if (light.enabled === false) continue;
    const zone = light.zone ?? light.type;
    const temperature = light.temperatureK === undefined ? "unknown" : `${light.temperatureK}K`;
    parts.push(`${zone} at ${temperature}, ${light.intensity ?? "unspecified intensity"}`);
  }
  const text = joinWords(parts, ", ");
  return text ? `Lighting: ${text}.` : null;
}

function weatherSection(dna: ProjectDNA): string | null {
  const w = dna.weather;
  if (!w) return null;
  const text = joinWords(
    [
      w.presetId && `preset ${w.presetId}`,
      w.preset,
      w.sky,
      w.humidity && `humidity ${w.humidity}`,
      w.groundWetness && `ground wetness ${w.groundWetness}`,
      w.haze && `${w.haze} haze`,
      w.notes,
    ],
    ", ",
  );
  return text ? `Weather: ${text}.` : null;
}

function moodSection(dna: ProjectDNA): string | null {
  const m = dna.mood;
  if (!m) return null;
  const text = joinWords(
    [
      m.presetId && `preset ${m.presetId}`,
      m.preset,
      m.contrast && `contrast ${m.contrast}`,
      m.saturation && `saturation ${m.saturation}`,
      m.warmth && `warmth ${m.warmth}`,
      m.atmosphere,
      m.notes,
    ],
    ", ",
  );
  return text ? `Mood: ${text}.` : null;
}

function referenceSection(references: readonly PromptReference[]): string {
  if (!references.length) {
    return "No reference images attached. Derive the design from the structured description only.";
  }
  return references
    .map(
      (r, i) =>
        `Image ${i + 1}${r.label ? ` (${r.label})` : ""} ${
          isAnchorRef(r) ? ANCHOR_INSTRUCTION : ROLE_INSTRUCTIONS[r.role]
        }`,
    )
    .join("\n");
}

function preservationSection(
  dna: ProjectDNA,
  references: readonly PromptReference[],
  camera: CameraDNA | undefined,
  projectType: ProjectType,
): string {
  const lines: string[] = [];
  const masterIndex = references.findIndex((r) => r.role === "master_architecture");
  if (masterIndex >= 0) {
    if (projectType !== "interior") {
      lines.push(
        `Image ${masterIndex + 1} is the approved master and the source of truth for both the building and its visible site. Preserve the building's massing, floor count, roof, facade, openings, materials, and all visible surroundings: neighbouring buildings and their positions, street and sidewalk width and layout, curbs, poles, overhead wires, vegetation, vehicles, background, lighting direction, time of day, weather, and shadow character. Change only the camera viewpoint and the portions naturally revealed by that viewpoint. Do not redesign, remove, merge, relocate, or replace visible site elements.`,
      );
      lines.push(`Preserve the architecture of Image ${masterIndex + 1} (master).`);
    } else {
      lines.push(
        `Preserve the architecture of Image ${masterIndex + 1} (master): do not change building massing, floor count, roof form, opening positions or facade proportions.`,
      );
      lines.push("Keep the same room, window positions, view outside and lighting character.");
    }
  } else {
    lines.push(
      "No master architecture image is set; keep the building consistent with the structured DNA.",
    );
  }
  const structureIndex = references.findIndex((r) => r.role === "structure_sketch");
  if (structureIndex >= 0) {
    lines.push(
      `Follow the geometry and viewpoint of Image ${structureIndex + 1} (structure sketch) exactly; replace sketch lines, flat colours and model textures with real materials.`,
    );
  }
  const anchorIndex = references.findIndex(isAnchorRef);
  if (anchorIndex >= 0) {
    lines.push(
      `Keep the viewpoint, framing and composition of Image ${anchorIndex + 1} (anchor view); do not move the camera.`,
    );
  }
  const b = dna.building;
  // With a master, the image is the authority: a DNA floor count or material list that
  // disagrees with it must not override it (the model tends to follow hard text rules).
  if (masterIndex >= 0) {
    const master = `Image ${masterIndex + 1} (master)`;
    if (b.floors !== undefined) lines.push(`Keep the floor count shown in ${master}.`);
    if (b.materials.length) lines.push(`Keep the facade materials visible in ${master}.`);
  } else {
    if (b.floors !== undefined)
      lines.push(`Keep exactly ${b.floors} ${b.floors === 1 ? "floor" : "floors"}.`);
    if (b.materials.length) lines.push("Do not substitute the specified materials.");
  }
  if (dna.locks.building)
    lines.push("Building DNA is LOCKED: no changes to the building design are permitted.");
  if (dna.locks.context)
    lines.push("Context DNA is LOCKED: keep the surroundings exactly as described.");
  if (camera && dna.locks.camera)
    lines.push("Camera DNA is LOCKED: keep the viewpoint, lens and framing exactly as described.");
  if (dna.locks.lighting)
    lines.push("Lighting DNA is LOCKED: preserve the lighting exactly as described.");
  if (dna.locks.weather)
    lines.push("Weather DNA is LOCKED: preserve the weather exactly as described.");
  if (dna.locks.mood) lines.push("Mood DNA is LOCKED: preserve the mood exactly as described.");
  // SITE & OCCLUSION (ADR-034) replaces the ADR-028 party-wall wording.
  lines.push(...siteOcclusionLines(dna, camera, projectType, masterIndex));
  lines.push(...sceneObjectLines(dna));
  return lines.join("\n");
}

function cameraSectionTextForPlan(
  camera: CameraDNA,
  dna: ProjectDNA,
  projectType: ProjectType,
): string {
  const plan = cameraSitePlan(camera, dna.context, projectType);
  if (plan.mode === "oblique_street") {
    const side = plan.side ?? "side";
    return cameraSectionForPlan(camera, {
      viewpoint: `${side === "left" ? "front-left" : "front-right"} oblique street view from eye level, about 30–35° off the facade axis, looking along the street`,
      composition: `front facade dominant, seen at an angle along the street; the ${side} side wall stays hidden behind the attached neighbour`,
    });
  }
  if (plan.mode === "aerial_block") {
    const base = siteCameraText(camera, dna, projectType);
    const composition = base.match(/(?:^|; )composition: (.*?)(?:; camera notes:|\.$)/)?.[1];
    const blockComposition = composition
      ? composition.replace(
          /\bplot(?: and surroundings)?\b/gi,
          "same street block and surrounding rooftops",
        )
      : "same street block and surrounding rooftops";
    return cameraSectionForPlan(camera, { composition: blockComposition }, base);
  }
  return siteCameraText(camera, dna, projectType);
}

/** Keep measured camera fields while applying the narrowly scoped plan-mode substitutions. */
function cameraSectionForPlan(
  camera: CameraDNA,
  replacements: { viewpoint?: string; composition: string },
  base: string = cameraSectionText(camera),
): string {
  const parts = base.slice("Camera: ".length, -1).split("; ");
  const viewType = parts[0]!;
  const measured = parts.filter(
    (part) =>
      part !== viewType && !part.startsWith("viewpoint: ") && !part.startsWith("composition: "),
  );
  const viewpoint = replacements.viewpoint
    ? `viewpoint: ${replacements.viewpoint}`
    : parts.find((part) => part.startsWith("viewpoint: "));
  return `Camera: ${[viewType, viewpoint, ...measured, `composition: ${replacements.composition}`]
    .filter((part): part is string => Boolean(part))
    .join("; ")}.`;
}

// ---------------------------------------------------------------- helpers

/** An anchor reference that is not the master (the master instruction always wins). */
function isAnchorRef(r: PromptReference): boolean {
  return r.isAnchor === true && r.role !== "master_architecture";
}

/**
 * Image numbering order: master first, then anchor references, then the other roles in
 * `REFERENCE_ROLE_ORDER`; ties by asset id. Callers submit reference ids in this order.
 */
export function sortReferences(refs: readonly PromptReference[]): PromptReference[] {
  const rank = (r: PromptReference) =>
    r.role === "master_architecture"
      ? 0
      : isAnchorRef(r)
        ? 1
        : REFERENCE_ROLE_ORDER.indexOf(r.role) + 1;
  return [...refs].sort((a, b) => rank(a) - rank(b) || compareStrings(a.assetId, b.assetId));
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

function interiorLine(lines: readonly string[], prefix: string): string | null {
  return lines.find((line) => line.startsWith(prefix)) ?? null;
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
