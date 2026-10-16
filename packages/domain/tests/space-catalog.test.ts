import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CATALOG_VERSION,
  COMPILER_VERSION,
  CUSTOM_SPACE_PRESET_ID,
  INTERIOR_ROOM_BY_PRESET,
  NO_CATALOG_VERSION,
  ProjectDNASchema,
  ROOMS,
  SPACE_ARCHETYPE_IDS,
  SPACE_CATALOG,
  SpaceCatalogRegistry,
  compilePrompt,
  createInitialDNA,
  defaultInteriorDNA,
  interiorRoomForPreset,
  resolveActiveSpace,
  spaceScopeLines,
  spacesFor,
  suggestArchetype,
  validateShot,
  type ProjectDNA,
  type SpaceCatalogExtension,
  type SpaceInstance,
} from "../src";
import {
  CatalogBuildError,
  OUTPUT_PATH,
  convertCatalog,
  readSource,
  serializeCatalog,
} from "../../../tools/space-catalog/convert";
import { loadSeedRegistry } from "./helpers";

/** Real townhouse DNA (the user's project, as in validation.test). */
const townhouse = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

const space = (
  id: string,
  presetId: string,
  extra: Partial<SpaceInstance> = {},
): SpaceInstance => ({
  id,
  presetId,
  facts: {},
  lockedElementIds: [],
  approvedOptionalIds: [],
  ...extra,
});

const withCatalog = (
  dna: ProjectDNA,
  buildingArchetype: string,
  spaces: SpaceInstance[],
  activeSpaceId?: string,
): ProjectDNA => {
  const extension: SpaceCatalogExtension = { version: 1, buildingArchetype, spaces };
  if (activeSpaceId) extension.activeSpaceId = activeSpaceId;
  return { ...dna, spaceCatalog: extension };
};

const compile = (dna: ProjectDNA, projectType: "townhouse" | "villa" | "interior" = "townhouse") =>
  compilePrompt({ project: { id: "PRJ_SPACE", name: "Space", projectType }, dna, references: [] });

const verified = { status: "verified" as const, sourceAssetIds: ["AST_plan"] };

// ---------------------------------------------------------------- converter

