import { ProjectDNASchema, type ProjectDNA } from "@arch/domain";
import { setIn } from "./path";

export type AssistMode = "brief" | "images" | "master" | "translate";
export type AssistScope = "interior" | "building" | "context" | "lighting";
export type AssistCatalog = {
  scope: AssistScope;
  fields: Array<{
    path: string;
    kind: "id" | "ids" | "number" | "text";
    options?: Array<{ id: string; en: string }>;
    min?: number;
    max?: number;
  }>;
};
export type AssistField = { path: string; value: unknown; confidence: number; reason: string };
export type AssistSuggestion = {
  scope: AssistScope;
  fields: AssistField[];
  dropped: Array<{ path: string; why: string }>;
};

// TODO(assist-core): replace with @arch/domain assistCatalog when wt/assist-core lands.
export function assistCatalog(scope: AssistScope, _projectType: string): AssistCatalog {
  const fields: Record<AssistScope, AssistCatalog["fields"]> = {
    interior: [
      { path: "interior.buildingUseId", kind: "id", options: [{ id: "house", en: "House" }, { id: "office", en: "Office" }, { id: "retail", en: "Retail" }, { id: "hospitality", en: "Hospitality" }] },
      { path: "interior.roomId", kind: "id", options: [{ id: "living_room", en: "Living room" }, { id: "bedroom", en: "Bedroom" }, { id: "kitchen", en: "Kitchen" }, { id: "meeting_room", en: "Meeting room" }] },
      { path: "interior.styleId", kind: "id", options: [{ id: "japandi", en: "Japandi" }, { id: "modern", en: "Modern" }, { id: "scandinavian", en: "Scandinavian" }, { id: "wabi_sabi", en: "Wabi-Sabi" }] },
      { path: "interior.paletteId", kind: "id", options: [{ id: "warm_neutral", en: "Warm neutral" }, { id: "cool_neutral", en: "Cool neutral" }] },
      { path: "interior.furnishingDensity", kind: "id", options: [{ id: "minimal", en: "Minimal" }, { id: "balanced", en: "Balanced" }, { id: "layered", en: "Layered" }] },
      { path: "interior.areaM2", kind: "number", min: 1, max: 10000 },
      { path: "interior.ceilingHeightM", kind: "number", min: 1, max: 20 },
    ],
    building: [
      { path: "building.floors", kind: "number", min: 1, max: 100 },
      { path: "building.architecturalStyle", kind: "text" },
      { path: "building.roof.type", kind: "text" },
      { path: "building.massing.composition", kind: "text" },
      { path: "building.notes", kind: "text" },
    ],
    context: [
      { path: "context.macroContext", kind: "text" },
      { path: "context.climateContext", kind: "text" },
      { path: "context.density", kind: "id", options: [{ id: "urban", en: "Urban" }, { id: "suburban", en: "Suburban" }, { id: "rural", en: "Rural" }] },
    ],
    lighting: [
      { path: "lighting.timeOfDay", kind: "id", options: ["dawn", "morning", "midday", "afternoon", "golden_hour", "blue_hour", "night"].map((id) => ({ id, en: id.replaceAll("_", " ") })) },
      { path: "lighting.sunDirection", kind: "text" },
      { path: "lighting.intensity", kind: "text" },
      { path: "lighting.ambientLight", kind: "text" },
    ],
  };
  return { scope, fields: fields[scope] };
}

// TODO(assist-core): replace with @arch/domain prompt builder when wt/assist-core lands.
export function assistSystemPrompt(mode: AssistMode, catalog: AssistCatalog): string {
  const allowed = catalog.fields.map((field) => `${field.path}: ${field.options?.map((item) => `${item.id} (${item.en})`).join(", ") ?? field.kind}`).join("\n");
  return mode === "translate"
    ? "Translate the supplied free text into concise English. Return JSON fields only."
    : `Suggest ${catalog.scope} DNA from the user input. Answer with JSON {fields:[{path,value,confidence,reason}]} only. Pick only listed ids. Free text in English. Omit fields you cannot infer.\n${allowed}`;
}

// TODO(assist-core): replace with @arch/domain reply parser when wt/assist-core lands.
export function parseAssistReply(raw: string, catalog: AssistCatalog): AssistSuggestion {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text) as { fields?: unknown };
  const fields: AssistField[] = [];
  const dropped: AssistSuggestion["dropped"] = [];
  for (const candidate of Array.isArray(parsed.fields) ? parsed.fields : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const path = typeof item.path === "string" ? item.path : "";
    const definition = catalog.fields.find((field) => field.path === path);
    const value = item.value;
    const validType = definition && (definition.kind === "number" ? typeof value === "number" : typeof value === "string");
    const validId = definition?.options ? definition.options.some((option) => option.id === value) : true;
    const validRange = definition?.kind !== "number" || typeof value !== "number" || ((definition.min === undefined || value >= definition.min) && (definition.max === undefined || value <= definition.max));
    if (!definition || !validType || !validId || !validRange) {
      dropped.push({ path, why: "Unknown field or value" });
      continue;
    }
    fields.push({ path, value: typeof value === "string" ? value.slice(0, 500) : value, confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)), reason: typeof item.reason === "string" ? item.reason.slice(0, 140) : "" });
  }
  return { scope: catalog.scope, fields, dropped };
}

// TODO(assist-core): replace with @arch/domain schema-backed apply helper when available.
export function applyAssistFields(dna: ProjectDNA, fields: AssistField[]): ProjectDNA {
  let next: unknown = structuredClone(dna);
  for (const field of fields) next = setIn(next, field.path, field.value);
  const result = ProjectDNASchema.safeParse(next);
  if (!result.success) throw new Error("The AI proposal is not valid for this project.");
  return result.data;
}

export function containsVietnamese(text: string): boolean {
  return /[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/u.test(text);
}
