import { describe, expect, it } from "vitest";
import { createInitialDNA, KnowledgeRegistry, ProjectDNASchema } from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();

describe("seed knowledge packs", () => {
  it("all seed packs are valid", () => {
    expect(registry.issues).toEqual([]);
  });

  it.each([
    "townhouse",
    "single_storey_house",
    "villa",
    "urban_villa",
    "prefab_modular",
    "interior",
  ] as const)("has a default pack for %s", (type) => {
    expect(registry.resolve(type).match).toBe("type_default");
  });
});

describe("pack resolution", () => {
  it("finds an exact subtype", () => {
    const r = registry.resolve("villa", "tropical");
    expect(r.match).toBe("exact");
    expect(r.pack?.subtype).toBe("tropical");
  });

  it("falls back to the type default for an unknown subtype", () => {
    const r = registry.resolve("villa", "underwater");
    expect(r.match).toBe("type_default");
    expect(r.pack?.subtype).toBe("default");
  });

  it("falls back to custom for a type without packs", () => {
    expect(registry.resolve("hotel").match).toBe("custom_fallback");
  });

  it("returns none with an empty registry instead of throwing", () => {
    expect(new KnowledgeRegistry([]).resolve("villa")).toEqual({ pack: null, match: "none" });
  });

  it("reports invalid packs without throwing", () => {
    const r = new KnowledgeRegistry([{ source: "bad", data: { projectType: "castle" } }]);
    expect(r.size).toBe(0);
    expect(r.issues).toHaveLength(1);
  });

  it("lists the default subtype first", () => {
    expect(registry.listSubtypes("villa").map((p) => p.subtype)).toEqual(["default", "tropical"]);
  });
});

describe("createInitialDNA", () => {
  it("merges pack defaults, context preset and wizard input (wizard wins)", () => {
    const pack = registry.resolve("villa", "tropical").pack;
    const dna = createInitialDNA({
      projectType: "villa",
      subtype: "tropical",
      pack,
      starter: { floors: 3, contextPresetId: "garden_pool", dimensions: { widthM: 12 } },
    });
    expect(dna.building.floors).toBe(3);
    expect(dna.building.architecturalStyle).toBe("Modern tropical");
    expect(dna.building.subtype).toBe("tropical");
    expect(dna.building.dimensions.widthM).toBe(12);
    expect(dna.context.rear.spaceType).toBe("swimming pool and garden");
    // pack front vegetation survives the preset merge of the same zone
    expect(dna.context.front.vegetation).toEqual(["palms", "tropical shrubs"]);
    expect(dna.context.negativeConstraints).toContain("snow");
  });

  it("produces valid DNA with no pack at all", () => {
    const dna = createInitialDNA({ projectType: "hotel", pack: null });
    expect(ProjectDNASchema.safeParse(dna).success).toBe(true);
    expect(dna.building.buildingType).toBe("Hotel");
  });

  it("does not depend on the pack after creation", () => {
    const pack = structuredClone(registry.resolve("townhouse").pack);
    const dna = createInitialDNA({ projectType: "townhouse", pack });
    const snapshot = JSON.stringify(dna);
    pack!.defaults.building.floors = 99;
    pack!.negativeConstraints.push("changed later");
    expect(JSON.stringify(dna)).toBe(snapshot);
  });

  it("does not store the default subtype marker in DNA", () => {
    const dna = createInitialDNA({
      projectType: "villa",
      subtype: "default",
      pack: registry.resolve("villa").pack,
    });
    expect(dna.building.subtype).toBeUndefined();
  });

  it("serializes without undefined values", () => {
    const dna = createInitialDNA({
      projectType: "interior",
      pack: registry.resolve("interior").pack,
    });
    expect(JSON.stringify(dna)).not.toContain("undefined");
  });
});

