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
  parseSourceAnalysisReply,
  SOURCE_ITEM_CHARS,
  SOURCE_MAX_ITEMS,
  sourceAnalysisExtraPrompt,
} from "../src";

describe("DNA assist domain", () => {
  it("catalogs every interior field with stable option ids", () => {
    const catalog = assistCatalog("interior", "interior");
    expect(catalog.fields.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "interior.buildingUseId",
        "interior.roomId",
        "interior.styleId",
        "interior.paletteId",
        "interior.materialPresetId",
        "interior.surfaces.floor",
        "interior.surfaces.wall",
        "interior.surfaces.ceiling",
        "interior.surfaces.cabinetry",
        "interior.surfaces.countertop",
        "interior.surfaces.textile",
        "interior.surfaces.metal",
        "interior.daylightDirection",
        "interior.daylightAmount",
        "interior.timeOfDay",
        "interior.artificialScenes",
        "interior.colorTemperatureK",
        "interior.furnitureIds",
        "interior.furnishingDensity",
        "interior.cameraPresetId",
        "interior.areaM2",
        "interior.ceilingHeightM",
      ]),
    );
    for (const field of catalog.fields.filter(({ kind }) => kind === "id" || kind === "ids")) {
      expect(field.options?.length).toBeGreaterThan(0);
    }
    expect(
      catalog.fields
        .find(({ path }) => path === "interior.buildingUseId")
        ?.options?.map(({ id }) => id),
    ).toEqual([
      "apartment",
      "studio",
      "duplex_penthouse",
      "townhouse",
      "single_storey_house",
      "villa",
      "hotel_room_suite",
      "office",
      "cafe_restaurant",
      "retail_showroom",
      "spa",
      "resort",
      "other",
    ]);
    expect(
      catalog.fields
        .find(({ path }) => path === "interior.cameraPresetId")
        ?.options?.map(({ id }) => id),
    ).toEqual(["wide_entrance", "corner", "one_point", "detail"]);
    expect(assistCatalog("building", "villa").fields.map(({ path }) => path)).toEqual([
      "building.floors",
      "building.architecturalStyle",
      "building.roof.type",
      "building.massing.composition",
      "building.materials",
      "building.specialFeatures",
    ]);
    expect(assistCatalog("context", "villa").fields.map(({ path }) => path)).toEqual([
      "context.density",
      "context.siteTopology",
      "context.front.roadType",
      "context.front.spaceType",
      "context.front.elements",
      "context.vegetation",
    ]);
    expect(assistCatalog("lighting", "villa").fields.map(({ path }) => path)).toEqual([
      "lighting.timeOfDay",
      "lighting.sunDirection",
      "lighting.intensity",
      "lighting.ambientLight",
    ]);
  });

  it("parses fenced JSON, records each rejected field, and clips text", () => {
    const catalog = assistCatalog("interior", "interior");
    const reply = parseAssistReply(
      `\`\`\`json\n${JSON.stringify({
        fields: [
          {
            path: "interior.styleId",
            value: "japandi",
            confidence: 0.9,
            reason: "Fits the calm brief.",
          },
          { path: "interior.unknown", value: "x", confidence: 1, reason: "Unknown path" },
          { path: "interior.styleId", value: "not_a_style", confidence: 1, reason: "Unknown id" },
          { path: "interior.areaM2", value: 100001, confidence: 1, reason: "Outside bounds" },
          {
            path: "interior.buildingUseId",
            value: "office",
            confidence: 0.7,
            reason: "Use mismatch",
          },
          {
            path: "interior.roomId",
            value: "bedroom",
            confidence: 0.7,
            reason: "Invalid for office",
          },
          { path: "interior.roomId", value: "reception", confidence: 0.4, reason: "r".repeat(160) },
        ],
      })}\n\`\`\``,
      catalog,
    );
    expect(reply.fields.map(({ path }) => path)).toEqual([
      "interior.styleId",
      "interior.buildingUseId",
      "interior.roomId",
    ]);
    expect(reply.fields[2]!.reason.length).toBeLessThanOrEqual(140);
    expect(reply.dropped).toHaveLength(4);
    expect(reply.dropped.every(({ why }) => why.length > 0)).toBe(true);
  });

  it("applies suggestions immutably and returns schema-valid DNA", () => {
    const dna = createInitialDNA({ projectType: "interior", pack: null });
    dna.interior = defaultInteriorDNA();
    const before = structuredClone(dna);
    const next = applyAssistFields(dna, [
      {
        path: "interior.styleId",
        value: "japandi",
        confidence: 0.8,
        reason: "Calm natural materials.",
      },
    ]);
    expect(dna).toEqual(before);
    expect(next.interior?.styleId).toBe("japandi");
    expect(ProjectDNASchema.safeParse(next).success).toBe(true);

    const withContext = applyAssistFields(dna, [
      {
        path: "context.vegetation",
        value: "native palms",
        confidence: 0.8,
        reason: "Tropical planting.",
      },
      {
        path: "building.materials",
        value: "warm brick",
        confidence: 0.8,
        reason: "Matches the brief.",
      },
    ]);
    expect(withContext.context.front.vegetation).toEqual(["native palms"]);
    expect(withContext.building.materials).toEqual([
      { zone: "general", description: "warm brick" },
    ]);
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

describe("source-image analysis (ADR-040)", () => {
  const catalog = assistCatalog("interior", "interior");
  const reply = (body: Record<string, unknown>) => JSON.stringify(body);

  it("asks for observed, inferred, fields, requestEn and keepEn without unverifiable sizes", () => {
    const prompt = assistSystemPrompt("source", catalog);
    for (const key of ["observed", "inferred", "fields", "requestEn", "keepEn"]) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain("interior.styleId");
    expect(prompt).not.toContain("interior.areaM2");
    expect(prompt).not.toContain("interior.ceilingHeightM");
  });

  it("keeps observed and inferred apart, drops unknown ids and clips text", () => {
    const long = "x".repeat(SOURCE_ITEM_CHARS + 50);
    const analysis = parseSourceAnalysisReply(
      "```json\n" +
        reply({
          observed: ["Oak floor", long, 42, ""],
          inferred: [
            { text: "Hidden storage wall", confidence: 1.7 },
            { text: "Ceiling about 3 m", confidence: 0.3 },
            "bare guess",
          ],
          fields: [
            { path: "interior.styleId", value: "japandi", confidence: 0.9, reason: "Calm" },
            { path: "interior.styleId", value: "spaceship", confidence: 0.9, reason: "?" },
            { path: "interior.unknownPath", value: "x", confidence: 1, reason: "?" },
            { path: "interior.ceilingHeightM", value: 3, confidence: 0.4, reason: "Guess" },
          ],
          requestEn: "Make it warmer at golden hour",
          keepEn: ["window layout", "giữ nguyên mái"],
        }) +
        "\n```",
      catalog,
    );
    expect(analysis.observed).toEqual(["Oak floor", "x".repeat(SOURCE_ITEM_CHARS)]);
    expect(analysis.inferred).toEqual([
      { text: "Hidden storage wall", confidence: 1 },
      { text: "Ceiling about 3 m", confidence: 0.3 },
      { text: "bare guess", confidence: 0 },
    ]);
    // Inferred items never become fields; unknown ids and unverifiable sizes are dropped.
    expect(analysis.fields).toEqual([
      { path: "interior.styleId", value: "japandi", confidence: 0.9, reason: "Calm" },
    ]);
    expect(analysis.dropped.map((d) => d.path)).toEqual(
      expect.arrayContaining([
        "interior.styleId",
        "interior.unknownPath",
        "interior.ceilingHeightM",
        "keepEn",
      ]),
    );
    expect(analysis.requestEn).toBe("Make it warmer at golden hour");
    expect(analysis.keepEn).toEqual(["window layout"]);
    expect(sourceAnalysisExtraPrompt(analysis)).toBe(
      "Make it warmer at golden hour\nKeep: window layout.",
    );
  });

  it("requires English for requestEn and caps the lists", () => {
    const analysis = parseSourceAnalysisReply(
      reply({
        observed: Array.from({ length: 30 }, (_, i) => `item ${i}`),
        requestEn: "Làm ấm hơn",
        keepEn: "not a list",
      }),
      catalog,
    );
    expect(analysis.observed).toHaveLength(SOURCE_MAX_ITEMS);
    expect(analysis.requestEn).toBe("");
    expect(analysis.keepEn).toEqual([]);
    expect(analysis.dropped.map((d) => d.path)).toContain("requestEn");
    expect(sourceAnalysisExtraPrompt(analysis)).toBe("");
  });

  it("returns an empty analysis for invalid JSON", () => {
    const analysis = parseSourceAnalysisReply("not json", catalog);
    expect(analysis).toMatchObject({ observed: [], inferred: [], fields: [], requestEn: "" });
    expect(analysis.dropped).toHaveLength(1);
  });
});
