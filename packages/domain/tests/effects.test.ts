import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  EFFECTS_HEADING,
  EFFECT_CATALOG,
  EFFECT_FAMILIES,
  EFFECT_IDS,
  ProjectDNASchema,
  PromptBundleSchema,
  SITE_FRONTAGE_TARGET,
  SceneObjectRequestSchema,
  ShotIntentSchema,
  VALIDATOR_VERSION,
  compilePrompt,
  effectScene,
  effectsCompatibility,
  effectsCompatibleTogether,
  effectsLines,
  normalizeShotIntent,
  selectedEffects,
  validateShot,
  type EffectId,
  type ProjectDNA,
  type ProjectType,
  type SceneObjectRequest,
  type SceneObjectRequestInput,
  type ShotEffects,
  type ShotIntent,
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

const streetSite = (): SiteExtension => ({
  version: 1,
  coordinateConvention: "viewer_facing_front_facade",
  front: { kind: "street", evidence: verified },
  left: { kind: "attached_building", evidence: verified },
  right: { kind: "attached_building", evidence: verified },
  rear: { kind: "unknown", evidence: { status: "unknown", sourceAssetIds: [] } },
});

const at = (dna: ProjectDNA, timeOfDay: string, extra: object = {}): ProjectDNA => ({
  ...dna,
  lighting: { ...dna.lighting!, timeOfDay, presetId: undefined, ...extra },
});

const car = (state: "static" | "moving", input: Partial<SceneObjectRequestInput> = {}) =>
  SceneObjectRequestSchema.parse({
    presetId: "car.generic.suv",
    quantity: 1,
    targetSpaceId: SITE_FRONTAGE_TARGET,
    placementZoneId: "existing_road",
    state,
    ...input,
  });

const person = (state: "static" | "moving") =>
  SceneObjectRequestSchema.parse({
    presetId: "person.adult",
    quantity: 2,
    targetSpaceId: SITE_FRONTAGE_TARGET,
    placementZoneId: "sidewalk",
    state,
  });

const effects = (primary: EffectId, ...secondary: EffectId[]): ShotEffects => ({
  primary: { id: primary, intensity: "light" },
  secondary: secondary.map((id) => ({ id, intensity: "medium" as const })),
});

const shot = (
  projectType: ProjectType,
  fx?: ShotEffects,
  sceneObjects?: SceneObjectRequest[],
): ShotIntent => ({
  projectType,
  ...(fx ? { effects: fx } : {}),
  ...(sceneObjects ? { sceneObjects } : {}),
});

const status = (dna: ProjectDNA, intent: ShotIntent, id: EffectId) =>
  effectsCompatibility(dna, intent).find((e) => e.effectId === id)!;

const codes = (dna: ProjectDNA, intent: ShotIntent) =>
  validateShot({ dna, shotIntent: intent })
    .issues.filter((i) => i.code.startsWith("EFFECT_"))
    .map((i) => `${i.code}:${i.severity}:${i.path}:${i.params.reason}`);

const compile = (dna: ProjectDNA, intent?: ShotIntent) =>
  compilePrompt({
    project: { id: "PRJ_FX", name: "Effects", projectType: intent?.projectType ?? "townhouse" },
    dna,
    references: [],
    ...(intent ? { shotIntent: intent } : {}),
  });

const nightStreet = () => ({ ...at(baseDna(), "night"), site: streetSite() });
const closedBedroom = () => withSpaces("villa", [space("SPC_bed", "villa.sleeping.master_suite")]);

// ---------------------------------------------------------------- catalog

