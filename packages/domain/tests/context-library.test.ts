import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_LIBRARY,
  CONTEXT_LIBRARY_VERSION,
  CONTEXT_ARCHETYPE_IDS,
  ProjectDNASchema,
  contextSuggestionsFor,
  suggestContext,
} from "../src";
import { CONTEXT_ARCHETYPE_ALLOWLIST } from "../../../tools/context-library/convert";
import {
  OUTPUT_PATH,
  convertContextLibrary,
  readContextSource,
  serializeContextLibrary,
} from "../../../tools/context-library/convert";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
    "utf8",
  ),
);

describe("context library converter", () => {
  it("imports only the five allowlisted archetypes", () => {
    const { source, regions, labels } = readContextSource();
    const file = convertContextLibrary(source, regions, labels);
    expect(file.libraryVersion).toBe(CONTEXT_LIBRARY_VERSION);
    expect(file.presets).toHaveLength(53);
    expect(file.buildingTypes.map((type) => type.id)).toEqual([...CONTEXT_ARCHETYPE_ALLOWLIST]);
    expect(file.presets.map((preset) => preset.buildingType)).toEqual(
      expect.not.arrayContaining(["shophouse", "cafe", "office", "industrial"]),
    );
    expect(file.regions).toHaveLength(12);
  });

  it("rebuilds clean ASCII English prompts and is deterministic", async () => {
    const { source, regions, labels } = readContextSource();
    const first = await serializeContextLibrary(convertContextLibrary(source, regions, labels));
    const second = await serializeContextLibrary(
      convertContextLibrary(
        structuredClone(source),
        structuredClone(regions),
        structuredClone(labels),
      ),
    );
    expect(second).toBe(first);
    expect(readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(first);
    expect(first).toMatch(/Depict a Townhouse in the specific setting of Urban infill townhouse/);
    const english = convertContextLibrary(source, regions, labels).presets.flatMap((preset) => [
      preset.nameEn,
      preset.englishPrompt,
      ...preset.requiredIfSupported,
      ...preset.optional,
      ...preset.forbiddenByDefault,
    ]);
    expect(english.join(" ")).toMatch(/^[\x20-\x7e]*$/);
  });

  it("rejects an unaccented Vietnamese label in English output", () => {
    const { source, regions, labels } = readContextSource();
    expect(() =>
      convertContextLibrary(source, regions, {
        ...labels,
        presets: { ...labels.presets, "townhouse.urban_infill": "nha pho" },
      }),
    ).toThrow(/unaccented Vietnamese label/);
  });
});

describe("context library registry and evidence-subordinate suggestions", () => {
  it("loads the generated registry and scopes suggestions by archetype", () => {
    expect(CONTEXT_LIBRARY.issues).toEqual([]);
    expect(CONTEXT_LIBRARY.presets).toHaveLength(53);
    expect(contextSuggestionsFor("townhouse")).toHaveLength(12);
    expect(contextSuggestionsFor("shophouse")).toEqual([]);
    expect(CONTEXT_ARCHETYPE_IDS).toEqual(["townhouse", "villa", "apartment", "hotel", "resort"]);
  });

  it("drops party-wall and lawn cues that contradict site evidence without mutating DNA", () => {
    const dna = ProjectDNASchema.parse({
      ...fixture,
      site: {
        version: 1,
        coordinateConvention: "viewer_facing_front_facade",
        front: { kind: "street", evidence: { status: "verified", sourceAssetIds: [] } },
        left: { kind: "open_space", evidence: { status: "verified", sourceAssetIds: [] } },
        right: { kind: "attached_building", evidence: { status: "verified", sourceAssetIds: [] } },
        rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
      },
    });
    const before = JSON.stringify(dna);
    const urban = suggestContext(dna, "townhouse.urban_infill", "unspecified");
    expect(urban.requiredLines).not.toContain("continuous party-wall neighbors");
    expect(urban.droppedForEvidence).toContain("continuous party-wall neighbors");
    expect(urban.regionDetails).toEqual([]);
    expect(urban.regionAvoid).toEqual([]);

    const retreat = suggestContext(dna, "hotel.retreat");
    expect(retreat.requiredLines).not.toContain(
      "private grounds and documented recreational landscape",
    );
    expect(retreat.droppedForEvidence).toContain(
      "private grounds and documented recreational landscape",
    );
    expect(JSON.stringify(dna)).toBe(before);
  });
});