describe("space catalog converter (tools/space-catalog/convert.ts)", () => {
  const { source, labels } = readSource();

  it("imports exactly the 152 presets of the five allowlisted archetypes", () => {
    const file = convertCatalog(source, labels);
    expect(file.catalogVersion).toBe(CATALOG_VERSION);
    expect(file.presets).toHaveLength(152);
    expect(file.archetypes.map((a) => a.id)).toEqual([...SPACE_ARCHETYPE_IDS]);
    const counts = Object.fromEntries(
      SPACE_ARCHETYPE_IDS.map((a) => [
        a,
        file.presets.filter((p) => p.buildingArchetypes[0] === a).length,
      ]),
    );
    expect(counts).toEqual({ townhouse: 35, villa: 44, apartment: 27, hotel: 24, resort: 22 });
    for (const skipped of [
      "cafe",
      "restaurant",
      "office",
      "retail",
      "education",
      "healthcare",
      "public",
    ])
      expect(JSON.stringify(file)).not.toContain(`"${skipped}.`);
  });

  it("uses the curated English labels inside the scope text", () => {
    const file = convertCatalog(source, labels);
    const living = file.presets.find((p) => p.id === "townhouse.living.phong_khach_rieng")!;
    expect(living.labelEn).toBe("separate living room");
    expect(living.scopeEn).toContain("of the separate living room in a townhouse project");
    expect(living.scopeEn).not.toMatch(/phong khach/i);
    const apartment = file.presets.find((p) => p.id === "apartment.living.phong_khach_rieng")!;
    expect(apartment.scopeEn).toContain("in an apartment project");
  });

  it("maps zones from the category", () => {
    const file = convertCatalog(source, labels);
    const zone = (id: string) => file.presets.find((p) => p.id === id)!.zone;
    expect(zone("villa.outdoor.san_vuon_rong")).toBe("exterior");
    expect(zone("townhouse.outdoor.ban_cong")).toBe("semi_outdoor");
    expect(zone("apartment.outdoor.loggia")).toBe("semi_outdoor");
    expect(zone("townhouse.outdoor.san_thuong")).toBe("semi_outdoor");
    expect(zone("villa.outdoor.rooftop")).toBe("semi_outdoor");
    expect(zone("resort.outdoor.san_hien")).toBe("semi_outdoor");
    expect(zone("villa.sleeping.master_suite")).toBe("interior");
  });

  it("writes only ASCII English and no unaccented Vietnamese", () => {
    const file = convertCatalog(source, labels);
    for (const p of file.presets) {
      const english = [p.labelEn, p.scopeEn, ...p.requiredIfVerified, ...p.optional]
        .map((x) => (typeof x === "string" ? x : x.en))
        .join(" ");
      expect(english, p.id).toMatch(/^[\x20-\x7e]*$/);
      expect(p.labelVi, p.id).not.toBe("");
    }
  });

  it("fails on a missing English label", () => {
    const { ["townhouse.living.phong_khach_rieng"]: _dropped, ...rest } = labels;
    expect(() => convertCatalog(source, rest)).toThrow(CatalogBuildError);
    expect(() => convertCatalog(source, rest)).toThrow(
      /townhouse.living.phong_khach_rieng: no English label/,
    );
  });

  it("fails on non-ASCII English and on an unaccented label left in the prompt", () => {
    expect(() =>
      convertCatalog(source, { ...labels, "villa.sleeping.phong_ngu_khach": "phòng ngủ khách" }),
    ).toThrow(/non-ASCII/);
    const broken = structuredClone(source);
    const record = broken.presets.find((p) => p.id === "villa.outdoor.san_vuon_rong")!;
    record.englishPrompt += " Keep the san vuon rong lawn.";
    expect(() => convertCatalog(broken, labels)).toThrow(/unaccented label "san vuon rong"/);
  });

  it("fails on a label for an unknown or out-of-scope preset", () => {
    expect(() => convertCatalog(source, { ...labels, "cafe.service.kho": "storage" })).toThrow(
      /unknown preset: cafe.service.kho/,
    );
  });

  it("is deterministic and matches the checked-in catalog (run `npm run catalog:build`)", async () => {
    const a = await serializeCatalog(convertCatalog(source, labels));
    const b = await serializeCatalog(convertCatalog(structuredClone(source), { ...labels }));
    expect(b).toBe(a);
    expect(readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n")).toBe(a);
  });
});

// ---------------------------------------------------------------- registry, mapping

describe("space catalog registry", () => {
  it("loads the bundled catalog without issues", () => {
    expect(SPACE_CATALOG.issues).toEqual([]);
    expect(SPACE_CATALOG.size).toBe(152);
    expect(CATALOG_VERSION).toBe("sc-3.0.0");
  });

  it("lists spaces per archetype in catalog order", () => {
    const townhouseSpaces = spacesFor("townhouse");
    expect(townhouseSpaces).toHaveLength(35);
    expect(townhouseSpaces[0]!.id).toBe("townhouse.living.phong_khach_rieng");
    expect(townhouseSpaces.map((p) => p.id)).toContain("townhouse.outdoor.san_sau_hep");
    // A townhouse never suggests the villa pool or the large villa garden (SRS §4.2).
    expect(townhouseSpaces.some((p) => p.id.startsWith("villa."))).toBe(false);
    expect(spacesFor("office")).toEqual([]);
    expect(SPACE_CATALOG.categoriesFor("townhouse")).toEqual([
      "living",
      "kitchen_dining",
      "sleeping",
      "special",
      "outdoor",
      "service",
    ]);
  });

  it("reports an invalid catalog instead of throwing", () => {
    const broken = new SpaceCatalogRegistry({ catalogVersion: "sc-0", presets: [] });
    expect(broken.size).toBe(0);
    expect(broken.issues).toHaveLength(1);
    expect(broken.preset("townhouse.living.phong_khach_rieng")).toBeNull();
  });

  it("suggests an archetype without touching the project type", () => {
    expect(suggestArchetype("townhouse")).toBe("townhouse");
    expect(suggestArchetype("urban_villa")).toBe("villa");
    expect(suggestArchetype("resort")).toBe("resort");
    for (const type of ["cafe", "office", "commercial", "custom", "single_storey_house"] as const)
      expect(suggestArchetype(type), type).toBeNull();
    expect(suggestArchetype("interior")).toBeNull();
    expect(suggestArchetype("interior", "duplex_penthouse")).toBe("apartment");
    expect(suggestArchetype("interior", "office")).toBeNull();
  });

  it("maps presets to existing interior rooms only", () => {
    const rooms = new Set<string>(ROOMS.map((r) => r.id));
    for (const [presetId, room] of Object.entries(INTERIOR_ROOM_BY_PRESET)) {
      expect(SPACE_CATALOG.preset(presetId), presetId).not.toBeNull();
      expect(rooms.has(room), room).toBe(true);
    }
    expect(interiorRoomForPreset("apartment.sleeping.phong_ngu_master")).toBe("master_bedroom");
    expect(interiorRoomForPreset("villa.outdoor.san_vuon_rong")).toBeNull();
    expect(interiorRoomForPreset("constructor")).toBeNull();
  });
});

// ---------------------------------------------------------------- resolver

describe("resolveActiveSpace / spaceScopeLines", () => {
  const base = townhouse();

  it("returns null without a catalog or an active space", () => {
    expect(resolveActiveSpace(base)).toBeNull();
    expect(spaceScopeLines(base)).toEqual([]);
    const noActive = withCatalog(base, "townhouse", [
      space("SPC_1", "townhouse.outdoor.san_sau_hep"),
    ]);
    expect(resolveActiveSpace(noActive)).toBeNull();
  });

  it("resolves the active space, a shot target, custom spaces and unknown presets", () => {
    const dna = withCatalog(
      base,
      "townhouse",
      [
        space("SPC_1", "townhouse.outdoor.san_sau_hep"),
        space("SPC_2", CUSTOM_SPACE_PRESET_ID, { label: "Góc đọc sách" }),
        space("SPC_3", "townhouse.retired.preset"),
      ],
      "SPC_1",
    );
    expect(resolveActiveSpace(dna)).toMatchObject({
      space: { id: "SPC_1" },
      preset: { id: "townhouse.outdoor.san_sau_hep", zone: "exterior" },
      custom: false,
    });
    expect(resolveActiveSpace(dna, { targetSpaceId: "SPC_2" })).toMatchObject({
      preset: null,
      custom: true,
    });
    expect(resolveActiveSpace(dna, { targetSpaceId: "SPC_3" })).toMatchObject({
      preset: null,
      custom: false,
    });
    expect(spaceScopeLines(dna, { targetSpaceId: "SPC_3" })).toEqual([]);
    expect(spaceScopeLines(dna, { targetSpaceId: "SPC_2" })[0]).toBe(
      'Space scope: render only the selected custom space "Góc đọc sách"; do not merge in other spaces of the building.',
    );
  });

  it("states required items only when verified, and lists approved optional and forbidden items", () => {
    const courtyard = space("SPC_1", "townhouse.outdoor.san_sau_hep", {
      approvedOptionalIds: ["outdoor_seating"],
      facts: {
        respect_narrow_rear_plot_boundaries: { value: true, evidence: verified },
        unsupported_pools_or_oversized_lawns: { value: true, evidence: verified },
        widthM: { value: 3.25, evidence: verified },
        depthM: { value: 4, evidence: { status: "inferred", sourceAssetIds: [] } },
      },
    });
    const lines = spaceScopeLines(withCatalog(base, "townhouse", [courtyard], "SPC_1"));
    expect(lines).toEqual([
      "Space scope: render only the compact rear courtyard of this townhouse (outdoor space); do not merge in other spaces of the building.",
      "Verified dimensions: width 3.25 m.",
      "Confirmed elements: respect narrow rear plot boundaries.",
      "Only if present in the approved references: plausible outdoor materials; surface drainage and safe access; compact drainage-aware layout.",
      "Approved optional additions, only where they physically fit: outdoor seating.",
      "Do not introduce: unverified new doors or windows; altered locked walls, columns or stairs; invented dimensions or site views; floating or physically impossible objects; unrequested change of room function; interior-only furnishings exposed to rain; side garden or panoramic side glazing without verified openings.",
    ]);
  });
});

// ---------------------------------------------------------------- validator

describe("SPACE_NOT_IN_BUILDING (SRS §12.4)", () => {
  const shot = { projectType: "townhouse" as const, cameraId: null };
  const check = (dna: ProjectDNA, targetSpaceId?: string) =>
    validateShot({ dna, shotIntent: { ...shot, targetSpaceId } });

  it("blocks a preset that does not belong to the archetype", () => {
    const dna = withCatalog(
      townhouse(),
      "townhouse",
      [space("SPC_pool", "villa.outdoor.ho_boi")],
      "SPC_pool",
    );
    const result = check(dna);
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "SPACE_NOT_IN_BUILDING",
        severity: "BLOCK",
        exceptionAllowed: false,
        path: "spaceCatalog.spaces[0]",
        params: { presetId: "villa.outdoor.ho_boi", archetype: "townhouse" },
      }),
    ]);
    // An exception cannot clear a BLOCK.
    expect(
      validateShot({ dna, shotIntent: shot, approvedExceptions: ["SPACE_NOT_IN_BUILDING"] })
        .verdict,
    ).toBe("BLOCK");
  });

  it("warns on an unknown preset id, and the warning can be accepted", () => {
    const dna = withCatalog(
      townhouse(),
      "townhouse",
      [space("SPC_1", "townhouse.outdoor.san_sau_hep"), space("SPC_x", "townhouse.v4.preset")],
      "SPC_1",
    );
    expect(check(dna).verdict).toBe("ALLOW");
    const result = check(dna, "SPC_x");
    expect(result.verdict).toBe("WARN");
    expect(result.issues[0]).toMatchObject({
      code: "SPACE_NOT_IN_BUILDING",
      severity: "WARN",
      path: "spaceCatalog.spaces[1]",
    });
    expect(
      validateShot({
        dna,
        shotIntent: { ...shot, targetSpaceId: "SPC_x" },
        approvedExceptions: ["SPACE_NOT_IN_BUILDING"],
      }).verdict,
    ).toBe("ALLOW");
  });

  it("ignores custom spaces and DNA without a catalog", () => {
    expect(check(townhouse()).issues).toEqual([]);
    const custom = withCatalog(
      townhouse(),
      "townhouse",
      [space("SPC_c", CUSTOM_SPACE_PRESET_ID, { label: "Studio" })],
      "SPC_c",
    );
    expect(check(custom).issues).toEqual([]);
  });
});