describe("effect catalog", () => {
  it("lists the eight SRS §6.2 effects in the six §6.1 families", () => {
    expect(EFFECT_CATALOG.map((e) => e.id)).toEqual([...EFFECT_IDS]);
    expect([...new Set(EFFECT_CATALOG.map((e) => e.family))].sort()).toEqual(
      [...EFFECT_FAMILIES].sort(),
    );
    expect(EFFECT_CATALOG.map((e) => e.labelVi)).toEqual([
      "Vệt sáng xe",
      "Người chuyển động mờ",
      "Mây mềm",
      "Nước mượt",
      "Tia sao",
      "Lóe sáng nhẹ",
      "Luồng sáng",
      "Giảm phản xạ kính",
    ]);
    for (const e of EFFECT_CATALOG) {
      expect(e.promptEn).toContain("{intensity}");
      expect(e.guardEn.length).toBeGreaterThan(10);
    }
  });

  it("validates the ShotIntent field: off by default, intensity enum, at most two secondaries", () => {
    const parsed = ShotIntentSchema.parse({
      projectType: "townhouse",
      effects: { primary: { id: "sunstar", intensity: "strong" } },
    });
    expect(parsed.effects).toEqual({
      primary: { id: "sunstar", intensity: "strong" },
      secondary: [],
    });
    expect(ShotIntentSchema.parse({ projectType: "townhouse" }).effects).toBeUndefined();
    expect(
      ShotIntentSchema.safeParse({
        projectType: "townhouse",
        effects: { primary: { id: "sunstar", intensity: "extreme" } },
      }).success,
    ).toBe(false);
    expect(
      ShotIntentSchema.safeParse({
        projectType: "townhouse",
        effects: {
          primary: { id: "sunstar", intensity: "light" },
          secondary: ["lens_flare", "god_rays", "soft_clouds"].map((id) => ({
            id,
            intensity: "light",
          })),
        },
      }).success,
    ).toBe(false);
  });

  it("keeps secondary effects only when compatible, after one primary", () => {
    expect(selectedEffects(undefined)).toEqual([]);
    expect(selectedEffects({ secondary: [{ id: "sunstar", intensity: "light" }] })).toEqual([]);
    expect(effectsCompatibleTogether("vehicle_light_trails", "god_rays")).toBe(false);
    expect(effectsCompatibleTogether("sunstar", "sunstar")).toBe(false);
    expect(
      selectedEffects(effects("vehicle_light_trails", "god_rays", "soft_clouds")).map((c) => c.id),
    ).toEqual(["vehicle_light_trails", "soft_clouds"]);
    expect(selectedEffects(effects("sunstar", "sunstar", "lens_flare")).map((c) => c.id)).toEqual([
      "sunstar",
      "lens_flare",
    ]);
  });
});

// ---------------------------------------------------------------- matrix

