import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  compilePrompt,
  createInitialDNA,
  type PromptCompileInput,
  type ProjectType,
} from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();

function input(
  projectType: ProjectType,
  overrides: Partial<PromptCompileInput> = {},
): PromptCompileInput {
  const pack = registry.resolve(projectType).pack;
  return {
    project: { id: "PRJ_TEST", name: "Test", projectType, subtype: null },
    dna: createInitialDNA({
      projectType,
      pack,
      starter: { contextPresetId: pack?.contextPresets[0]?.id },
    }),
    references: [],
    pack,
    ...overrides,
  };
}

describe("prompt compiler", () => {
  it("is deterministic for identical input", () => {
    const i = input("villa", {
      references: [
        { assetId: "AST_B", role: "mood_reference", label: "mood.jpg" },
        { assetId: "AST_A", role: "master_architecture", label: "hero.png" },
      ],
    });
    const a = compilePrompt(i);
    const b = compilePrompt(structuredClone(i));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.compilerVersion).toBe(COMPILER_VERSION);
  });

  it("is independent of reference input order", () => {
    const refs = [
      { assetId: "AST_2", role: "material_reference" as const },
      { assetId: "AST_1", role: "master_architecture" as const },
      { assetId: "AST_3", role: "material_reference" as const },
    ];
    const a = compilePrompt(input("villa", { references: refs }));
    const b = compilePrompt(input("villa", { references: [...refs].reverse() }));
    expect(a).toEqual(b);
  });

  it("produces clean text when optional fields are missing", () => {
    const bundle = compilePrompt({
      project: { id: "PRJ_X", name: "Bare", projectType: "custom" },
      dna: createInitialDNA({ projectType: "custom", pack: null }),
      references: [],
    });
    const all = [
      bundle.positivePrompt,
      bundle.negativePrompt,
      bundle.referenceInstructions,
      bundle.preservationInstructions,
    ].join("\n");
    expect(all).not.toMatch(/undefined|null|NaN|\[object Object\]/);
    expect(bundle.positivePrompt).not.toMatch(/: ;|;;|,,|\.\./);
    expect(bundle.positivePrompt.length).toBeGreaterThan(0);
  });

  it("townhouse context differs from villa context", () => {
    const townhouse = compilePrompt(input("townhouse"));
    const villa = compilePrompt(input("villa"));
    expect(townhouse.positivePrompt).toMatch(/urban street/);
    expect(townhouse.positivePrompt).toMatch(/attached neighbouring townhouse/);
    expect(villa.positivePrompt).toMatch(/villa compound/);
    expect(villa.positivePrompt).not.toMatch(/attached neighbouring townhouse/);
    expect(townhouse.negativePrompt).not.toBe(villa.negativePrompt);
  });

  it("master and reference roles produce distinct instructions", () => {
    const bundle = compilePrompt(
      input("villa", {
        references: [
          { assetId: "AST_1", role: "master_architecture" },
          { assetId: "AST_2", role: "material_reference" },
          { assetId: "AST_3", role: "mood_reference" },
        ],
      }),
    );
    const lines = bundle.referenceInstructions.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^Image 1 is the MASTER architecture image/);
    expect(lines[1]).toMatch(/material reference/);
    expect(lines[2]).toMatch(/mood reference/);
    expect(new Set(lines.map((l) => l.replace(/^Image \d+ /, ""))).size).toBe(3);
    expect(bundle.preservationInstructions).toMatch(/Preserve the architecture of Image 1/);
  });

  it("without a master, preservation says so", () => {
    const bundle = compilePrompt(
      input("villa", { references: [{ assetId: "AST_9", role: "mood_reference" }] }),
    );
    expect(bundle.preservationInstructions).toMatch(/No master architecture image/);
  });

  it("includes DNA values and locks", () => {
    const i = input("villa");
    i.dna.building.floors = 2;
    i.dna.building.colorPalette = ["white", "beige"];
    i.dna.building.materials = [{ zone: "walls", description: "travertine" }];
    i.dna.locks.building = true;
    const bundle = compilePrompt(i);
    expect(bundle.positivePrompt).toMatch(/2 floors/);
    expect(bundle.positivePrompt).toMatch(/color palette: white, beige/);
    expect(bundle.positivePrompt).toMatch(/walls: travertine/);
    expect(bundle.preservationInstructions).toMatch(/Keep exactly 2 floors/);
    expect(bundle.preservationInstructions).toMatch(/LOCKED/);
  });

  it("de-duplicates negative constraints case-insensitively", () => {
    const i = input("villa");
    i.dna.context.negativeConstraints = ["Low Resolution", "snow"];
    const negatives = compilePrompt(i).negativePrompt.split(", ");
    expect(negatives.filter((n) => n.toLowerCase() === "low resolution")).toHaveLength(1);
  });

  it("records metadata", () => {
    const bundle = compilePrompt(input("interior"));
    expect(bundle.metadata).toMatchObject({
      projectType: "interior",
      knowledgePack: "interior/default@1.1.0",
      referenceCount: 0,
    });
  });
});