// ---------------------------------------------------------------- compiler

describe("SPACE SCOPE compiler section (pc-1.9.0)", () => {
  it("is absent and versioned 'none' without a catalog; an inactive catalog changes no text", () => {
    const dna = townhouse();
    const plain = compile(dna);
    expect(COMPILER_VERSION).toBe("pc-1.9.0");
    expect(plain.catalogVersion).toBe(NO_CATALOG_VERSION);
    expect(plain.metadata.sections).not.toContain("spaceScope");
    expect(plain.positivePrompt).not.toContain("Space scope");

    const inactive = compile(
      withCatalog(dna, "townhouse", [space("SPC_1", "townhouse.outdoor.san_sau_hep")]),
    );
    expect(inactive.catalogVersion).toBe(CATALOG_VERSION);
    expect(inactive.positivePrompt).toBe(plain.positivePrompt);
    expect(inactive.negativePrompt).toBe(plain.negativePrompt);
    expect(inactive.preservationInstructions).toBe(plain.preservationInstructions);
  });

  it("adds one section, right after the subject, for the active space only", () => {
    const dna = withCatalog(
      townhouse(),
      "townhouse",
      [
        space("SPC_bed", "townhouse.sleeping.phong_ngu_master"),
        space("SPC_yard", "townhouse.outdoor.san_sau_hep"),
      ],
      "SPC_yard",
    );
    const bundle = compile(dna);
    expect(bundle.catalogVersion).toBe(CATALOG_VERSION);
    expect((bundle.metadata.sections as string[]).slice(0, 2)).toEqual(["subject", "spaceScope"]);
    const scope = bundle.positivePrompt.split("\n\n")[1]!;
    expect(scope).toMatch(/^Space scope: render only the compact rear courtyard of this townhouse/);
    expect(bundle.positivePrompt).not.toContain("master bedroom");
    expect(JSON.stringify(compile(structuredClone(dna)))).toBe(JSON.stringify(bundle));
  });

  it("AC-02: a garden scope never receives bedroom-furniture lines", () => {
    const bedroomWords =
      /\b(?:beds?|bedside|wardrobes?|nightstands?|headboards?|mattress|dressing table|sleeping furniture)\b/i;
    // Exterior villa project: the bedroom is in the project but not active.
    const villa = withCatalog(
      townhouse(),
      "villa",
      [
        space("SPC_master", "villa.sleeping.master_suite", {
          approvedOptionalIds: ["wardrobe_storage", "bedside_lights"],
        }),
        space("SPC_garden", "villa.outdoor.san_vuon_rong", {
          approvedOptionalIds: ["outdoor_seating"],
        }),
      ],
      "SPC_garden",
    );
    const exterior = compile(villa, "villa");
    expect(exterior.positivePrompt).toContain("render only the large villa garden of this villa");
    expect(exterior.positivePrompt).not.toMatch(bedroomWords);

    // Interior project whose interior DNA describes a master bedroom, with the garden active:
    // the bedroom furnishing line is dropped.
    const interiorDna = ProjectDNASchema.parse({
      ...createInitialDNA({ projectType: "interior", pack: null }),
      interior: {
        ...defaultInteriorDNA("villa", "master_bedroom"),
        furnitureIds: ["bed", "wardrobe"],
      },
      spaceCatalog: villa.spaceCatalog,
    });
    const garden = compile(interiorDna, "interior");
    expect(garden.metadata.sections).not.toContain("furnishing");
    expect(garden.positivePrompt).not.toMatch(bedroomWords);

    // Same DNA with the bedroom active keeps its furnishing.
    interiorDna.spaceCatalog!.activeSpaceId = "SPC_master";
    const bedroom = compile(interiorDna, "interior");
    expect(bedroom.metadata.sections).toContain("furnishing");
    expect(bedroom.positivePrompt).toMatch(/Furnishing: bed/);
  });
});

