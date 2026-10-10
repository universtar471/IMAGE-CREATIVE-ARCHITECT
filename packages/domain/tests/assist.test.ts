import { describe, expect, it } from "vitest";
import {
  ProjectDNASchema,
  applyAssistFields,
  assistCatalog,
  assistSystemPrompt,
  containsVietnamese,
  createInitialDNA,
  defaultInteriorDNA,
  parseAssistReply,
} from "../src";

describe("DNA assist domain", () => {
  it("catalogs every interior field with stable option ids", () => {
    const catalog = assistCatalog("interior", "interior");
    expect(catalog.fields.map(({ path }) => path)).toEqual(expect.arrayContaining([
      "interior.buildingUseId", "interior.roomId", "interior.styleId", "interior.paletteId",
      "interior.materialPresetId", "interior.surfaces.floor", "interior.surfaces.wall",
      "interior.surfaces.ceiling", "interior.surfaces.cabinetry", "interior.surfaces.countertop",
      "interior.surfaces.textile", "interior.surfaces.metal", "interior.daylightDirection",
      "interior.daylightAmount", "interior.timeOfDay", "interior.artificialScenes",
      "interior.colorTemperatureK", "interior.furnitureIds", "interior.furnishingDensity",
      "interior.cameraPresetId", "interior.areaM2", "interior.ceilingHeightM",
    ]));
    for (const field of catalog.fields.filter(({ kind }) => kind === "id" || kind === "ids")) {
      expect(field.options?.length).toBeGreaterThan(0);
    }
    expect(assistCatalog("building", "villa").fields.map(({ path }) => path)).toEqual([
      "building.floors", "building.architecturalStyle", "building.roof.type", "building.massing.composition",
      "building.materials", "building.specialFeatures",
    ]);
    expect(assistCatalog("context", "villa").fields.map(({ path }) => path)).toEqual([
      "context.density", "context.siteTopology", "context.front.roadType", "context.front.spaceType",
      "context.front.elements", "context.vegetation",
    ]);
    expect(assistCatalog("lighting", "villa").fields.map(({ path }) => path)).toEqual([
      "lighting.timeOfDay", "lighting.sunDirection", "lighting.intensity", "lighting.ambientLight",
    ]);
  });

  it("parses fenced JSON, records each rejected field, and clips text", () => {
    const catalog = assistCatalog("interior", "interior");
    const reply = parseAssistReply(`\`\`\`json\n${JSON.stringify({ fields: [
      { path: "interior.styleId", value: "japandi", confidence: 0.9, reason: "Fits the calm brief." },
      { path: "interior.unknown", value: "x", confidence: 1, reason: "Unknown path" },
      { path: "interior.styleId", value: "not_a_style", confidence: 1, reason: "Unknown id" },
      { path: "interior.areaM2", value: 100001, confidence: 1, reason: "Outside bounds" },
      { path: "interior.buildingUseId", value: "office", confidence: 0.7, reason: "Use mismatch" },
      { path: "interior.roomId", value: "bedroom", confidence: 0.7, reason: "Invalid for office" },
      { path: "interior.roomId", value: "reception", confidence: 0.4, reason: "r".repeat(160) },
    ] })}\n\`\`\``, catalog);
    expect(reply.fields.map(({ path }) => path)).toEqual([
      "interior.styleId", "interior.buildingUseId", "interior.roomId",
    ]);
    expect(reply.fields[2]!.reason.length).toBeLessThanOrEqual(140);
    expect(reply.dropped).toHaveLength(4);
    expect(reply.dropped.every(({ why }) => why.length > 0)).toBe(true);
  });

  it("applies suggestions immutably and returns schema-valid DNA", () => {
    const dna = createInitialDNA({ projectType: "interior", pack: null });
    dna.interior = defaultInteriorDNA();
    const before = structuredClone(dna);
    const next = applyAssistFields(dna, [{
      path: "interior.styleId", value: "japandi", confidence: 0.8, reason: "Calm natural materials.",
    }]);
    expect(dna).toEqual(before);
    expect(next.interior?.styleId).toBe("japandi");
    expect(ProjectDNASchema.safeParse(next).success).toBe(true);
  });

  it("detects Vietnamese diacritics and prompts for JSON-only allowed ids", () => {
    expect(containsVietnamese("Nhà phố ấm cúng")).toBe(true);
    expect(containsVietnamese("Warm townhouse")).toBe(false);
    const prompt = assistSystemPrompt("brief", assistCatalog("interior", "interior"));
    expect(prompt).toContain("japandi");
    expect(prompt).toContain("Answer with JSON");
    expect(prompt).toContain("only");
  });
});
