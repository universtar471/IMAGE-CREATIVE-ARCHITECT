import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAR_PRESETS,
  COMPILER_VERSION,
  ProjectDNASchema,
  PromptBundleSchema,
  SCENE_OBJECTS_HEADING,
  SCENE_OBJECT_PRESETS,
  SCENE_OBJECT_TABLE,
  SITE_FRONTAGE_TARGET,
  SPACE_CATALOG,
  SceneObjectRequestSchema,
  ShotIntentSchema,
  SIMULATED_MODEL_LABEL_VI,
  VALIDATOR_VERSION,
  allowedObjectsForKind,
  compilePrompt,
  parkingCapacity,
  sceneObjectPreset,
  sceneSpaceKind,
  validateObjectPlacement,
  validateShot,
  type ProjectDNA,
  type ProjectType,
  type SceneObjectRequest,
  type SceneObjectRequestInput,
  type SceneSpaceKind,
  type SiteExtension,
  type SpaceInstance,
} from "../src";

const baseDna = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

const verified = { status: "verified" as const, sourceAssetIds: ["AST_photo"] };
const inferred = { status: "inferred" as const, sourceAssetIds: [] };

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

const withSpaces = (archetype: string, spaces: SpaceInstance[], dna = baseDna()): ProjectDNA => ({
  ...dna,
  spaceCatalog: { version: 1, buildingArchetype: archetype, spaces, activeSpaceId: spaces[0]?.id },
});

const site = (front: SiteExtension["front"]): SiteExtension => ({
  version: 1,
  coordinateConvention: "viewer_facing_front_facade",
  front,
  left: { kind: "attached_building", evidence: verified },
  right: { kind: "attached_building", evidence: verified },
  rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
});

const request = (input: Partial<SceneObjectRequestInput>): SceneObjectRequest =>
  SceneObjectRequestSchema.parse({
    presetId: "person.adult",
    quantity: 1,
    targetSpaceId: "SPC_a",
    state: "static",
    ...input,
  });

const check = (dna: ProjectDNA, projectType: ProjectType, sceneObjects: SceneObjectRequest[]) =>
  validateShot({ dna, shotIntent: { projectType, sceneObjects } });

const compile = (dna: ProjectDNA, projectType: ProjectType, sceneObjects?: SceneObjectRequest[]) =>
  compilePrompt({
    project: { id: "PRJ_OBJ", name: "Objects", projectType },
    dna,
    references: [],
    ...(sceneObjects ? { shotIntent: { projectType, sceneObjects } } : {}),
  });

const codes = (result: ReturnType<typeof check>) =>
  result.issues.map((i) => `${i.code}:${i.severity}`);

const bedroom = () => withSpaces("villa", [space("SPC_a", "villa.sleeping.master_suite")]);
const garage = (facts: SpaceInstance["facts"] = {}) =>
  withSpaces("villa", [space("SPC_a", "villa.service.gara", { facts })]);
const measured = (w: number, d: number) => ({
  widthM: { value: w, evidence: verified },
  depthM: { value: d, evidence: verified },
});

// ---------------------------------------------------------------- catalog

