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

export type AssistMode = "brief" | "images" | "master" | "translate";
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

export function assistSystemPrompt(mode: AssistMode, catalog: AssistCatalog): string {
  const allowed = catalog.fields
    .map((field) => {
      const choices = field.options?.map((option) => `${option.id} = ${option.en}`).join(", ");
      return `${field.path} (${field.kind})${choices ? `: ${choices}` : ""}`;
    })
    .join("\n");
  const role =
    mode === "translate"
      ? "Translate only the supplied free-text DNA values into concise English. Return those paths and nothing else."
      : "You propose structured architectural project DNA from the supplied brief or images. Use English for free text.";
  return `${role}\nAllowed paths and ids:\n${allowed}\nAnswer with JSON {fields:[{path,value,confidence,reason}]} only. Pick only listed ids. Free text in English. Omit fields you cannot infer.`;
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

export function parseAssistReply(raw: string, catalog: AssistCatalog): AssistSuggestion {
  let data: unknown;
  try {
    data = JSON.parse(unwrapJson(raw));
  } catch {
    return {
      scope: catalog.scope,
      fields: [],
      dropped: [{ path: "", why: "Reply is not valid JSON." }],
    };
  }

  const dropped: AssistSuggestion["dropped"] = [];
  const rawFields = isRecord(data) && Array.isArray(data.fields) ? data.fields : [];
  if (!isRecord(data) || !Array.isArray(data.fields)) {
    dropped.push({ path: "", why: "Reply must contain a fields array." });
  }

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

  return { scope: catalog.scope, fields, dropped };
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
