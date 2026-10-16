import {
  BUILDING_USES,
  CAMERA_PRESETS,
  CEILING_MATERIALS,
  COUNTERTOP_MATERIALS,
  FLOOR_MATERIALS,
  FURNITURE,
  INTERIOR_STYLES,
  MATERIAL_PRESETS,
  METAL_FINISHES,
  PALETTES,
  ROOM_IDS_BY_USE,
  ROOMS,
  TEXTILE_MATERIALS,
  WALL_MATERIALS,
  CABINETRY_MATERIALS,
} from "../interior/catalog";
import { ProjectDNASchema, type ProjectDNA } from "../schemas/projectDna";
import type { ProjectType } from "../schemas/enums";

export type AssistMode = "brief" | "images" | "master" | "translate" | "source";
export type AssistScope = "interior" | "building" | "context" | "lighting";

export type AssistCatalogField = {
  path: string;
  kind: "id" | "ids" | "number" | "text";
  options?: Array<{ id: string; en: string }>;
  min?: number;
  max?: number;
};

export type AssistCatalog = {
  scope: AssistScope;
  fields: AssistCatalogField[];
};

export type AssistField = {
  path: string;
  value: unknown;
  confidence: number;
  reason: string;
};

export type AssistSuggestion = {
  scope: AssistScope;
  fields: AssistField[];
  dropped: Array<{ path: string; why: string }>;
};

const options = (items: readonly { id: string; en: string }[]) =>
  items.map(({ id, en }) => ({ id, en }));

const ids = (values: readonly string[]) =>
  values.map((id) => ({ id, en: id.replaceAll("_", " ") }));

const catalogField = (
  path: string,
  kind: AssistCatalogField["kind"],
  fieldOptions?: AssistCatalogField["options"],
  min?: number,
  max?: number,
): AssistCatalogField => ({
  path,
  kind,
  ...(fieldOptions ? { options: fieldOptions } : {}),
  ...(min !== undefined ? { min } : {}),
  ...(max !== undefined ? { max } : {}),
});

const interiorFields = (): AssistCatalogField[] => [
  catalogField("interior.buildingUseId", "id", options(BUILDING_USES)),
  catalogField("interior.roomId", "id", options(ROOMS)),
  catalogField("interior.styleId", "id", options(INTERIOR_STYLES)),
  catalogField("interior.paletteId", "id", options(PALETTES)),
  catalogField("interior.materialPresetId", "id", options(MATERIAL_PRESETS)),
  catalogField("interior.surfaces.floor", "ids", options(FLOOR_MATERIALS)),
  catalogField("interior.surfaces.wall", "ids", options(WALL_MATERIALS)),
  catalogField("interior.surfaces.ceiling", "ids", options(CEILING_MATERIALS)),
  catalogField("interior.surfaces.cabinetry", "ids", options(CABINETRY_MATERIALS)),
  catalogField("interior.surfaces.countertop", "ids", options(COUNTERTOP_MATERIALS)),
  catalogField("interior.surfaces.textile", "ids", options(TEXTILE_MATERIALS)),
  catalogField("interior.surfaces.metal", "ids", options(METAL_FINISHES)),
  catalogField(
    "interior.daylightDirection",
    "id",
    ids(["front", "left", "right", "rear", "diffuse", "none"]),
  ),
  catalogField("interior.daylightAmount", "id", ids(["low", "medium", "high"])),
  catalogField(
    "interior.timeOfDay",
    "id",
    ids(["morning", "midday", "afternoon", "golden_hour", "evening", "night"]),
  ),
  catalogField(
    "interior.artificialScenes",
    "ids",
    ids(["ambient", "task", "accent", "cove", "pendant", "downlight"]),
  ),
  catalogField(
    "interior.colorTemperatureK",
    "id",
    [2700, 3000, 3500, 4000].map((value) => ({ id: String(value), en: `${value} K` })),
  ),
  catalogField("interior.furnitureIds", "ids", options(FURNITURE)),
  catalogField("interior.furnishingDensity", "id", ids(["minimal", "balanced", "layered"])),
  catalogField("interior.cameraPresetId", "id", options(CAMERA_PRESETS)),
  catalogField("interior.areaM2", "number", undefined, 0.1, 100000),
  catalogField("interior.ceilingHeightM", "number", undefined, 1, 100),
];