describe("scene object catalog and car library", () => {
  it("covers the six SRS object types", () => {
    expect([...new Set(SCENE_OBJECT_PRESETS.map((p) => p.type))].sort()).toEqual(
      ["bicycle", "car", "motorbike", "person", "pet", "plant"].sort(),
    );
  });

  it("has the exact named car presets, with coupe and roadster kept apart", () => {
    const ids = CAR_PRESETS.map((p) => p.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "car.mercedes_300sl.gullwing",
        "car.mercedes_300sl.roadster",
        "car.shelby_cobra.1964_289",
        "car.jaguar_e_type.series1_coupe",
        "car.jaguar_e_type.series1_roadster",
        "car.generic.modern_luxury_sedan",
        "car.generic.suv",
        "car.generic.ev",
        "car.generic.vn_city_car",
      ]),
    );
    expect(new Set(SCENE_OBJECT_PRESETS.map((p) => p.id)).size).toBe(SCENE_OBJECT_PRESETS.length);
    const gullwing = sceneObjectPreset("car.mercedes_300sl.gullwing")!;
    expect(gullwing.promptEn).toMatch(/300 SL Gullwing coupe/);
    expect(gullwing.promptEn).toMatch(/not the roadster/);
    const cobra = sceneObjectPreset("car.shelby_cobra.1964_289")!;
    expect(cobra.promptEn).toMatch(/1964 Shelby\/AC Cobra 289/);
    expect(cobra.promptEn).toMatch(/not the later, wider Cobra 427 body/);
    expect(sceneObjectPreset("car.jaguar_e_type.series1_roadster")!.promptEn).toMatch(
      /not the coupe/,
    );
  });

  it("labels every car as simulated and warns on branded models", () => {
    expect(SIMULATED_MODEL_LABEL_VI).toBe("mô phỏng theo mẫu xe");
    for (const car of CAR_PRESETS) {
      expect(car.simulatedModel).toBe(true);
      expect(car.labelVi.length).toBeGreaterThan(0);
      expect(car.promptEn.length).toBeGreaterThan(0);
    }
    const branded = CAR_PRESETS.filter((p) => !p.id.startsWith("car.generic."));
    expect(branded.length).toBe(5);
    expect(branded.every((p) => p.trademarkWarning)).toBe(true);
    expect(
      CAR_PRESETS.filter((p) => p.id.startsWith("car.generic.")).some((p) => p.trademarkWarning),
    ).toBe(false);
  });

  it("offers motorbike and bicycle presets", () => {
    expect(SCENE_OBJECT_PRESETS.some((p) => p.type === "motorbike")).toBe(true);
    expect(SCENE_OBJECT_PRESETS.some((p) => p.type === "bicycle")).toBe(true);
  });
});

// ---------------------------------------------------------------- allowed table

describe("allowed table per space (SRS §7.1)", () => {
  const kind = (id: string): SceneSpaceKind => sceneSpaceKind(SPACE_CATALOG.preset(id) ?? null);
  const allowed = (k: SceneSpaceKind) =>
    allowedObjectsForKind(k)
      .filter((r) => r.allowed)
      .map((r) => r.type);

  it("derives the space kind from the catalog zone, category and id", () => {
    expect(kind("villa.sleeping.master_suite")).toBe("bedroom");
    expect(kind("townhouse.living.phong_khach_rieng")).toBe("living");
    expect(kind("hotel.living.sanh_don")).toBe("lobby");
    expect(kind("villa.service.gara")).toBe("garage");
    expect(kind("townhouse.special.gara_tang_tret")).toBe("garage");
    expect(kind("resort.outdoor.ho_boi_chung")).toBe("pool");
    expect(kind("villa.outdoor.san_vuon_rong")).toBe("villa_yard");
    expect(kind("townhouse.outdoor.san_truoc_nho")).toBe("frontage");
    expect(sceneSpaceKind(null)).toBe("custom");
  });

  it("only uses catalog preset ids that exist", () => {
    for (const id of [
      "villa.service.gara",
      "townhouse.special.gara_tang_tret",
      "villa.outdoor.ho_boi",
      "resort.outdoor.ho_boi_chung",
      "resort.outdoor.ho_boi_rieng",
      "hotel.living.sanh_don",
      "townhouse.outdoor.san_truoc_nho",
    ])
      expect(SPACE_CATALOG.preset(id), id).toBeTruthy();
  });

  it("matches the SRS table", () => {
    expect(allowed("bedroom")).toEqual(["person", "plant", "pet"]);
    expect(allowed("living")).toEqual(["person", "plant", "pet"]);
    expect(allowed("garage")).toEqual(["person", "car", "motorbike"]);
    expect(allowed("pool")).toEqual(["person"]);
    expect(allowed("lobby")).toEqual(["person", "plant"]);
    expect(allowed("frontage")).toEqual(["person", "car", "motorbike", "bicycle"]);
    expect(SCENE_OBJECT_TABLE.frontage.car).toEqual(["existing_road"]);
    expect(SCENE_OBJECT_TABLE.villa_yard.car).toEqual(["driveway", "hardscape"]);
  });
});

// ---------------------------------------------------------------- validator

