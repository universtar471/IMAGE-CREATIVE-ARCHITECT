import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BUILDING_USES,
  COMPILER_VERSION,
  INTERIOR_CATALOG,
  MATERIAL_PRESETS,
  ProjectDNASchema,
  ROOMS,
  applyStyleDefaults,
  compilePrompt,
  createInitialDNA,
  defaultInteriorDNA,
  furnitureForRoom,
  presetSurfaces,
  proposeInteriorFromLegacy,
  roomsForUse,
  styleDefaults,
  validateProjectDNA,
  type InteriorDNA,
  type KnowledgePack,
} from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();

describe("Interior DNA catalog", () => {
  it("has unique ids and complete, valid references", () => {
    const lists = [
      INTERIOR_CATALOG.buildingUses,
      INTERIOR_CATALOG.rooms,
      INTERIOR_CATALOG.styles,
      INTERIOR_CATALOG.palettes,
      INTERIOR_CATALOG.materialPresets,
      ...Object.values(INTERIOR_CATALOG.surfaces),
      INTERIOR_CATALOG.furniture,
      INTERIOR_CATALOG.cameraPresets,
    ];
    for (const list of lists) {
      expect(new Set(list.map(({ id }) => id)).size).toBe(list.length);
      for (const option of list) {
        expect(option.vi.trim()).not.toBe("");
        expect(option.en.trim()).not.toBe("");
        expect(option.prompt.trim()).not.toBe("");
      }
    }
    expect(INTERIOR_CATALOG.buildingUses.some(({ vi }) => /[ăâêôơưđ]/i.test(vi))).toBe(true);
    expect(INTERIOR_CATALOG.rooms.some(({ vi }) => /[àáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũ]/i.test(vi))).toBe(
      true,
    );

    const paletteIds = new Set(INTERIOR_CATALOG.palettes.map(({ id }) => id));
    const presetIds = new Set(MATERIAL_PRESETS.map(({ id }) => id));
    for (const style of INTERIOR_CATALOG.styles) {
      expect(paletteIds.has(style.paletteId)).toBe(true);
      expect(presetIds.has(style.materialPresetId)).toBe(true);
    }
    for (const palette of INTERIOR_CATALOG.palettes) {
      expect(palette.swatches.length).toBeGreaterThanOrEqual(3);
      expect(palette.swatches.length).toBeLessThanOrEqual(5);
      palette.swatches.forEach((swatch) => expect(swatch).toMatch(/^#[0-9A-F]{6}$/i));
    }
    for (const preset of MATERIAL_PRESETS) {
      expect(Object.keys(preset.surfaces).sort()).toEqual(
        ["floor", "wall", "ceiling", "cabinetry", "countertop", "textile", "metal"].sort(),
      );
      for (const [slot, ids] of Object.entries(preset.surfaces)) {
        expect(ids.length).toBeGreaterThan(0);
        const valid = new Set(
          INTERIOR_CATALOG.surfaces[slot as keyof typeof INTERIOR_CATALOG.surfaces].map(
            ({ id }) => id,
          ),
        );
        ids.forEach((id) => expect(valid.has(id)).toBe(true));
      }
    }
    for (const options of Object.values(INTERIOR_CATALOG.surfaces)) {
      options.forEach(({ swatch }) => expect(swatch).toMatch(/^#[0-9A-F]{6}$/i));
    }
  });

  it("cascades rooms for every use and always permits other", () => {
    const allRooms = ROOMS.map(({ id }) => id);
    for (const { id } of BUILDING_USES) {
      expect(roomsForUse(id)).toContain("other");
      expect(new Set(roomsForUse(id)).size).toBe(roomsForUse(id).length);
      roomsForUse(id).forEach((room) => expect(allRooms).toContain(room));
    }
    expect(roomsForUse("other")).toEqual(allRooms);
    expect(roomsForUse("villa")).toContain("prayer_room");
    expect(roomsForUse("villa")).toContain("lobby");
    expect(roomsForUse("apartment")).not.toContain("lobby");
    expect(furnitureForRoom("living_room")).toEqual([
      "sofa",
      "armchair",
      "coffee_table",
      "media_console",
      "rug",
    ]);
  });
});

describe("Interior DNA helpers and schema", () => {
  it("applies style defaults without replacing user-set surface slots or mutating input", () => {
    const original = defaultInteriorDNA();
    const customized: InteriorDNA = {
      ...original,
      paletteId: "blue_coastal",
      materialPresetId: undefined,
      surfaces: { ...original.surfaces, floor: ["walnut"], wall: [] },
    };
    const before = structuredClone(customized);
    const applied = applyStyleDefaults(customized, "tropical");
    expect(customized).toEqual(before);
    expect(applied.paletteId).toBe("green_natural");
    expect(applied.materialPresetId).toBe("tropical_craft");
    expect(applied.surfaces.floor).toEqual(["walnut"]);
    expect(applied.surfaces.wall).toEqual(presetSurfaces("tropical_craft").wall);
    expect(styleDefaults("tropical")).toEqual({
      paletteId: "green_natural",
      materialPresetId: "tropical_craft",
    });
  });

  it("proposes exact case- and diacritics-insensitive legacy matches without mutation", () => {
    const dna = createInitialDNA({ projectType: "interior", pack: null });
    dna.building.buildingType = "CAN HO";
    dna.building.architecturalStyle = "jAPANDI";
    dna.building.colorPalette = ["BE AM"];
    dna.building.materials = [
      { zone: "Sàn", description: "GO SOI" },
      { zone: "walls", description: "Limewash" },
      { zone: "ceiling", description: "not a catalog material" },
    ];
    const before = structuredClone(dna);
    const result = proposeInteriorFromLegacy(dna);
    expect(dna).toEqual(before);
    expect(result.proposal).toMatchObject({
      buildingUseId: "apartment",
      roomId: "living_room",
      styleId: "japandi",
      surfaces: { floor: ["oak"], wall: ["limewash"] },
    });
    expect(result.matched).toEqual([
      "building.buildingType",
      "building.architecturalStyle",
      "building.colorPalette.0",
      "building.materials.0",
      "building.materials.1",
    ]);
  });

  it("folds Đ consistently when matching the Indochine legacy style", () => {
    for (const value of ["Đông Dương", "dong duong", "DONG DUONG"]) {
      const dna = createInitialDNA({ projectType: "interior", pack: null });
      dna.building.architecturalStyle = value;
      expect(proposeInteriorFromLegacy(dna).proposal.styleId).toBe("indochine");
    }
  });

  it("uses architect-correct Vietnamese material labels", () => {
    expect(INTERIOR_CATALOG.surfaces.floor.find(({ id }) => id === "microcement")?.vi).toBe(
      "Microcement",
    );
    expect(INTERIOR_CATALOG.surfaces.wall.find(({ id }) => id === "microcement")?.vi).toBe(
      "Microcement",
    );
    expect(INTERIOR_CATALOG.surfaces.metal.find(({ id }) => id === "brushed_brass")?.vi).toBe(
      "Đồng thau xước",
    );
    expect(INTERIOR_CATALOG.surfaces.metal.find(({ id }) => id === "bronze")?.vi).toBe(
      "Đồng giả cổ",
    );
  });

  it("defaults arrays and reports room and per-slot refinements at their fields", () => {
    const parsed = ProjectDNASchema.parse({
      ...createInitialDNA({ projectType: "interior", pack: null }),
      interior: {
        schemaVersion: 1,
        buildingUseId: "office",
        roomId: "meeting_room",
        styleId: "modern",
      },
    });
    expect(parsed.interior?.surfaces.floor).toEqual([]);
    expect(parsed.interior?.artificialScenes).toEqual([]);
    expect(parsed.interior?.furnitureIds).toEqual([]);
    expect(parsed.interior?.furnishingDensity).toBe("balanced");

    const invalidRoom = validateProjectDNA({
      ...parsed,
      interior: { ...parsed.interior, roomId: "bedroom" },
    });
    expect(invalidRoom).toMatchObject({
      ok: false,
      fieldErrors: { "interior.roomId": expect.any(String) },
    });
    const invalidSurface = validateProjectDNA({
      ...parsed,
      interior: {
        ...parsed.interior,
        surfaces: { ...parsed.interior!.surfaces, floor: ["paint"] },
      },
    });
    expect(invalidSurface).toMatchObject({
      ok: false,
      fieldErrors: { "interior.surfaces.floor.0": expect.any(String) },
    });
  });
});

function legacyPack(pack: KnowledgePack | null): KnowledgePack | null {
  if (!pack?.sampleDefaults) return pack;
  const { sampleDefaults, ...rest } = pack;
  return {
    ...rest,
    packVersion: "1.3.0",
    defaults: {
      building: { ...rest.defaults.building, ...sampleDefaults.building },
      context: { ...rest.defaults.context, ...sampleDefaults.context },
    },
  };
}

describe("Interior prompt compiler pc-1.8.0", () => {
  function compilerInput() {
    const pack = registry.resolve("interior").pack!;
    const dna = createInitialDNA({ projectType: "interior", pack });
    dna.interior = {
      ...defaultInteriorDNA(),
      surfaces: {
        floor: ["oak", "terrazzo"],
        wall: ["limewash"],
        ceiling: [],
        cabinetry: ["oak_veneer"],
        countertop: [],
        textile: ["linen"],
        metal: ["matte_black"],
      },
      furnitureIds: ["sofa", "armchair", "coffee_table"],
      furnishingDensity: "balanced",
      timeOfDay: "morning",
      daylightAmount: "high",
      daylightDirection: "left",
      artificialScenes: ["ambient", "accent"],
      colorTemperatureK: 3000,
      cameraPresetId: "wide_entrance",
    };
    return {
      project: { id: "PRJ_INTERIOR", name: "Living room", projectType: "interior" as const },
      dna,
      references: [],
      pack,
    };
  }

  // ADR-034: the pack's "residential apartment" is sample data, so a new interior project no
  // longer carries it and the prompt has no context section.
  it("compiles the full Japandi living-room example in stable section order", () => {
    const bundle = compilePrompt(compilerInput());
    expect(COMPILER_VERSION).toBe("pc-1.8.0");
    expect(bundle.metadata.sections).toEqual([
      "subject",
      "form",
      "language",
      "materials",
      "furnishing",
      "lighting",
      "camera",
      "quality",
    ]);
    expect(bundle.positivePrompt).toMatchInlineSnapshot(`
      "Architectural visualization (interior view) of an interior space, project type: interior.

      Interior space: apartment living room.

      Interior style: Japandi interior: calm minimal forms, pale timber, soft neutral tones, fine craftsmanship.

      Materials and colors: warm beige, ivory and natural wood; floor: natural oak flooring with terrazzo accents; walls: soft limewash walls; cabinetry: oak veneer cabinetry; textiles: natural linen textiles; metal: matte black metal.

      Furnishing: sofa, armchair, coffee table; balanced furnishing density.

      Interior lighting: morning, high daylight from the left, ambient lighting and accent lighting, warm 3000 K.

      Camera: wide view from the entrance showing the whole room.

      Photorealistic professional architectural photography, accurate proportions, straight verticals, high detail."
    `);
  });

  it("renders the first material in each slot as primary and later materials as ordered accents", () => {
    const input = compilerInput();
    input.dna.interior!.surfaces = {
      floor: ["oak", "terrazzo"],
      wall: ["paint", "limewash"],
      ceiling: [],
      cabinetry: [],
      countertop: [],
      textile: [],
      metal: [],
    };

    expect(compilePrompt(input).positivePrompt).toContain(
      "floor: natural oak flooring with terrazzo accents; walls: smooth matte warm-white painted walls with soft limewash walls accents",
    );
  });

  it("omits empty material slots and lets camera DNA override the preset fallback", () => {
    const input = compilerInput();
    const prompt = compilePrompt(input).positivePrompt;
    expect(prompt).not.toMatch(/ceiling:|countertop:/);
    expect(prompt).toContain("Camera: wide view from the entrance");
    input.dna.cameras = [
      {
        schemaVersion: 1,
        id: "CAM_01J00000000000000000000001",
        name: "One point",
        viewType: "interior_wide",
        isAnchorView: false,
        lensMm: 24,
        notes: "",
      },
    ];
    expect(
      compilePrompt({ ...input, cameraId: input.dna.cameras[0]!.id }).positivePrompt,
    ).toContain("Camera: wide interior view; lens: 24 mm wide-angle lens.");
  });

  it("maps each interior camera preset to its own fallback text", () => {
    const input = compilerInput();
    const expected = {
      wide_entrance: "wide view from the entrance showing the whole room",
      corner: "two-point perspective from a room corner",
      one_point: "one-point perspective facing the main wall",
      detail: "close-up material and furniture detail",
    } as const;
    for (const [id, phrase] of Object.entries(expected)) {
      input.dna.interior!.cameraPresetId = id as keyof typeof expected;
      expect(compilePrompt(input).positivePrompt).toContain(`Camera: ${phrase}`);
    }
  });

  it("falls back to the wide framing for missing and unknown camera presets", () => {
    const input = compilerInput();
    input.dna.interior!.cameraPresetId = undefined;
    expect(compilePrompt(input).positivePrompt).toContain(
      "Camera: wide view from the entrance showing the whole room",
    );

    input.dna.interior!.cameraPresetId = "not_a_preset" as never;
    expect(compilePrompt(input).positivePrompt).toContain(
      "Camera: wide view from the entrance showing the whole room",
    );
  });

  it("does not fall back to legacy materials when the interior selection is empty", () => {
    const input = compilerInput();
    input.dna.building.materials = [{ zone: "facade", description: "legacy brick" }];
    input.dna.building.colorPalette = ["legacy red"];
    input.dna.interior = {
      ...input.dna.interior!,
      paletteId: undefined,
      materialPresetId: undefined,
      surfaces: {
        floor: [],
        wall: [],
        ceiling: [],
        cabinetry: [],
        countertop: [],
        textile: [],
        metal: [],
      },
    };
    const bundle = compilePrompt(input);
    expect(bundle.metadata.sections).not.toContain("materials");
    expect(bundle.positivePrompt).not.toContain("legacy brick");
    expect(bundle.positivePrompt).not.toContain("legacy red");
  });

  it("keeps every legacy project-type output equal to the pc-1.3.0 golden bundles", () => {
    const golden = JSON.parse(
      readFileSync(
        new URL("../test-vectors/legacy-compiler-pc-1.3.0.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, ReturnType<typeof compilePrompt>>;
    for (const [projectType, expected] of Object.entries(golden)) {
      // Old projects persisted the interior sample values (5 x 6 x 3 m, "residential
      // apartment") as DNA; ADR-034 moved them to `sampleDefaults`. Rebuild the pack as those
      // projects saw it, so the golden checks that their DNA still compiles to the same text.
      const pack = legacyPack(
        registry.resolve(projectType as Parameters<typeof registry.resolve>[0]).pack,
      );
      const dna = createInitialDNA({
        projectType: projectType as Parameters<typeof createInitialDNA>[0]["projectType"],
        pack,
        starter: { contextPresetId: pack?.contextPresets[0]?.id },
      });
      const actual = compilePrompt({
        project: { id: `PRJ_${projectType}`, name: "Golden", projectType: projectType as never },
        dna: ProjectDNASchema.parse(dna),
        references: [],
        pack,
      });
      // pc-1.3.0 had no provenance fields (ADR-034); the prompt text must be unchanged.
      const {
        validatorVersion,
        catalogVersion,
        sourceHash,
        configHash,
        resolvedWarnings,
        ...legacy
      } = actual;
      expect([validatorVersion, catalogVersion]).toEqual(["cv-1.2.0", "none"]);
      expect(sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(resolvedWarnings).toEqual([]);
      expect({ ...legacy, compilerVersion: "pc-1.3.0" }).toEqual(expected);
    }
  });
});