const architecturalStyleOptions = ids([
  "modern tropical",
  "tropical minimalist",
  "bali style",
  "indochine",
  "neo-classical",
  "neo classic",
  "tan co dien",
  "minimalist",
  "contemporary farmhouse",
  "modern",
  "contemporary",
  "industrial modern",
  "japandi",
  "scandinavian",
  "mediterranean",
]);

const buildingFields = (): AssistCatalogField[] => [
  catalogField("building.floors", "number", undefined, 1, 200),
  catalogField("building.architecturalStyle", "text", architecturalStyleOptions),
  catalogField("building.roof.type", "text"),
  catalogField("building.massing.composition", "text"),
  catalogField("building.materials", "text"),
  catalogField("building.specialFeatures", "text"),
];

const contextFields = (): AssistCatalogField[] => [
  catalogField("context.density", "id", ids(["very_low", "low", "medium", "high", "very_high"])),
  catalogField("context.siteTopology", "text"),
  catalogField("context.front.roadType", "text"),
  catalogField("context.front.spaceType", "text"),
  catalogField("context.front.elements", "text"),
  catalogField("context.vegetation", "text"),
];

const lightingFields = (): AssistCatalogField[] => [
  catalogField(
    "lighting.timeOfDay",
    "id",
    ids(["dawn", "morning", "midday", "afternoon", "golden_hour", "blue_hour", "night"]),
  ),
  catalogField("lighting.sunDirection", "text"),
  catalogField("lighting.intensity", "text"),
  catalogField("lighting.ambientLight", "text"),
];

export function assistCatalog(scope: AssistScope, _projectType: ProjectType): AssistCatalog {
  const fields =
    scope === "interior"
      ? interiorFields()
      : scope === "building"
        ? buildingFields()
        : scope === "context"
          ? contextFields()
          : lightingFields();
  return { scope, fields };
}

const allowedList = (catalog: AssistCatalog): string =>
  catalog.fields
    .map((field) => {
      const choices = field.options?.map((option) => `${option.id} = ${option.en}`).join(", ");
      return `${field.path} (${field.kind})${choices ? `: ${choices}` : ""}`;
    })
    .join("\n");

export function assistSystemPrompt(mode: AssistMode, catalog: AssistCatalog): string {
  if (mode === "source") return sourceSystemPrompt(catalog);
  const allowed = allowedList(catalog);
  const role =
    mode === "translate"
      ? "Translate only the supplied free-text DNA values into concise English. Return those paths and nothing else."
      : "You propose structured architectural project DNA from the supplied brief or images. Use English for free text.";
  return `${role}\nAllowed paths and ids:\n${allowed}\nAnswer with JSON {fields:[{path,value,confidence,reason}]} only. Pick only listed ids. Free text in English. Omit fields you cannot infer.`;
}

/**
 * Sizes cannot be measured from one photo: in mode `source` these paths are neither offered
 * nor accepted (ADR-040: hidden sizes never become facts).
 */
export const SOURCE_UNVERIFIABLE_PATHS: readonly string[] = [
  "interior.areaM2",
  "interior.ceilingHeightM",
];

/** The catalogue offered in mode `source`: the scope's catalogue without unverifiable sizes. */
export function sourceCatalog(catalog: AssistCatalog): AssistCatalog {
  return {
    scope: catalog.scope,
    fields: catalog.fields.filter((field) => !SOURCE_UNVERIFIABLE_PATHS.includes(field.path)),
  };
}

