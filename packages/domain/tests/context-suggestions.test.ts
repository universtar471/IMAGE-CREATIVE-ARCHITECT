/** SRS P1d: Context Library V4 in the DNA (`context.library`) and the CONTEXT SUGGESTIONS section. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONTEXT_LIBRARY_VERSION,
  ContextLibrarySelectionSchema,
  ProjectDNASchema,
  compilePrompt,
  resolveSiteAdjacency,
  suggestContext,
  type ContextLibrarySelection,
  type ProjectDNA,
  type ProjectType,
  type PromptCompileInput,
} from "../src";

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

/** Attached townhouse (both neighbours attached, inferred from the ADR-028 hints). */
const townhouse = () =>
  ProjectDNASchema.parse(readJson("../../../apps/desktop/tests/fixtures/nhapho-dna.json"));

const withLibrary = (dna: ProjectDNA, library: Omit<ContextLibrarySelection, "version">) =>
  ProjectDNASchema.parse({
    ...dna,
    context: { ...dna.context, library: { version: 1, ...library } },
  });

const compile = (dna: ProjectDNA, projectType: ProjectType = "townhouse", cameraIndex = 0) => {
  const input: PromptCompileInput = {
    project: { id: "PRJ_P1D", name: "P1d", projectType, subtype: null },
    dna,
    references: [{ assetId: "AST_MASTER", role: "master_architecture" }],
    cameraId: dna.cameras[cameraIndex]?.id ?? null,
  };
  return compilePrompt(input);
};

const suggestionParagraph = (positive: string) =>
  positive.split("\n\n").find((p) => p.startsWith("CONTEXT SUGGESTIONS"));

