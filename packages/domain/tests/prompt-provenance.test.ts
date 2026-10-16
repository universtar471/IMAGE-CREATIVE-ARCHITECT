import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  NO_CATALOG_VERSION,
  PromptBundleSchema,
  ProjectDNASchema,
  VALIDATOR_VERSION,
  canonicalHash,
  canonicalJson,
  compilePrompt,
  compileWithOverrides,
  sha256Hex,
  validateShot,
  withResolvedWarnings,
  type CameraDNA,
  type ProjectDNA,
  type PromptCompileInput,
} from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();
const nhapho = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );
const FRONT_LEFT = "CAM_01M4K1Q5C6PGJBEGD65E0JFSY0";

const input = (patch: Partial<PromptCompileInput> = {}): PromptCompileInput => ({
  project: { id: "PRJ_1", name: "Nhà phố", projectType: "townhouse", subtype: null },
  dna: nhapho(),
  references: [
    { assetId: "AST_B", role: "mood_reference", label: "mood.jpg" },
    { assetId: "AST_A", role: "master_architecture", label: "hero.png" },
  ],
  pack: registry.resolve("townhouse").pack,
  cameraId: FRONT_LEFT,
  ...patch,
});

/** Same value with every object's keys inserted in reverse order. */
function reverseKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reverseKeys) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([k, v]) => [k, reverseKeys(v)]),
    ) as T;
  return value;
}

describe("sha256Hex", () => {
  it.each([
    "",
    "abc",
    "abcdbcdecdefdefgefghfghighijhijkijkljklmjklmnklmnolmnopmnopqnopq",
    "Nhà phố liền kề — 🏠",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "x".repeat(1000),
  ])("matches node:crypto for %#", (text) => {
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
  });

  it("has the FIPS 180-4 'abc' digest", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level and drops undefined members", () => {
    expect(
      canonicalJson({ b: 1, a: [1, undefined, { d: -0, c: "x" }], u: undefined, n: NaN }),
    ).toBe('{"a":[1,null,{"c":"x","d":0}],"b":1,"n":null}');
  });

  it("is independent of key insertion order", () => {
    const dna = nhapho();
    expect(canonicalJson(reverseKeys(dna))).toBe(canonicalJson(dna));
    expect(canonicalHash({ a: 1 })).toBe(`sha256:${sha256Hex('{"a":1}')}`);
  });
});