function sourceSystemPrompt(catalog: AssistCatalog): string {
  return [
    "You analyse one source image of an architectural or interior project together with the user's wish.",
    "List in `observed` only what is clearly visible. Put every guess (hidden parts, sizes, materials you cannot see clearly) in `inferred` with a confidence from 0 to 1; never state a guess as observed.",
    "Propose structured DNA in `fields` only from these allowed paths and ids:",
    allowedList(sourceCatalog(catalog)),
    "Rewrite the wish as one English change request in `requestEn`, and list in `keepEn`, in English, what must be preserved from the image.",
    "Answer with JSON {observed:[string],inferred:[{text,confidence}],fields:[{path,value,confidence,reason}],requestEn:string,keepEn:[string]} only. Pick only listed ids. Free text in English. Omit fields you cannot infer.",
  ].join("\n");
}

const unwrapJson = (raw: string): string => {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const textListPaths = new Set([
  "building.materials",
  "building.specialFeatures",
  "context.front.elements",
  "context.vegetation",
]);

const normalizeTextValue = (path: string, value: unknown): unknown => {
  if (
    textListPaths.has(path) &&
    Array.isArray(value) &&
    value.every((item) => typeof item === "string")
  ) {
    return value.join(", ");
  }
  return value;
};

const isSiteTopology = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const side = (sideValue: unknown) =>
    sideValue === undefined ||
    sideValue === "attached" ||
    sideValue === "open" ||
    sideValue === "unknown";
  return (
    side(value.left) &&
    side(value.right) &&
    (value.cornerLot === undefined || typeof value.cornerLot === "boolean") &&
    (value.cornerSide === undefined || value.cornerSide === "left" || value.cornerSide === "right")
  );
};

const normalizeCatalogValue = (
  path: string,
  spec: AssistCatalogField,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; why: string } => {
  if (spec.kind === "number") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (spec.min !== undefined && value < spec.min) ||
      (spec.max !== undefined && value > spec.max)
    ) {
      return { ok: false, why: "Number is outside the allowed range." };
    }
    return { ok: true, value };
  }

  if (spec.kind === "id" || spec.kind === "ids") {
    const choiceIds = new Set(spec.options?.map((option) => option.id));
    const rawIds: unknown[] | null =
      spec.kind === "ids" ? (Array.isArray(value) ? [...value] : null) : [value];
    if (path === "interior.colorTemperatureK" && typeof value === "number") {
      rawIds?.splice(0, 1, String(value));
    }
    if (
      !Array.isArray(rawIds) ||
      !rawIds.every((item) => typeof item === "string" && choiceIds.has(item))
    ) {
      return { ok: false, why: "Value contains an id outside the allowed catalogue." };
    }
    if (path === "interior.colorTemperatureK") return { ok: true, value: Number(rawIds[0]) };
    return { ok: true, value: spec.kind === "ids" ? rawIds : rawIds[0] };
  }

  if (path === "context.siteTopology") {
    return isSiteTopology(value)
      ? { ok: true, value }
      : { ok: false, why: "Site topology must be a valid topology object." };
  }

  const normalized = normalizeTextValue(path, value);
  if (typeof normalized !== "string") return { ok: false, why: "Value must be English text." };
  return { ok: true, value: normalized.slice(0, 240) };
};

const parseJson = (raw: string): { ok: true; data: unknown } | { ok: false } => {
  try {
    return { ok: true, data: JSON.parse(unwrapJson(raw)) };
  } catch {
    return { ok: false };
  }
};

export function parseAssistReply(raw: string, catalog: AssistCatalog): AssistSuggestion {
  const parsed = parseJson(raw);
  if (!parsed.ok) {
    return {
      scope: catalog.scope,
      fields: [],
      dropped: [{ path: "", why: "Reply is not valid JSON." }],
    };
  }
  const data = parsed.data;
  const dropped: AssistSuggestion["dropped"] = [];
  const rawFields = isRecord(data) && Array.isArray(data.fields) ? data.fields : [];
  if (!isRecord(data) || !Array.isArray(data.fields)) {
    dropped.push({ path: "", why: "Reply must contain a fields array." });
  }
  return { scope: catalog.scope, fields: parseFields(rawFields, catalog, dropped), dropped };
}

