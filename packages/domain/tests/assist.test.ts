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
  validateAssistSuggestion,
} from "../src";

describe("DNA assist domain", () => {
  it.each(["interior", "villa"] as const)(
    "validates and applies all DNA recommendation scopes for %s",
    (projectType) => {
      const dna = createInitialDNA({ projectType, pack: null });
      if (projectType === "interior") dna.interior = defaultInteriorDNA();
      for (const scope of [
        "interior",
        "building",
        "context",
        "lighting",
        "style",
        "camera",
        "mood",
        "rooms",
      ] as const) {
        if (projectType !== "interior" && ["interior", "rooms"].includes(scope)) continue;
        const catalog = assistCatalog(scope, projectType);
        const result = parseAssistReply(
          JSON.stringify({
            fields: catalog.fields
              .filter((f) => f.path !== "context.siteTopology")
              .map((f) => ({
                path: f.path,
                value:
                  f.kind === "ids"
                    ? [f.options![0]!.id]
                    : f.kind === "id"
                      ? f.options![0]!.id
                      : f.kind === "number"
                        ? (f.min ?? 1)
                        : "calm natural setting",
              })),
          }),
          catalog,
          dna,
        );
        const accepted = validateAssistSuggestion(dna, result);
        expect(accepted.fields.length).toBeGreaterThan(0);
        expect(ProjectDNASchema.safeParse(applyAssistFields(dna, accepted.fields)).success).toBe(
          true,
        );
      }
    },
  );

  it("preserves locks and rejects unknown paths and malformed content", () => {
    const dna = createInitialDNA({ projectType: "villa", pack: null });
    dna.locks.building = true;
    const fields = [
      { path: "building.floors", value: 5, confidence: 1, reason: "" },
      { path: "context.__proto__.polluted", value: true, confidence: 1, reason: "" },
    ];
    expect(applyAssistFields(dna, fields)).toEqual(dna);
    expect(parseAssistReply("not JSON", assistCatalog("building", "villa")).fields).toEqual([]);
    expect(
      parseAssistReply(
        '{"fields":[{"path":"building.floors","value":9999}]}',
        assistCatalog("building", "villa"),
      ).fields,
    ).toEqual([]);
  });
  it("recovers wrapped JSON, aliases and valid members without inventing unknown ids", () => {
    const result = parseAssistReply(
      'Here is the result:\n```json\n{"fields":[{"path":"interior.styleId","value":"Japandi"},{"path":"interior.furnitureIds","value":["sofa","unknown"]},{"path":"interior.areaM2","value":"42"},]}\n```',
      assistCatalog("interior", "interior"),
    );
    expect(result.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "interior.styleId", value: "japandi" }),
        expect.objectContaining({ path: "interior.furnitureIds", value: ["sofa"] }),
        expect.objectContaining({ path: "interior.areaM2", value: 42 }),
      ]),
    );
    expect(result.dropped.length).toBeGreaterThan(0);
  });

  it("uses current building use for room validation and accepts nested partial DNA", () => {
    const dna = createInitialDNA({ projectType: "interior", pack: null });
    dna.interior = defaultInteriorDNA("office", "reception");
    const result = parseAssistReply(
      '{"interior":{"roomId":"reception","styleId":"Modern"}}',
      assistCatalog("interior", "interior"),
      dna,
    );
    expect(result.fields.map((field) => field.path)).toContain("interior.roomId");
    expect(applyAssistFields(dna, result.fields).interior?.roomId).toBe("reception");
  });

  it("uses interior lighting fields and schema-safe apply for all returned fields", () => {
    const catalog = assistCatalog("lighting", "interior");
    expect(catalog.fields.map((field) => field.path)).toContain("interior.timeOfDay");
    expect(catalog.fields.some((field) => field.path.startsWith("lighting."))).toBe(false);
    const dna = createInitialDNA({ projectType: "interior", pack: null });
    dna.interior = defaultInteriorDNA();
    const fields = parseAssistReply(
      '{"fields":[{"path":"interior.timeOfDay","value":"Evening"}]}',
      catalog,
      dna,
    ).fields;
    expect(applyAssistFields(dna, fields).interior?.timeOfDay).toBe("evening");
  });
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