describe("PromptBundle provenance (ADR-034)", () => {
  it("records versions, hashes and resolved warnings; compiler is pc-1.9.0", () => {
    const bundle = compilePrompt(input());
    expect(COMPILER_VERSION).toBe("pc-1.9.0");
    expect(bundle).toMatchObject({
      compilerVersion: "pc-1.9.0",
      validatorVersion: VALIDATOR_VERSION,
      catalogVersion: NO_CATALOG_VERSION,
      resolvedWarnings: [],
    });
    expect(NO_CATALOG_VERSION).toBe("none");
    expect(bundle.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(bundle.configHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(PromptBundleSchema.parse(bundle)).toEqual(bundle);
  });

  it("AC-21: identical input compiles to a byte-identical bundle", () => {
    const a = compilePrompt(input());
    const b = compilePrompt(reverseKeys(structuredClone(input())));
    const c = compilePrompt({
      ...input(),
      references: [...input().references].reverse(),
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });

  it("does not change the prompt text, only adds metadata", () => {
    const bundle = compilePrompt(input());
    const { validatorVersion, catalogVersion, sourceHash, configHash, resolvedWarnings, ...rest } =
      bundle;
    expect([
      validatorVersion,
      catalogVersion,
      sourceHash,
      configHash,
      resolvedWarnings,
    ]).not.toContain(undefined);
    expect(Object.keys(rest).sort()).toEqual([
      "compilerVersion",
      "metadata",
      "negativePrompt",
      "positivePrompt",
      "preservationInstructions",
      "referenceInstructions",
    ]);
  });

  it("sourceHash follows the DNA and shot, not display labels", () => {
    const base = compilePrompt(input()).sourceHash;
    const renamed = compilePrompt({
      ...input(),
      project: { ...input().project, name: "Other name" },
      references: input().references.map((r) => ({ ...r, label: "renamed.png" })),
    }).sourceHash;
    expect(renamed).toBe(base);

    const dna = nhapho();
    dna.building.floors = 4;
    expect(compilePrompt(input({ dna })).sourceHash).not.toBe(base);
    expect(compilePrompt(input({ cameraId: null })).sourceHash).not.toBe(base);
    expect(
      compilePrompt(input({ references: [{ assetId: "AST_A", role: "master_architecture" }] }))
        .sourceHash,
    ).not.toBe(base);
    // Unknown camera ids are ignored by the compiler, so they hash like no camera.
    expect(compilePrompt(input({ cameraId: "CAM_unknown" })).sourceHash).toBe(
      compilePrompt(input({ cameraId: null })).sourceHash,
    );
  });

  it("sourceHash covers lighting overrides; configHash covers the knowledge pack only", () => {
    const plain = compilePrompt(input());
    const night = compileWithOverrides(input(), { lighting: { timeOfDay: "night" } });
    expect(night.sourceHash).not.toBe(plain.sourceHash);
    expect(night.configHash).toBe(plain.configHash);

    const dna = nhapho();
    dna.building.floors = 7;
    expect(compilePrompt(input({ dna })).configHash).toBe(plain.configHash);
    expect(compilePrompt(input({ pack: null })).configHash).not.toBe(plain.configHash);
    expect(compilePrompt(input({ pack: registry.resolve("villa").pack })).configHash).not.toBe(
      plain.configHash,
    );
  });

  it("never pre-fills resolvedWarnings with the WARN codes it finds (only accepted ones belong there)", () => {
    const side: CameraDNA = {
      schemaVersion: 1,
      id: "CAM_01M4K1QS1DEVEZ9ZMEPFT1E7X0",
      name: "Left side",
      viewType: "exterior_side",
      azimuthDeg: 90,
      isAnchorView: false,
      notes: "",
    };
    const inferred = nhapho(); // attached only from neighbour notes → WARN
    inferred.cameras.push(side);
    // The validator finds the WARN; the compiled bundle does not claim it was accepted.
    const found = validateShot({
      dna: inferred,
      shotIntent: { projectType: "townhouse", cameraId: side.id },
    });
    expect(found.issues.map((i) => `${i.severity}:${i.code}`)).toEqual([
      "WARN:ADJACENT_BUILDING_CONFLICT",
    ]);
    expect(compilePrompt(input({ dna: inferred, cameraId: side.id })).resolvedWarnings).toEqual([]);
    const declared = structuredClone(inferred);
    declared.context.siteTopology = { left: "attached", right: "attached", cornerLot: false };
    expect(compilePrompt(input({ dna: declared, cameraId: side.id })).resolvedWarnings).toEqual([]);
  });

  it("withResolvedWarnings merges sorted and unique", () => {
    const bundle = compilePrompt(input());
    const merged = withResolvedWarnings({ ...bundle, resolvedWarnings: ["UNVERIFIED_GEOMETRY"] }, [
      "OCCLUDED_TARGET",
      "UNVERIFIED_GEOMETRY",
    ]);
    expect(merged.resolvedWarnings).toEqual(["OCCLUDED_TARGET", "UNVERIFIED_GEOMETRY"]);
    expect(merged.positivePrompt).toBe(bundle.positivePrompt);
  });

  it("still parses bundles stored before ADR-034", () => {
    const legacy = {
      compilerVersion: "pc-1.3.0",
      positivePrompt: "p",
      negativePrompt: "",
      referenceInstructions: "",
      preservationInstructions: "",
      metadata: {},
    };
    expect(PromptBundleSchema.parse(legacy)).toEqual(legacy);
  });
});