/** Validates reply fields against the catalogue; rejected ones are pushed to `dropped`. */
function parseFields(
  rawFields: unknown[],
  catalog: AssistCatalog,
  dropped: AssistSuggestion["dropped"],
): AssistField[] {
  const acceptedUse = rawFields.find(
    (item): item is Record<string, unknown> =>
      isRecord(item) &&
      item.path === "interior.buildingUseId" &&
      typeof item.value === "string" &&
      (ROOM_IDS_BY_USE as Record<string, readonly string[]>)[item.value] !== undefined,
  )?.value as string | undefined;
  const selectedUse = acceptedUse ?? "apartment";
  const fields: AssistField[] = [];

  for (const rawField of rawFields) {
    if (!isRecord(rawField)) {
      dropped.push({ path: "", why: "Field must be an object." });
      continue;
    }
    const path = typeof rawField.path === "string" ? rawField.path : "";
    const spec = catalog.fields.find((field) => field.path === path);
    if (!spec) {
      dropped.push({ path, why: "Path is not in the allowed catalogue." });
      continue;
    }

    const normalized = normalizeCatalogValue(path, spec, rawField.value);
    if (!normalized.ok) {
      dropped.push({ path, why: normalized.why });
      continue;
    }
    if (
      path === "interior.roomId" &&
      !(ROOM_IDS_BY_USE[selectedUse as keyof typeof ROOM_IDS_BY_USE] ?? []).includes(
        normalized.value as never,
      )
    ) {
      dropped.push({ path, why: "Room is invalid for the selected building use." });
      continue;
    }

    const confidence =
      typeof rawField.confidence === "number" && Number.isFinite(rawField.confidence)
        ? Math.max(0, Math.min(1, rawField.confidence))
        : 0;
    const reason = typeof rawField.reason === "string" ? rawField.reason.slice(0, 140) : "";
    fields.push({ path, value: normalized.value, confidence, reason });
  }
  return fields;
}

/** One guess about the source image: shown with its confidence, never written as a fact. */
export type SourceInference = { text: string; confidence: number };

/** The validated reply of mode `source` (ADR-040, UI-5). */
export type SourceAnalysis = AssistSuggestion & {
  /** What is visible in the image. */
  observed: string[];
  /** Guesses with a confidence; display only, never DNA. */
  inferred: SourceInference[];
  /** The wish as an English change request ("" when missing or not English). */
  requestEn: string;
  /** What must be preserved, in English. */
  keepEn: string[];
};

export const SOURCE_MAX_ITEMS = 12;
export const SOURCE_ITEM_CHARS = 160;
export const SOURCE_REQUEST_CHARS = 600;

const clipText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

const clamp01 = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/**
 * Parses the reply of mode `source`. Fields follow the catalogue rules of the other modes, and
 * sizes in {@link SOURCE_UNVERIFIABLE_PATHS} are dropped. Observed and inferred items stay
 * apart and are clipped. `requestEn` and `keepEn` must be English, otherwise they are dropped.
 */