describe("camera presets", () => {
  const packs = [
    ...new Set(
      (
        [
          "townhouse",
          "single_storey_house",
          "villa",
          "urban_villa",
          "prefab_modular",
          "interior",
          "custom",
        ] as const
      ).flatMap((t) => registry.listSubtypes(t)),
    ),
  ];

  it("every seed pack has 4–7 presets with unique ids and at least 2 anchor suggestions", () => {
    expect(packs.length).toBe(registry.size);
    for (const pack of packs) {
      const where = `${pack.projectType}/${pack.subtype}`;
      expect(pack.cameraPresets.length, where).toBeGreaterThanOrEqual(4);
      expect(pack.cameraPresets.length, where).toBeLessThanOrEqual(7);
      const ids = pack.cameraPresets.map((p) => p.id);
      expect(new Set(ids).size, where).toBe(ids.length);
      expect(
        pack.cameraPresets.filter((p) => p.anchorRecommended).length,
        where,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("uses realistic architectural photography values", () => {
    for (const pack of packs) {
      const interior = pack.projectType === "interior";
      for (const p of pack.cameraPresets) {
        const where = `${pack.projectType}/${pack.subtype}/${p.id}`;
        expect(p.lensMm, where).toBeDefined();
        if (p.viewType === "detail" || p.viewType === "interior_detail") continue;
        if (interior) {
          expect(p.viewType, where).toMatch(/^interior_/);
          expect(p.lensMm, where).toBeGreaterThanOrEqual(16);
          expect(p.lensMm, where).toBeLessThanOrEqual(24);
        } else {
          expect(p.lensMm, where).toBeGreaterThanOrEqual(24);
          expect(p.lensMm, where).toBeLessThanOrEqual(35);
        }
        if (p.viewType === "aerial") {
          expect(p.elevationDeg, where).toBeGreaterThanOrEqual(25);
          expect(p.elevationDeg, where).toBeLessThanOrEqual(40);
        } else {
          expect(p.heightM, where).toBeGreaterThanOrEqual(1.2);
          expect(p.heightM, where).toBeLessThanOrEqual(1.7);
        }
      }
    }
  });

  it("exterior packs cover front-left and front-right corners and an aerial or street view", () => {
    for (const pack of packs.filter((p) => p.projectType !== "interior")) {
      const ids = pack.cameraPresets.map((p) => p.id);
      expect(ids).toContain("front_left_corner");
      expect(ids).toContain("front_right_corner");
      expect(ids.some((id) => id === "aerial_three_quarter" || id === "street_level")).toBe(true);
    }
  });

  it("interior packs cover the entrance wide, opposite corner and a detail", () => {
    for (const pack of registry.listSubtypes("interior")) {
      const ids = pack.cameraPresets.map((p) => p.id);
      expect(ids).toEqual(
        expect.arrayContaining(["entrance_wide", "opposite_corner", "material_detail"]),
      );
    }
  });

  it("resolves presets like other pack content", () => {
    expect(registry.cameraPresets("villa", "tropical").map((p) => p.id)).toContain("rear_pool");
    expect(registry.cameraPresets("villa", "underwater")).toEqual(
      registry.resolve("villa").pack!.cameraPresets,
    );
    expect(registry.cameraPresets("hotel")).toEqual(registry.resolve("custom").pack!.cameraPresets);
    expect(new KnowledgeRegistry([]).cameraPresets("villa")).toEqual([]);
  });

  it("a subtype pack without presets inherits its type default's presets", () => {
    const base = registry.resolve("villa").pack!;
    const bare = { ...structuredClone(base), subtype: "bare", cameraPresets: [] };
    const r = new KnowledgeRegistry([
      { source: "villa/default", data: base },
      { source: "villa/bare", data: bare },
    ]);
    expect(r.resolve("villa", "bare").pack?.subtype).toBe("bare");
    expect(r.cameraPresets("villa", "bare")).toEqual(base.cameraPresets);
  });

  it("pack schema defaults cameraPresets and anchorRecommended", () => {
    const r = new KnowledgeRegistry([
      {
        source: "x",
        data: {
          packVersion: "1",
          projectType: "office",
          subtype: "default",
          label: "Office",
          cameraPresets: [{ id: "a", label: "A", viewType: "aerial" }],
        },
      },
    ]);
    expect(r.resolve("office").pack?.cameraPresets[0]?.anchorRecommended).toBe(false);
  });
});