describe("EffectsCompatibilityMatrix", () => {
  it("returns one entry per effect with a plain reason key", () => {
    const matrix = effectsCompatibility(baseDna(), shot("townhouse"));
    expect(matrix.map((m) => m.effectId)).toEqual([...EFFECT_IDS]);
    for (const m of matrix) expect(m.reasonKey).toBe(`effects.reasons.${m.reason}`);
    expect(matrix.filter((m) => m.status === "blocked").every((m) => m.code)).toBe(true);
  });

  it("AC-09: a closed interior has no sky for soft clouds", () => {
    const dna = closedBedroom();
    expect(effectScene(dna, shot("interior")).enclosed).toBe(true);
    const clouds = status(dna, shot("interior"), "soft_clouds");
    expect(clouds).toMatchObject({
      status: "blocked",
      reason: "no_sky",
      code: "EFFECT_SOURCE_MISSING",
    });
    // Without a catalog the project type decides.
    expect(status(baseDna(), shot("interior"), "soft_clouds").status).toBe("blocked");
    expect(status(baseDna(), shot("townhouse"), "soft_clouds").status).toBe("available");
  });

  it("AC-08: light trails while the only vehicle is parked are a motion conflict", () => {
    const parked = status(
      nightStreet(),
      shot("townhouse", undefined, [car("static")]),
      "vehicle_light_trails",
    );
    expect(parked).toMatchObject({
      status: "blocked",
      reason: "vehicles_parked",
      code: "EFFECT_MOTION_CONFLICT",
    });
    const moving = status(
      nightStreet(),
      shot("townhouse", undefined, [car("static"), car("moving")]),
      "vehicle_light_trails",
    );
    expect(moving).toMatchObject({ status: "available", reason: "available" });
  });

  it("light trails need a road, a moving vehicle and dusk or night", () => {
    const moving = [car("moving")];
    expect(status(nightStreet(), shot("townhouse"), "vehicle_light_trails")).toMatchObject({
      status: "blocked",
      reason: "no_moving_vehicle",
      code: "EFFECT_SOURCE_MISSING",
    });
    const day = { ...at(baseDna(), "midday"), site: streetSite() };
    expect(status(day, shot("townhouse", undefined, moving), "vehicle_light_trails").reason).toBe(
      "needs_dark",
    );
    const golden = { ...at(baseDna(), "golden_hour"), site: streetSite() };
    expect(
      status(golden, shot("townhouse", undefined, moving), "vehicle_light_trails"),
    ).toMatchObject({ status: "conditional", reason: "needs_dusk" });
    // Legacy projects only infer the street in front: allowed, worded conditionally.
    expect(
      status(at(baseDna(), "night"), shot("townhouse", undefined, moving), "vehicle_light_trails"),
    ).toMatchObject({ status: "conditional", reason: "road_unverified" });
    const noRoad = {
      ...nightStreet(),
      site: { ...streetSite(), front: { kind: "open_space" as const, evidence: verified } },
    };
    expect(
      status(noRoad, shot("townhouse", undefined, moving), "vehicle_light_trails").reason,
    ).toBe("no_road");
    expect(status(closedBedroom(), shot("interior"), "vehicle_light_trails").reason).toBe(
      "no_road",
    );
  });

  it("people blur needs moving people; static people conflict", () => {
    expect(status(baseDna(), shot("townhouse"), "people_motion_blur").status).toBe("conditional");
    expect(
      status(baseDna(), shot("townhouse", undefined, [person("static")]), "people_motion_blur"),
    ).toMatchObject({
      status: "blocked",
      code: "EFFECT_MOTION_CONFLICT",
    });
    expect(
      status(baseDna(), shot("townhouse", undefined, [person("moving")]), "people_motion_blur")
        .status,
    ).toBe("available");
  });

  it("silky water needs real water", () => {
    expect(status(baseDna(), shot("townhouse"), "silky_water")).toMatchObject({
      status: "blocked",
      reason: "no_water",
    });
    const pool = withSpaces("villa", [space("SPC_pool", "villa.outdoor.ho_boi")]);
    expect(status(pool, shot("villa"), "silky_water").status).toBe("available");
    const lake = baseDna();
    lake.context.rear.elements = ["Hồ Tây"];
    expect(status(lake, shot("townhouse"), "silky_water")).toMatchObject({
      status: "conditional",
      reason: "water_unverified",
    });
  });

  it("sunstar and flare need a light source; no second sun", () => {
    expect(status(baseDna(), shot("townhouse"), "sunstar").status).toBe("available");
    const dark = at(baseDna(), "night");
    expect(status(dark, shot("townhouse"), "sunstar")).toMatchObject({
      status: "blocked",
      reason: "no_light_source",
      code: "EFFECT_SOURCE_MISSING",
    });
    const lit = at(baseDna(), "night", {
      artificialLighting: [{ type: "street", enabled: true }],
    });
    expect(status(lit, shot("townhouse"), "lens_flare").status).toBe("available");
    const overcast = {
      ...baseDna(),
      weather: { schemaVersion: 1 as const, sky: "overcast", notes: "" },
    };
    expect(status(overcast, shot("townhouse"), "sunstar").reason).toBe("sun_hidden");
  });

  it("light rays need sunlight and, indoors, a real opening", () => {
    expect(status(at(baseDna(), "night"), shot("townhouse"), "god_rays").reason).toBe(
      "needs_sunlight",
    );
    const noWindow = { ...closedBedroom(), interior: undefined };
    expect(status(noWindow, shot("interior"), "god_rays")).toMatchObject({
      status: "conditional",
      reason: "opening_unverified",
    });
    const sealed = closedBedroom();
    sealed.interior = { daylightDirection: "none", artificialScenes: [] } as never;
    expect(status(sealed, shot("interior"), "god_rays").reason).toBe("no_opening");
    sealed.interior = { daylightDirection: "left", artificialScenes: [] } as never;
    expect(status(sealed, shot("interior"), "god_rays").status).toBe("available");
  });

  it("reflection control depends on the camera angle and on glass indoors", () => {
    const dna = baseDna();
    const aerial = dna.cameras.find((c) => c.viewType === "aerial")!;
    expect(
      status(dna, { ...shot("townhouse"), cameraId: aerial.id }, "reflection_control").reason,
    ).toBe("camera_angle");
    expect(status(closedBedroom(), shot("interior"), "reflection_control").reason).toBe(
      "depends_on_glass",
    );
  });
});

// ---------------------------------------------------------------- validator

