import {
  BUILDING_USES, ROOMS, INTERIOR_STYLES, PALETTES, MATERIAL_PRESETS,
  FLOOR_MATERIALS, WALL_MATERIALS, CEILING_MATERIALS, CABINETRY_MATERIALS,
  COUNTERTOP_MATERIALS, TEXTILE_MATERIALS, METAL_FINISHES, FURNITURE,
  CAMERA_PRESETS, ROOM_IDS_BY_USE,
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
export type AssistCatalog = { scope: AssistScope; fields: AssistCatalogField[] };
export type AssistField = { path: string; value: unknown; confidence: number; reason: string };
export type AssistSuggestion = {
  scope: AssistScope;
  fields: AssistField[];
  dropped: Array<{ path: string; why: string }>;
};

const opts = (items: readonly { id: string; en: string }[]) => items.map(({ id, en }) => ({ id, en }));
const field = (path: string, kind: AssistCatalogField["kind"], options?: AssistCatalogField["options"], min?: number, max?: number): AssistCatalogField => ({ path, kind, ...(options ? { options } : {}), ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
const interiorFields = (): AssistCatalogField[] => [
  field("interior.buildingUseId", "id", opts(BUILDING_USES)), field("interior.roomId", "id", opts(ROOMS)),
  field("interior.styleId", "id", opts(INTERIOR_STYLES)), field("interior.paletteId", "id", opts(PALETTES)),
  field("interior.materialPresetId", "id", opts(MATERIAL_PRESETS)),
  ...[
    ["floor", FLOOR_MATERIALS], ["wall", WALL_MATERIALS], ["ceiling", CEILING_MATERIALS],
    ["cabinetry", CABINETRY_MATERIALS], ["countertop", COUNTERTOP_MATERIALS],
    ["textile", TEXTILE_MATERIALS], ["metal", METAL_FINISHES],
  ].map(([slot, values]) => field(`interior.surfaces.${slot}`, "ids", opts(values as typeof FLOOR_MATERIALS))),
  field("interior.daylightDirection", "id", ["front", "left", "right", "rear", "diffuse", "none"].map(id => ({ id, en: id }))),
  field("interior.daylightAmount", "id", ["low", "medium", "high"].map(id => ({ id, en: id }))),
  field("interior.timeOfDay", "id", ["morning", "midday", "afternoon", "golden_hour", "evening", "night"].map(id => ({ id, en: id.replaceAll("_", " ") }))),
  field("interior.artificialScenes", "ids", ["ambient", "task", "accent", "cove", "pendant", "downlight"].map(id => ({ id, en: id }))),
  field("interior.colorTemperatureK", "id", [2700, 3000, 3500, 4000].map(id => ({ id: String(id), en: `${id} K` }))),
  field("interior.furnitureIds", "ids", opts(FURNITURE)),
  field("interior.furnishingDensity", "id", ["minimal", "balanced", "layered"].map(id => ({ id, en: id }))),
  field("interior.cameraPresetId", "id", opts(CAMERA_PRESETS)),
  field("interior.areaM2", "number", undefined, 0.1, 100000),
  field("interior.ceilingHeightM", "number", undefined, 1, 100),
];
const buildingFields = (): AssistCatalogField[] => [
  field("building.floors", "number", undefined, 1, 200),
  field("building.architecturalStyle", "text", ["Modern tropical", "Tropical minimalist", "Bali style", "Indochine", "Neo-classical", "Minimalist", "Contemporary farmhouse", "Modern", "Contemporary", "Industrial modern", "Japandi", "Scandinavian", "Mediterranean"].map(id => ({ id, en: id }))),
  field("building.roof.type", "text"), field("building.massing.composition", "text"),
  field("building.materials", "text"), field("building.specialFeatures", "text"),
];
const contextFields = (): AssistCatalogField[] => [
  field("context.density", "id", ["low", "medium", "high"].map(id => ({ id, en: id }))),
  field("context.siteTopology", "text"), field("context.front.roadType", "text"),
  field("context.front.spaceType", "text"), field("context.front.elements", "text"), field("context.vegetation", "text"),
];
const lightingFields = (): AssistCatalogField[] => [
  field("lighting.timeOfDay", "id", ["dawn", "morning", "midday", "afternoon", "golden_hour", "blue_hour", "night"].map(id => ({ id, en: id.replaceAll("_", " ") }))),
  field("lighting.sunDirection", "text"), field("lighting.intensity", "text"), field("lighting.ambientLight", "text"),
];

export function assistCatalog(scope: AssistScope, _projectType: ProjectType): AssistCatalog {
  const fields = scope === "interior" ? interiorFields() : scope === "building" ? buildingFields() : scope === "context" ? contextFields() : lightingFields();
  return { scope, fields };
}

export function assistSystemPrompt(mode: AssistMode, catalog: AssistCatalog): string {
  const allowed = catalog.fields.map(f => `${f.path} (${f.kind})${f.options ? `: ${f.options.map(o => `${o.id} = ${o.en}`).join(", ")}` : ""}`).join("\n");
  const role = mode === "translate"
    ? "Translate only the supplied free-text DNA values into concise English. Return those paths and nothing else."
    : "You propose structured architectural project DNA from the supplied brief or images. Use English for free text.";
  return `${role}\nAllowed paths and ids:\n${allowed}\nAnswer with JSON {fields:[{path,value,confidence,reason}]} only. Pick only listed ids. Free text in English. Omit fields you cannot infer.`;
}

export function parseAssistReply(raw: string, catalog: AssistCatalog): AssistSuggestion {
  let data: unknown;
  try {
    const source = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    data = JSON.parse(source);
  } catch {
    return { scope: catalog.scope, fields: [], dropped: [{ path: "", why: "Reply is not valid JSON." }] };
  }
  const input = data && typeof data === "object" && Array.isArray((data as { fields?: unknown }).fields) ? (data as { fields: unknown[] }).fields : [];
  const fields: AssistField[] = [];
  const dropped: AssistSuggestion["dropped"] = [];
  let selectedUse = "apartment";
  const useField = input.find((item): item is Record<string, unknown> => !!item && typeof item === "object" && (item as Record<string, unknown>).path === "interior.buildingUseId");
  if (useField && typeof useField.value === "string") selectedUse = useField.value;
  for (const rawField of input) {
    if (!rawField || typeof rawField !== "object") { dropped.push({ path: "", why: "Field must be an object." }); continue; }
    const candidate = rawField as Record<string, unknown>;
    const path = typeof candidate.path === "string" ? candidate.path : "";
    const spec = catalog.fields.find(f => f.path === path);
    const drop = (why: string) => dropped.push({ path, why });
    if (!spec) { drop("Path is not in the allowed catalogue."); continue; }
    let value = candidate.value;
    if (spec.kind === "id" || spec.kind === "ids") {
      const choices = spec.options?.map(o => o.id) ?? [];
      const ids = spec.kind === "ids" ? value : [value];
      if (!Array.isArray(ids) || !ids.every(v => typeof v === "string" && choices.includes(v))) { drop("Value contains an id outside the allowed catalogue."); continue; }
      if (path === "interior.roomId" && !(ROOM_IDS_BY_USE[selectedUse as keyof typeof ROOM_IDS_BY_USE] ?? []).includes(ids[0] as never)) { drop("Room is invalid for the selected building use."); continue; }
      if (spec.kind === "id" && path === "interior.colorTemperatureK") value = Number(value);
      else value = spec.kind === "ids" ? ids : ids[0];
    } else if (spec.kind === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || (spec.min !== undefined && value < spec.min) || (spec.max !== undefined && value > spec.max)) { drop("Number is outside the allowed range."); continue; }
    } else {
      if (path === "building.materials" || path === "building.specialFeatures" || path === "context.front.elements" || path === "context.vegetation") {
        if (typeof value !== "string" && !(Array.isArray(value) && value.every(v => typeof v === "string"))) { drop("Value must be English text."); continue; }
        value = (Array.isArray(value) ? value.join(", ") : value as string).slice(0, 240);
      } else if (typeof value !== "string") { drop("Value must be text."); continue; }
      else value = value.slice(0, 240);
    }
    const confidence = typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence) ? Math.max(0, Math.min(1, candidate.confidence)) : 0;
    const reason = (typeof candidate.reason === "string" ? candidate.reason : "").slice(0, 140);
    fields.push({ path, value, confidence, reason });
  }
  return { scope: catalog.scope, fields, dropped };
}

export function applyAssistFields(dna: ProjectDNA, fields: AssistField[]): ProjectDNA {
  const next = structuredClone(dna) as unknown as Record<string, unknown>;
  for (const { path, value } of fields) {
    const parts = path.split(".");
    let target = next;
    for (const part of parts.slice(0, -1)) {
      const child = target[part];
      if (!child || typeof child !== "object") target[part] = {};
      target = target[part] as Record<string, unknown>;
    }
    target[parts.at(-1)!] = value;
  }
  return ProjectDNASchema.parse(next);
}

export function containsVietnamese(text: string): boolean {
  return /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text.normalize("NFC"));
}