describe("ObjectPlacementValidator in validateShot", () => {
  it("adds nothing without objects", () => {
    expect(validateShot({ dna: bedroom(), shotIntent: { projectType: "villa" } }).issues).toEqual(
      [],
    );
    expect(check(bedroom(), "villa", [])).toEqual({
      verdict: "ALLOW",
      issues: [],
      validatorVersion: VALIDATOR_VERSION,
    });
  });

  it("AC-06: blocks a classic car in a bedroom", () => {
    const result = check(bedroom(), "villa", [
      request({ presetId: "car.mercedes_300sl.gullwing" }),
    ]);
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues).toMatchObject([
      {
        code: "OBJECT_NOT_ALLOWED_IN_SPACE",
        severity: "BLOCK",
        exceptionAllowed: false,
        path: "sceneObjects[0]",
        params: { reason: "type_not_allowed", kind: "bedroom" },
      },
    ]);
    // An exception never clears a BLOCK.
    expect(
      validateShot({
        dna: bedroom(),
        shotIntent: {
          projectType: "villa",
          sceneObjects: [request({ presetId: "car.shelby_cobra.1964_289" })],
        },
        approvedExceptions: ["OBJECT_NOT_ALLOWED_IN_SPACE"],
      }).verdict,
    ).toBe("BLOCK");
  });

  it("allows people, pets and plants in a bedroom", () => {
    expect(
      check(bedroom(), "villa", [
        request({ presetId: "person.adult", quantity: 2 }),
        request({ presetId: "pet.cat" }),
        request({ presetId: "plant.potted" }),
      ]).verdict,
    ).toBe("ALLOW");
  });

  it("AC-07: allows a 300 SL in a verified garage", () => {
    const result = check(garage(measured(6, 6)), "villa", [
      request({ presetId: "car.mercedes_300sl.gullwing" }),
    ]);
    expect(result).toEqual({ verdict: "ALLOW", issues: [], validatorVersion: VALIDATOR_VERSION });
    // A confirmed garage-bay fact verifies it too.
    expect(
      check(garage({ garage_bay: { value: true, evidence: verified } }), "villa", [
        request({ presetId: "car.mercedes_300sl.gullwing" }),
      ]).verdict,
    ).toBe("ALLOW");
  });

  it("warns for an unmeasured garage (plausible but unverified)", () => {
    const result = check(garage(), "villa", [request({ presetId: "car.mercedes_300sl.gullwing" })]);
    expect(codes(result)).toEqual(["OBJECT_NO_PLACEMENT_ZONE:WARN"]);
    expect(result.issues[0]!.params.reason).toBe("zone_unverified");
    expect(
      validateShot({
        dna: garage(),
        shotIntent: {
          projectType: "villa",
          sceneObjects: [request({ presetId: "car.mercedes_300sl.gullwing" })],
        },
        approvedExceptions: ["OBJECT_NO_PLACEMENT_ZONE"],
      }).verdict,
    ).toBe("ALLOW");
  });

  it("blocks when a measured garage is too small for the cars", () => {
    expect(parkingCapacity("car", 6, 6)).toBe(2);
    const result = check(garage(measured(3, 5.5)), "villa", [
      request({ presetId: "car.generic.suv", quantity: 2 }),
    ]);
    expect(result.issues).toMatchObject([
      { code: "OBJECT_NO_PLACEMENT_ZONE", severity: "BLOCK", params: { reason: "too_small" } },
    ]);
    // Two separate requests share the same bay.
    expect(
      codes(
        check(garage(measured(3, 5.5)), "villa", [
          request({ presetId: "car.generic.suv" }),
          request({ presetId: "car.generic.ev" }),
        ]),
      ),
    ).toEqual(["OBJECT_NO_PLACEMENT_ZONE:BLOCK"]);
  });

  it("blocks a car in a villa yard without a recorded driveway, and never creates one", () => {
    const yard = (facts: SpaceInstance["facts"] = {}) =>
      withSpaces("villa", [space("SPC_a", "villa.outdoor.san_vuon_rong", { facts })]);
    const car = request({ presetId: "car.jaguar_e_type.series1_coupe" });
    expect(check(yard(), "villa", [car]).issues).toMatchObject([
      { code: "OBJECT_NO_PLACEMENT_ZONE", severity: "BLOCK", params: { reason: "zone_absent" } },
    ]);
    expect(compile(yard(), "villa", [car]).positivePrompt).not.toContain(SCENE_OBJECTS_HEADING);
    expect(
      codes(check(yard({ driveway: { value: true, evidence: inferred } }), "villa", [car])),
    ).toEqual(["OBJECT_NO_PLACEMENT_ZONE:WARN"]);
    expect(
      check(yard({ driveway: { value: true, evidence: verified } }), "villa", [car]).verdict,
    ).toBe("ALLOW");
    // A car on the lawn is not a parking zone.
    expect(
      check(yard({ driveway: { value: true, evidence: verified } }), "villa", [
        request({ presetId: "car.generic.suv", placementZoneId: "garden" }),
      ]).issues,
    ).toMatchObject([
      { code: "OBJECT_NO_PLACEMENT_ZONE", params: { reason: "zone_not_in_space" } },
    ]);
    // Villa yards take parked cars only.
    expect(
      check(yard({ driveway: { value: true, evidence: verified } }), "villa", [
        request({ presetId: "car.generic.suv", state: "moving" }),
      ]).issues,
    ).toMatchObject([
      {
        code: "OBJECT_NO_PLACEMENT_ZONE",
        severity: "BLOCK",
        params: { reason: "moving_outside_road" },
      },
    ]);
  });

  it("puts townhouse frontage vehicles only on the existing street", () => {
    const front = (status: "verified" | "inferred") => ({
      ...baseDna(),
      site: site({ kind: "street", evidence: status === "verified" ? verified : inferred }),
    });
    const car = request({
      presetId: "car.generic.vn_city_car",
      targetSpaceId: SITE_FRONTAGE_TARGET,
      state: "moving",
    });
    expect(check(front("verified"), "townhouse", [car]).verdict).toBe("ALLOW");
    expect(codes(check(front("inferred"), "townhouse", [car]))).toEqual([
      "OBJECT_NO_PLACEMENT_ZONE:WARN",
    ]);
    const walled = { ...baseDna(), site: site({ kind: "boundary_wall", evidence: verified }) };
    expect(codes(check(walled, "townhouse", [car]))).toEqual(["OBJECT_NO_PLACEMENT_ZONE:BLOCK"]);
    // The frontage is not a target of an interior shot.
    expect(check(front("verified"), "interior", [car]).issues).toMatchObject([
      { code: "OBJECT_NOT_ALLOWED_IN_SPACE", params: { reason: "unknown_target" } },
    ]);
  });

  it("allows people only at a resort pool", () => {
    const pool = withSpaces("resort", [space("SPC_a", "resort.outdoor.ho_boi_chung")]);
    expect(check(pool, "resort", [request({ presetId: "person.adult" })]).verdict).toBe("ALLOW");
    expect(codes(check(pool, "resort", [request({ presetId: "motorbike.scooter" })]))).toEqual([
      "OBJECT_NOT_ALLOWED_IN_SPACE:BLOCK",
    ]);
    expect(codes(check(pool, "resort", [request({ presetId: "pet.dog" })]))).toEqual([
      "OBJECT_NOT_ALLOWED_IN_SPACE:BLOCK",
    ]);
  });

  it("allows people and plants in a hotel lobby, not cars", () => {
    const lobby = withSpaces("hotel", [space("SPC_a", "hotel.living.sanh_don")]);
    expect(
      check(lobby, "hotel", [request({}), request({ presetId: "plant.large_potted" })]).verdict,
    ).toBe("ALLOW");
    expect(check(lobby, "hotel", [request({ presetId: "car.generic.ev" })]).verdict).toBe("BLOCK");
  });

  it("blocks unknown presets and targets", () => {
    expect(
      check(bedroom(), "villa", [request({ presetId: "car.batmobile" })]).issues,
    ).toMatchObject([{ code: "OBJECT_NOT_ALLOWED_IN_SPACE", path: "sceneObjects[0].presetId" }]);
    expect(
      check(bedroom(), "villa", [request({ targetSpaceId: "SPC_none" })]).issues,
    ).toMatchObject([
      { code: "OBJECT_NOT_ALLOWED_IN_SPACE", path: "sceneObjects[0].targetSpaceId" },
    ]);
  });

  it("is a pure function of the DNA (never edits it)", () => {
    const dna = garage();
    const before = JSON.stringify(dna);
    validateObjectPlacement(dna, {
      projectType: "villa",
      sceneObjects: [request({ presetId: "car.generic.suv" })],
    });
    compile(dna, "villa", [request({ presetId: "car.generic.suv" })]);
    expect(JSON.stringify(dna)).toBe(before);
  });
});

