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