// ---------------------------------------------------------------- sample pack values

describe("interior sample defaults (ADR-034)", () => {
  const registry = loadSeedRegistry();

  it("are marked as samples and not copied into new projects", () => {
    for (const subtype of ["default", "living_room"]) {
      const pack = registry.resolve("interior", subtype).pack!;
      expect(pack.sampleDefaults?.note, subtype).toMatch(/^Sample only, not verified/);
      expect(pack.defaults.context.macroContext).toBeUndefined();
      expect(pack.defaults.building.dimensions).toBeUndefined();
      const dna = createInitialDNA({ projectType: "interior", subtype, pack });
      expect(dna.building.dimensions).toEqual({});
      expect(dna.context.macroContext).toBeUndefined();
      const prompt = compile(dna, "interior").positivePrompt;
      expect(prompt).not.toMatch(/residential apartment|5 m x 6 m|height 3 m/);
    }
    expect(
      registry.resolve("interior", "living_room").pack!.sampleDefaults!.building.dimensions,
    ).toEqual({
      widthM: 5,
      depthM: 6,
      heightM: 3,
    });
  });

  it("keeps old projects that persisted the sample values loading unchanged", () => {
    const pack = registry.resolve("interior", "living_room").pack!;
    const old = createInitialDNA({ projectType: "interior", subtype: "living_room", pack });
    old.building.dimensions = { widthM: 5, depthM: 6, heightM: 3 };
    old.context.macroContext = "residential apartment";
    expect(ProjectDNASchema.parse(JSON.parse(JSON.stringify(old)))).toEqual(old);
  });
});