describe("context.library schema", () => {
  it("is optional: old DNA parses unchanged and gains no library key", () => {
    const raw = readJson("../../../apps/desktop/tests/fixtures/nhapho-dna.json");
    const parsed = ProjectDNASchema.parse(raw);
    expect(parsed).toEqual(raw);
    expect("library" in parsed.context).toBe(false);
  });

  it("round-trips through save and reopen", () => {
    const raw = readJson("../test-vectors/dna-v1-extensions.json");
    const opened = ProjectDNASchema.parse(raw);
    const reopened = ProjectDNASchema.parse(JSON.parse(JSON.stringify(opened)));
    expect(reopened).toEqual(raw);
    expect(reopened.context.library).toEqual({
      version: 1,
      presetId: "townhouse.urban_infill",
      regionId: "vn_south_urban",
      approvedOptional: ["site-appropriate vegetation"],
    });
  });

  it("defaults approvedOptional and rejects bad values", () => {
    expect(
      ContextLibrarySelectionSchema.parse({
        version: 1,
        presetId: "villa.lake",
        regionId: "alpine",
      }),
    ).toEqual({ version: 1, presetId: "villa.lake", regionId: "alpine", approvedOptional: [] });
    for (const bad of [
      { version: 2, presetId: "villa.lake", regionId: "alpine" },
      { version: 1, presetId: " ", regionId: "alpine" },
      { version: 1, presetId: "villa.lake" },
    ])
      expect(ContextLibrarySelectionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

describe("CONTEXT SUGGESTIONS section", () => {
  it("builds required, approved optional, region and forbidden cues from suggestContext", () => {
    const dna = withLibrary(townhouse(), {
      presetId: "townhouse.urban_infill",
      regionId: "vn_south_urban",
      approvedOptional: ["site-appropriate vegetation"],
    });
    const bundle = compilePrompt({
      project: { id: "PRJ_P1D", name: "P1d", projectType: "townhouse", subtype: null },
      dna,
      references: [],
    });
    const section = suggestionParagraph(bundle.positivePrompt)!;
    expect(section).toBe(
      "CONTEXT SUGGESTIONS (lowest priority; verified site evidence, the master image and the site and occlusion rules always win): Urban infill townhouse, Southern urban Vietnam (tropical monsoon). " +
        "Include only when consistent with verified site evidence: continuous party-wall neighbors; street frontage; realistic road access. " +
        "Approved optional cues: site-appropriate vegetation. " +
        "Regional details where supported: urban shophouse and townhouse patterns when evidenced; local street activity with restraint. " +
        "Regional avoids: automatic detached lawns. " +
        "Do not introduce: expansive lawn; detached villa grounds.",
    );
    // Optional cues the user did not approve stay out.
    expect(section).not.toContain("restrained local activity");
    expect(section).not.toContain("realistic surface weathering");
    expect(bundle.metadata.sections).toContain("contextSuggestions");
    expect(bundle.metadata.contextLibraryVersion).toBe(CONTEXT_LIBRARY_VERSION);
    // Lowest priority: the last section before the closing quality line.
    const sections = bundle.metadata.sections as string[];
    expect(sections.indexOf("contextSuggestions")).toBe(sections.length - 2);
  });

  it("is deterministic", () => {
    const dna = withLibrary(townhouse(), {
      presetId: "townhouse.alley",
      regionId: "unspecified",
      approvedOptional: ["restrained local activity", "realistic surface weathering"],
    });
    const a = compile(dna);
    expect(JSON.stringify(compile(structuredClone(dna)))).toBe(JSON.stringify(a));
    // "unspecified" adds no region line; approved optional cues keep the library order.
    const section = suggestionParagraph(a.positivePrompt)!;
    expect(section).toMatch(/: Alley townhouse\. /);
    expect(section).not.toContain("Regional");
    expect(section).toContain(
      "Approved optional cues: restrained local activity; realistic surface weathering.",
    );
  });

  it("drops villa-grounds cues on an attached townhouse and never contradicts SITE & OCCLUSION", () => {
    const base = townhouse();
    const adjacency = resolveSiteAdjacency(base, "townhouse");
    expect([adjacency.left.kind, adjacency.right.kind]).toEqual([
      "attached_building",
      "attached_building",
    ]);
    const dna = withLibrary(base, {
      presetId: "villa.detached",
      regionId: "unspecified",
      approvedOptional: [],
    });
    const suggestion = suggestContext(dna, "villa.detached", "unspecified", "townhouse");
    // "four exposed elevations" asks for free sides; "attached party walls" forbids what the
    // evidence establishes. Both contradict the site, so both are dropped.
    expect(suggestion.droppedForEvidence).toEqual([
      "four exposed elevations",
      "attached party walls",
    ]);
    const bundle = compile(dna);
    const section = suggestionParagraph(bundle.positivePrompt)!;
    for (const dropped of suggestion.droppedForEvidence) expect(section).not.toContain(dropped);
    expect(section).toContain(
      "Include only when consistent with verified site evidence: private plot; proportionate landscaping.",
    );
    expect(section).not.toContain("Do not introduce");
    expect(bundle.preservationInstructions).toContain("SITE & OCCLUSION PRESERVATION:");
    expect(bundle.preservationInstructions).toContain("Keep the party walls hidden and attached");

    const retreat = suggestContext(dna, "hotel.retreat", null, "townhouse");
    expect(retreat.droppedForEvidence).toEqual([
      "private grounds and documented recreational landscape",
    ]);
    const retreatSection = suggestionParagraph(
      compile(
        withLibrary(base, {
          presetId: "hotel.retreat",
          regionId: "unspecified",
          approvedOptional: [],
        }),
      ).positivePrompt,
    )!;
    expect(retreatSection).not.toContain("grounds");
    expect(retreatSection).not.toContain("Include only when");
  });

  it("keeps the party-wall cue on a fully attached townhouse (the front street is no contradiction)", () => {
    const dna = withLibrary(townhouse(), {
      presetId: "townhouse.urban_infill",
      regionId: "unspecified",
      approvedOptional: [],
    });
    const suggestion = suggestContext(dna, "townhouse.urban_infill", "unspecified", "townhouse");
    expect(suggestion.droppedForEvidence).toEqual([]);
    expect(suggestion.requiredLines).toContain("continuous party-wall neighbors");
    // One attached + one open side: the one-side-attached preset fits, a corner preset does not.
    const oneSide = ProjectDNASchema.parse({
      ...dna,
      site: {
        version: 1,
        coordinateConvention: "viewer_facing_front_facade",
        front: { kind: "street", evidence: { status: "verified", sourceAssetIds: [] } },
        left: { kind: "open_space", evidence: { status: "verified", sourceAssetIds: [] } },
        right: { kind: "attached_building", evidence: { status: "verified", sourceAssetIds: [] } },
        rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
      },
    });
    expect(suggestContext(oneSide, "townhouse.one_side_attached").droppedForEvidence).toEqual([]);
    expect(suggestContext(dna, "townhouse.one_side_attached").droppedForEvidence).toEqual([
      "one attached neighbor and one exposed side boundary",
    ]);
    expect(suggestContext(oneSide, "townhouse.corner_lot").droppedForEvidence).toEqual([
      "two street-facing elevations",
      "intersection and pedestrian access",
    ]);
  });

  it("leaves the bundle unchanged without context.library (apart from the version)", () => {
    const plain = townhouse();
    const library = withLibrary(plain, {
      presetId: "townhouse.urban_infill",
      regionId: "vn_north_urban",
      approvedOptional: [],
    });
    for (const cameraIndex of [0, 2]) {
      const without = compile(plain, "townhouse", cameraIndex);
      const withIt = compile(library, "townhouse", cameraIndex);
      expect(without.positivePrompt).not.toContain("CONTEXT SUGGESTIONS");
      expect(without.metadata.sections).not.toContain("contextSuggestions");
      expect("contextLibraryVersion" in without.metadata).toBe(false);
      // Adding the library only inserts its own paragraph; everything else is identical.
      expect(
        withIt.positivePrompt
          .split("\n\n")
          .filter((p) => !p.startsWith("CONTEXT SUGGESTIONS"))
          .join("\n\n"),
      ).toBe(without.positivePrompt);
      expect(withIt.negativePrompt).toBe(without.negativePrompt);
      expect(withIt.referenceInstructions).toBe(without.referenceInstructions);
      expect(withIt.preservationInstructions).toBe(without.preservationInstructions);
      expect(withIt.configHash).not.toBe(without.configHash);
    }
  });

  it("is absent for interiors and for a preset the library no longer has", () => {
    const dna = withLibrary(townhouse(), {
      presetId: "townhouse.urban_infill",
      regionId: "vn_north_urban",
      approvedOptional: [],
    });
    const interior = compile(dna, "interior");
    expect(interior.positivePrompt).not.toContain("CONTEXT SUGGESTIONS");
    expect("contextLibraryVersion" in interior.metadata).toBe(false);

    const stale = withLibrary(townhouse(), {
      presetId: "townhouse.removed_later",
      regionId: "region_removed_later",
      approvedOptional: [],
    });
    const bundle = compile(stale);
    expect(bundle.positivePrompt).not.toContain("CONTEXT SUGGESTIONS");
    expect(bundle.configHash).toBe(compile(townhouse()).configHash);
    // An unknown region falls back to "unspecified".
    const unknownRegion = withLibrary(townhouse(), {
      presetId: "townhouse.alley",
      regionId: "region_removed_later",
      approvedOptional: [],
    });
    expect(suggestionParagraph(compile(unknownRegion).positivePrompt)).not.toContain("Regional");
  });
});