describe("effect rules in the single validator", () => {
  it("AC-09 blocks clouds in a closed interior", () => {
    expect(codes(closedBedroom(), shot("interior", effects("soft_clouds")))).toEqual([
      "EFFECT_SOURCE_MISSING:BLOCK:shotIntent.effects.primary:no_sky",
    ]);
    expect(
      validateShot({ dna: closedBedroom(), shotIntent: shot("interior", effects("soft_clouds")) })
        .verdict,
    ).toBe("BLOCK");
  });

  it("AC-08 blocks trails from a parked car", () => {
    const result = validateShot({
      dna: nightStreet(),
      shotIntent: shot("townhouse", effects("vehicle_light_trails"), [car("static")]),
    });
    expect(result.verdict).toBe("BLOCK");
    expect(result.issues.find((i) => i.code === "EFFECT_MOTION_CONFLICT")).toMatchObject({
      severity: "BLOCK",
      exceptionAllowed: false,
      path: "shotIntent.effects.primary",
      messageKey: "conflicts.EFFECT_MOTION_CONFLICT",
    });
  });

  it("checks secondaries by their index and raises nothing without effects", () => {
    const intent = shot("townhouse", effects("sunstar", "silky_water"));
    expect(codes(baseDna(), intent)).toEqual([
      "EFFECT_SOURCE_MISSING:BLOCK:shotIntent.effects.secondary[0]:no_water",
    ]);
    expect(codes(baseDna(), shot("townhouse"))).toEqual([]);
    expect(
      codes(
        baseDna(),
        shot("townhouse", { secondary: [{ id: "silky_water", intensity: "light" }] }),
      ),
    ).toEqual([]);
    expect(
      validateShot({
        dna: nightStreet(),
        shotIntent: shot("townhouse", effects("vehicle_light_trails"), [car("moving")]),
      }).verdict,
    ).toBe("ALLOW");
  });
});

// ---------------------------------------------------------------- compiler

describe("EFFECTS compiler section", () => {
  it("keeps the versions", () => {
    expect(COMPILER_VERSION).toBe("pc-1.8.0");
    expect(VALIDATOR_VERSION).toBe("cv-1.2.0");
  });

  it("leaves the prompt byte-identical without a selected effect", () => {
    const plain = compile(baseDna());
    const off = compile(baseDna(), shot("townhouse", { secondary: [] }));
    const onlySecondary = compile(
      baseDna(),
      shot("townhouse", { secondary: [{ id: "sunstar", intensity: "light" }] }),
    );
    for (const bundle of [off, onlySecondary]) {
      expect(bundle.positivePrompt).toBe(plain.positivePrompt);
      expect(bundle.sourceHash).toBe(plain.sourceHash);
      expect(bundle.shotIntent).toBeUndefined();
    }
    expect(plain.positivePrompt).not.toContain(EFFECTS_HEADING);
    expect(
      normalizeShotIntent(shot("townhouse", { secondary: [] }), "townhouse", null),
    ).toBeUndefined();
  });

  it("follows the SRS §6.2 example for light trails, after the scene objects", () => {
    const intent = shot("townhouse", effects("vehicle_light_trails"), [car("moving")]);
    const bundle = compile(nightStreet(), intent);
    expect(PromptBundleSchema.parse(bundle).shotIntent?.effects).toEqual(intent.effects);
    expect((bundle.metadata.sections as string[]).slice(-3)).toEqual([
      "sceneObjects",
      "effects",
      "quality",
    ]);
    const section = bundle.positivePrompt.split("\n\n").find((s) => s.startsWith(EFFECTS_HEADING))!;
    expect(section.split("\n")).toEqual([
      EFFECTS_HEADING,
      "Keep all architecture, roads and neighboring buildings static and sharply defined.",
      "Apply subtle long-exposure light trails ONLY to moving vehicles on the existing road.",
      "Do not introduce new lanes, widen the street, remove parked vehicles or blur the building.",
      "These effects describe the look only, not exact camera settings; never add a new source for an effect.",
    ]);
  });

  it("never compiles a blocked effect and words a conditional one", () => {
    const blocked = compile(closedBedroom(), shot("interior", effects("soft_clouds")));
    expect(blocked.positivePrompt).not.toContain(EFFECTS_HEADING);
    const lines = effectsLines(
      closedBedroom(),
      shot("interior", effects("god_rays", "soft_clouds")),
    );
    expect(lines[0]).toMatch(/walls, openings and fixed furniture static/);
    expect(lines[1]).toMatch(/medium|subtle/);
    expect(lines[1]).toMatch(/only where that source is present in the approved references\.$/);
    expect(lines.join("\n")).not.toMatch(/clouds/);
  });

  it("uses the intensity words and compiles secondaries after the primary", () => {
    const fx: ShotEffects = {
      primary: { id: "sunstar", intensity: "strong" },
      secondary: [{ id: "lens_flare", intensity: "medium" }],
    };
    const lines = effectsLines(baseDna(), shot("townhouse", fx));
    expect(lines[1]).toBe(
      "Apply a strong starburst ONLY to an existing point light source (the sun at an edge of the building or a visible lamp).",
    );
    expect(lines[2]).toBe("Do not add a second sun or any new light source.");
    expect(lines[3]).toMatch(/^Apply a moderate lens flare/);
    // Deterministic.
    expect(compile(baseDna(), shot("townhouse", fx))).toEqual(
      compile(baseDna(), shot("townhouse", fx)),
    );
  });
});