export function parseSourceAnalysisReply(raw: string, catalog: AssistCatalog): SourceAnalysis {
  const empty = (why: string): SourceAnalysis => ({
    scope: catalog.scope,
    fields: [],
    dropped: [{ path: "", why }],
    observed: [],
    inferred: [],
    requestEn: "",
    keepEn: [],
  });
  const parsed = parseJson(raw);
  if (!parsed.ok) return empty("Reply is not valid JSON.");
  const data = parsed.data;
  if (!isRecord(data)) return empty("Reply must be a JSON object.");

  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const dropped: SourceAnalysis["dropped"] = [];
  const offered = list(data.fields).filter((item) => {
    const path = isRecord(item) && typeof item.path === "string" ? item.path : "";
    if (!SOURCE_UNVERIFIABLE_PATHS.includes(path)) return true;
    dropped.push({ path, why: "Sizes cannot be verified from one image." });
    return false;
  });
  const fields = parseFields(offered, sourceCatalog(catalog), dropped);

  const observed = list(data.observed)
    .map((item) => clipText(item, SOURCE_ITEM_CHARS))
    .filter((item): item is string => item !== null)
    .slice(0, SOURCE_MAX_ITEMS);
  const inferred = list(data.inferred)
    .map((item): SourceInference | null => {
      const text = clipText(isRecord(item) ? item.text : item, SOURCE_ITEM_CHARS);
      return text ? { text, confidence: isRecord(item) ? clamp01(item.confidence) : 0 } : null;
    })
    .filter((item): item is SourceInference => item !== null)
    .slice(0, SOURCE_MAX_ITEMS);

  let requestEn = clipText(data.requestEn, SOURCE_REQUEST_CHARS) ?? "";
  if (requestEn && containsVietnamese(requestEn)) {
    dropped.push({ path: "requestEn", why: "The change request must be English." });
    requestEn = "";
  }
  const keepEn: string[] = [];
  for (const item of list(data.keepEn)) {
    const text = clipText(item, SOURCE_ITEM_CHARS);
    if (!text) continue;
    if (containsVietnamese(text)) {
      dropped.push({ path: "keepEn", why: "Preserved items must be English." });
    } else if (keepEn.length < SOURCE_MAX_ITEMS) {
      keepEn.push(text);
    }
  }

  return { scope: catalog.scope, fields, dropped, observed, inferred, requestEn, keepEn };
}

/** The extra-prompt text written by "use this description": the change request, then what to keep. */
export function sourceAnalysisExtraPrompt(
  analysis: Pick<SourceAnalysis, "requestEn" | "keepEn">,
): string {
  return [
    analysis.requestEn.trim(),
    analysis.keepEn.length ? `Keep: ${analysis.keepEn.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const normalizeAppliedValue = (path: string, value: unknown): unknown => {
  if (path === "building.materials") {
    const descriptions = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
    if (descriptions.every((item) => typeof item === "string")) {
      return descriptions.map((description) => ({ zone: "general", description }));
    }
  }
  if (
    path === "building.specialFeatures" ||
    path === "context.front.elements" ||
    path === "context.vegetation"
  ) {
    if (typeof value === "string") return [value];
  }
  return value;
};

export function applyAssistFields(dna: ProjectDNA, fields: AssistField[]): ProjectDNA {
  const next = structuredClone(dna) as unknown as Record<string, unknown>;
  for (const { path, value } of fields) {
    const appliedPath = path === "context.vegetation" ? "context.front.vegetation" : path;
    const parts = appliedPath.split(".");
    if (parts.some((part) => !part || ["__proto__", "constructor", "prototype"].includes(part)))
      continue;
    let target = next;
    for (const part of parts.slice(0, -1)) {
      const child = target[part];
      if (!child || typeof child !== "object" || Array.isArray(child)) target[part] = {};
      target = target[part] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]!] = normalizeAppliedValue(path, value);
  }
  return ProjectDNASchema.parse(next);
}

export function containsVietnamese(text: string): boolean {
  return /[\u00E0\u00E1\u1EA1\u1EA3\u00E3\u00E2\u1EA7\u1EA5\u1EAD\u1EA9\u1EAB\u0103\u1EB1\u1EAF\u1EB7\u1EB3\u1EB5\u00E8\u00E9\u1EB9\u1EBB\u1EBD\u00EA\u1EC1\u1EBF\u1EC7\u1EC3\u1EC5\u00EC\u00ED\u1ECB\u1EC9\u0129\u00F2\u00F3\u1ECD\u1ECF\u00F5\u00F4\u1ED3\u1ED1\u1ED9\u1ED5\u1ED7\u01A1\u1EDD\u1EDB\u1EE3\u1EDF\u1EE1\u00F9\u00FA\u1EE5\u1EE7\u0169\u01B0\u1EEB\u1EE9\u1EF1\u1EED\u1EEF\u1EF3\u00FD\u1EF5\u1EF7\u1EF9\u0111]/i.test(
    text.normalize("NFC"),
  );
}
