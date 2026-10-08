import { describe, expect, it } from "vitest";
import {
  AssetRoleSchema,
  BuildingDNASchema,
  ContextDNASchema,
  ProjectDNASchema,
  ProjectTypeSchema,
  validateProjectDNA,
} from "../src";

const minimal = {
  schemaVersion: 1,
  building: { schemaVersion: 1, buildingType: "villa" },
  context: { schemaVersion: 1 },
};

describe("enums", () => {
  it("rejects unknown project types and roles", () => {
    expect(ProjectTypeSchema.safeParse("castle").success).toBe(false);
    expect(ProjectTypeSchema.safeParse("custom").success).toBe(true);
    expect(AssetRoleSchema.safeParse("hero").success).toBe(false);
  });
});

describe("BuildingDNA", () => {
  it("fills defaults", () => {
    const b = BuildingDNASchema.parse({ schemaVersion: 1, buildingType: "villa" });
    expect(b.dimensions).toEqual({});
    expect(b.massing.voids).toEqual([]);
    expect(b.materials).toEqual([]);
    expect(b.notes).toBe("");
  });

  it.each([
    ["negative width", { dimensions: { widthM: -3 } }],
    ["zero floors", { floors: 0 }],
    ["fractional floors", { floors: 1.5 }],
    ["NaN height", { dimensions: { heightM: Number.NaN } }],
    ["empty building type", { buildingType: "  " }],
    ["material without zone", { materials: [{ zone: "", description: "oak" }] }],
  ])("rejects %s", (_label, patch) => {
    const r = BuildingDNASchema.safeParse({ schemaVersion: 1, buildingType: "villa", ...patch });
    expect(r.success).toBe(false);
  });

  it("rejects wrong schema version", () => {
    expect(BuildingDNASchema.safeParse({ schemaVersion: 2, buildingType: "x" }).success).toBe(
      false,
    );
  });
});

describe("ContextDNA", () => {
  it("defaults every direction to an empty zone", () => {
    const c = ContextDNASchema.parse({ schemaVersion: 1 });
    for (const dir of ["front", "rear", "left", "right"] as const) {
      expect(c[dir]).toEqual({ elements: [], vegetation: [], adjacentBuildings: [], notes: "" });
    }
  });

  it("constrains density", () => {
    expect(ContextDNASchema.safeParse({ schemaVersion: 1, density: "crowded" }).success).toBe(
      false,
    );
    expect(ContextDNASchema.safeParse({ schemaVersion: 1, density: "high" }).success).toBe(true);
  });
});

describe("ProjectDNA", () => {
  it("defaults locks and cameras", () => {
    const dna = ProjectDNASchema.parse(minimal);
    expect(dna.locks.building).toBe(false);
    expect(dna.locks.objectIds).toEqual([]);
    expect(dna.cameras).toEqual([]);
    expect(dna.lighting).toBeUndefined();
  });

  it("parsing is idempotent (persisted output re-validates unchanged)", () => {
    const once = ProjectDNASchema.parse(minimal);
    expect(ProjectDNASchema.parse(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("reports field errors by dotted path", () => {
    const r = validateProjectDNA({
      ...minimal,
      building: { ...minimal.building, floors: -1, dimensions: { widthM: -2 } },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.fieldErrors)).toEqual(
        expect.arrayContaining(["building.floors", "building.dimensions.widthM"]),
      );
    }
  });
});
