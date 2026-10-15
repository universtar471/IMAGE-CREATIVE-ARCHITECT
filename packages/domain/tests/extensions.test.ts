import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EvidenceRefSchema,
  ProjectDNASchema,
  SiteExtensionSchema,
  SpaceCatalogExtensionSchema,
  isConfirmed,
  validateProjectDNA,
} from "../src";

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

/** Persisted v1 DNA written before ADR-034 (no extensions). Shared with the Rust tests. */
const legacy = () => readJson("../../../apps/desktop/tests/fixtures/nhapho-dna.json");
/** The same DNA with every ADR-034 extension filled in. Shared with the Rust tests. */
const extended = () => readJson("../test-vectors/dna-v1-extensions.json");

/** parse → save (JSON text) → reopen (parse again). */
const roundTrip = (raw: unknown) => {
  const opened = ProjectDNASchema.parse(raw);
  const saved = JSON.stringify(opened);
  return { opened, reopened: ProjectDNASchema.parse(JSON.parse(saved)) };
};

describe("evidence", () => {
  it.each([
    ["verified", true],
    ["user_declared", true],
    ["inferred", false],
    ["unknown", false],
  ] as const)("isConfirmed(%s) = %s", (status, expected) => {
    expect(isConfirmed({ status })).toBe(expected);
  });

  it("treats missing evidence as unconfirmed", () => {
    expect(isConfirmed(undefined)).toBe(false);
    expect(isConfirmed(null)).toBe(false);
  });

  it("defaults sourceAssetIds and bounds confidence", () => {
    expect(EvidenceRefSchema.parse({ status: "inferred" })).toEqual({
      status: "inferred",
      sourceAssetIds: [],
    });
    expect(EvidenceRefSchema.safeParse({ status: "inferred", confidence: 1.2 }).success).toBe(
      false,
    );
    expect(EvidenceRefSchema.safeParse({ status: "guessed" }).success).toBe(false);
  });
});

describe("AC-20: old v1 DNA without extensions", () => {
  it("loads, saves and reopens with nothing lost and no extension keys invented", () => {
    const raw = legacy();
    const { opened, reopened } = roundTrip(raw);
    expect(opened).toEqual(raw);
    expect(reopened).toEqual(raw);
    expect(JSON.stringify(reopened)).toBe(JSON.stringify(opened));
    for (const key of ["spaceCatalog", "site", "architecturalDetails"])
      expect(key in reopened).toBe(false);
    expect(reopened.schemaVersion).toBe(1);
    // Cameras, locks and facts all survive.
    expect(reopened.cameras.map((c) => c.id)).toEqual(
      (raw as { cameras: Array<{ id: string }> }).cameras.map((c) => c.id),
    );
  });
});

describe("ADR-034 extensions", () => {
  it("round-trip unchanged", () => {
    const raw = extended();
    const { opened, reopened } = roundTrip(raw);
    expect(opened).toEqual(raw);
    expect(reopened).toEqual(raw);
    expect(reopened.site?.left.kind).toBe("attached_building");
    expect(reopened.spaceCatalog?.spaces[0]?.facts.widthM?.value).toBe(4.6);
    expect(reopened.architecturalDetails?.[0]?.locked).toBe(true);
  });

  it("keep schemaVersion 1 and reject an unknown extension version", () => {
    const raw = extended() as Record<string, Record<string, unknown>>;
    expect(validateProjectDNA(raw).ok).toBe(true);
    raw.site!.version = 2;
    expect(ProjectDNASchema.safeParse(raw).success).toBe(false);
  });

  it("validate the site sides and the coordinate convention", () => {
    const site = (extended() as { site: Record<string, unknown> }).site;
    expect(SiteExtensionSchema.safeParse(site).success).toBe(true);
    expect(
      SiteExtensionSchema.safeParse({ ...site, coordinateConvention: "north_up" }).success,
    ).toBe(false);
    expect(
      SiteExtensionSchema.safeParse({
        ...site,
        left: { kind: "cliff", evidence: { status: "unknown" } },
      }).success,
    ).toBe(false);
    const { rear: _rear, ...missingRear } = site;
    expect(SiteExtensionSchema.safeParse(missingRear).success).toBe(false);
  });

  it("require activeSpaceId to name a space and space ids to be unique", () => {
    const base = { version: 1, buildingArchetype: "townhouse" } as const;
    const space = { id: "S1", presetId: "p" };
    expect(
      SpaceCatalogExtensionSchema.safeParse({ ...base, spaces: [space], activeSpaceId: "S1" })
        .success,
    ).toBe(true);
    expect(
      SpaceCatalogExtensionSchema.safeParse({ ...base, spaces: [space], activeSpaceId: "S2" })
        .success,
    ).toBe(false);
    expect(SpaceCatalogExtensionSchema.safeParse({ ...base, spaces: [space, space] }).success).toBe(
      false,
    );
  });

  it("require a value on every space fact", () => {
    const parsed = SpaceCatalogExtensionSchema.safeParse({
      version: 1,
      buildingArchetype: "townhouse",
      spaces: [
        { id: "S1", presetId: "p", facts: { widthM: { evidence: { status: "verified" } } } },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