// ---------------------------------------------------------------- compiler

describe("SCENE OBJECTS compiler section", () => {
  it("leaves the prompt unchanged without objects", () => {
    const dna = garage(measured(6, 6));
    const plain = compile(dna, "villa");
    for (const bundle of [
      compile(dna, "villa", []),
      compilePrompt({
        project: { id: "PRJ_OBJ", name: "Objects", projectType: "villa" },
        dna,
        references: [],
        shotIntent: { projectType: "villa", sceneObjects: [] },
      }),
    ]) {
      expect(bundle).toEqual(plain);
      expect(bundle.shotIntent).toBeUndefined();
    }
    expect(plain.positivePrompt).not.toContain(SCENE_OBJECTS_HEADING);
    expect(plain.compilerVersion).toBe(COMPILER_VERSION);
    expect(COMPILER_VERSION).toBe("pc-1.11.0");
  });

  it("AC-07: compiles a verified garage line with the exact model", () => {
    const bundle = compile(garage(measured(6, 6)), "villa", [
      request({
        presetId: "car.mercedes_300sl.gullwing",
        appearanceOverrides: { color: "silver" },
      }),
    ]);
    const section = bundle.positivePrompt
      .split("\n\n")
      .find((s) => s.startsWith(SCENE_OBJECTS_HEADING))!;
    expect(section.split("\n")).toEqual([
      "SCENE OBJECTS:",
      "Add ONE parked 1950s Mercedes-Benz 300 SL Gullwing coupe (low body, upward-opening gullwing doors, fixed roof; not the roadster) in silver paint on the verified parking bay of the garage.",
      "Keep parked vehicles static, with no motion blur or light trails.",
      "Keep every vehicle physically grounded, to scale and clear of doors and access routes; no new garage, driveway, parking pad or widened road, and no altered building.",
      "Preserve the original space, architecture and camera; added objects stay to scale and never hide locked or key architectural elements.",
    ]);
    expect(bundle.metadata.sections).toContain("sceneObjects");
    expect(bundle.resolvedWarnings).toEqual([]);
    expect(PromptBundleSchema.parse(bundle).shotIntent?.sceneObjects).toHaveLength(1);
  });

  it("uses the 'adequate clearance' wording for an unverified zone", () => {
    const bundle = compile(garage(), "villa", [
      request({ presetId: "car.shelby_cobra.1964_289", quantity: 2 }),
    ]);
    expect(bundle.positivePrompt).toContain(
      "Add TWO parked 1964 Shelby/AC Cobra 289 roadsters (slim early 289 body with narrow fenders; not the later, wider Cobra 427 body) on the parking bay of the garage, only if the parking bay is present in the approved references and has adequate clearance.",
    );
    // Found, not accepted: the compiler leaves resolvedWarnings to the desktop gate.
    expect(bundle.resolvedWarnings).toEqual([]);
  });

  it("never compiles a refused object", () => {
    const bundle = compile(bedroom(), "villa", [
      request({ presetId: "car.mercedes_300sl.gullwing" }),
    ]);
    expect(bundle.positivePrompt).not.toContain("Mercedes");
    expect(bundle.positivePrompt).not.toContain(SCENE_OBJECTS_HEADING);
  });

  it("compiles people and pets with a pose and no vehicle lines", () => {
    const bundle = compile(bedroom(), "villa", [
      request({ presetId: "person.adult", quantity: 2, state: "moving" }),
      request({ presetId: "pet.cat", visibility: "foreground" }),
    ]);
    const lines = bundle.positivePrompt
      .split("\n\n")
      .find((s) => s.startsWith(SCENE_OBJECTS_HEADING))!
      .split("\n");
    expect(lines).toEqual([
      "SCENE OBJECTS:",
      "Add TWO adults in everyday clothing in the master suite, walking naturally.",
      "Add ONE domestic cat in the master suite, resting, in the foreground.",
      "Preserve the original space, architecture and camera; added objects stay to scale and never hide locked or key architectural elements.",
    ]);
  });

  it("is deterministic and records the shot intent in the snapshot and hash", () => {
    const dna = garage(measured(6, 6));
    const objects = [request({ presetId: "car.generic.suv" })];
    const a = compile(dna, "villa", objects);
    expect(compile(dna, "villa", objects)).toEqual(a);
    expect(a.shotIntent).toEqual({ projectType: "villa", cameraId: null, sceneObjects: objects });
    expect(a.sourceHash).not.toBe(compile(dna, "villa").sourceHash);
    expect(ShotIntentSchema.parse(a.shotIntent)).toEqual(a.shotIntent);
  });
});
