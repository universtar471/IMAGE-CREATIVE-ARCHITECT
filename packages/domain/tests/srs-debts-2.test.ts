/**
 * SRS debts 2 (ADR-034 / ADR-036 follow-ups): space floor step and facts, interior room
 * sync, the site-driven camera plan, and interior camera intents.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BASEMENT_FLOOR_ID,
  COMPILER_VERSION,
  DEFAULT_FLOOR_COUNT,
  LOCKABLE_SPACE_ELEMENTS,
  ProjectDNASchema,
  ROOF_FLOOR_ID,
  SPACE_CATALOG,
  SPACE_PLACEMENT_FACTS,
  SceneObjectRequestSchema,
  SiteExtensionSchema,
  availableIntents,
  cameraSitePlan,
  compilePrompt,
  createInitialDNA,
  defaultInteriorDNA,
  lockableElements,
  placementFactsFor,
  resolveVisualIntent,
  siteCameraPlan,
  siteForEditing,
  siteTopologyFromSite,
  sideHasHeightRelation,
  spaceFloorOptions,
  spaceScopeLines,
  suggestInteriorRoom,
  suggestedCameraViewType,
  topologyFromAdjacency,
  resolveSiteAdjacency,
  validateObjectPlacement,
  validateShot,
  withSiteBoundary,
  VISUAL_INTENT_VIEWS,
  type CameraDNA,
  type EvidenceRef,
  type ProjectDNA,
  type ProjectType,
  type SiteBoundary,
  type SiteExtension,
  type SiteTopology,
  type SpaceInstance,
} from "../src";

const townhouse = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

const verified: EvidenceRef = { status: "verified", sourceAssetIds: [] };
const declared: EvidenceRef = { status: "user_declared", sourceAssetIds: [] };
const unknown: EvidenceRef = { status: "unknown", sourceAssetIds: [] };

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

const withSpaces = (
  dna: ProjectDNA,
  archetype: string,
  spaces: SpaceInstance[],
  activeSpaceId = spaces[0]?.id,
): ProjectDNA => ({
  ...dna,
  spaceCatalog: {
    version: 1,
    buildingArchetype: archetype,
    spaces,
    ...(activeSpaceId ? { activeSpaceId } : {}),
  },
});

const interiorDna = (roomId: "master_bedroom" | "living_room" = "master_bedroom"): ProjectDNA =>
  ProjectDNASchema.parse({
    ...createInitialDNA({ projectType: "interior", pack: null }),
    interior: { ...defaultInteriorDNA("villa", roomId), furnitureIds: ["bed", "wardrobe"] },
  });

const compileInterior = (dna: ProjectDNA) =>
  compilePrompt({
    project: { id: "PRJ_INT", name: "Interior", projectType: "interior" },
    dna,
    references: [],
  });

// ---------------------------------------------------------------- 1. space wizard

describe("space wizard: floor step, locked elements, placement facts", () => {
  it("offers stable floor ids from the building's floor count", () => {
    expect(spaceFloorOptions(3).map((o) => o.id)).toEqual([
      BASEMENT_FLOOR_ID,
      "floor_1",
      "floor_2",
      "floor_3",
      ROOF_FLOOR_ID,
    ]);
    expect(spaceFloorOptions(undefined)).toHaveLength(DEFAULT_FLOOR_COUNT + 2);
    expect(spaceFloorOptions(0)).toHaveLength(DEFAULT_FLOOR_COUNT + 2);
    // A stored id outside the list stays selectable.
    expect(spaceFloorOptions(2, "mezzanine").at(-1)).toEqual({ id: "mezzanine", kind: "other" });
    expect(spaceFloorOptions(2, "floor_2").some((o) => o.kind === "other")).toBe(false);
  });

  it("does not compile the floor; locked elements become one SPACE SCOPE line", () => {
    const preset = SPACE_CATALOG.preset("townhouse.outdoor.san_sau_hep")!;
    const lockable = lockableElements(preset);
    expect(lockable.length).toBeGreaterThan(0);
    expect(new Set(lockable.map((i) => i.id)).size).toBe(lockable.length);
    expect(lockable.map((i) => i.id)).toEqual(
      expect.arrayContaining(["existing_walls", "paving", ...preset.optional.map((i) => i.id)]),
    );
    expect(lockable.map((i) => i.id)).not.toContain("ceiling");
    expect(
      lockableElements(SPACE_CATALOG.preset("villa.sleeping.master_suite")).map((i) => i.id),
    ).toContain("built_in_furniture");
    expect(lockableElements(null)).toEqual(LOCKABLE_SPACE_ELEMENTS.common);

    const plain = withSpaces(townhouse(), "townhouse", [space("SPC_y", preset.id)]);
    const onFloor = withSpaces(townhouse(), "townhouse", [
      space("SPC_y", preset.id, { floorId: "floor_1" }),
    ]);
    expect(spaceScopeLines(onFloor)).toEqual(spaceScopeLines(plain));

    const locked = withSpaces(townhouse(), "townhouse", [
      space("SPC_y", preset.id, { lockedElementIds: [lockable[0]!.id, "old_mango_tree"] }),
    ]);
    const lines = spaceScopeLines(locked);
    expect(lines).toContain(
      `Locked elements, kept exactly where and as they appear in the approved references (do not move, restyle or remove them): ${lockable[0]!.en}; old mango tree.`,
    );
    expect(lines.length).toBe(spaceScopeLines(plain).length + 1);

    const custom = withSpaces(townhouse(), "townhouse", [
      space("SPC_c", "custom", { label: "Reading nook", lockedElementIds: ["built_in_shelf"] }),
    ]);
    expect(spaceScopeLines(custom).at(-1)).toMatch(/: built in shelf\.$/);
  });

  it("offers driveway / hardscape for a villa yard and the bay for a garage", () => {
    expect(SPACE_PLACEMENT_FACTS).toEqual(["driveway", "hardscape", "garage_bay"]);
    expect(placementFactsFor(SPACE_CATALOG.preset("villa.outdoor.san_vuon_rong"))).toEqual([
      "driveway",
      "hardscape",
    ]);
    expect(placementFactsFor(SPACE_CATALOG.preset("villa.service.gara"))).toEqual(["garage_bay"]);
    expect(placementFactsFor(SPACE_CATALOG.preset("villa.sleeping.master_suite"))).toEqual([]);
    expect(placementFactsFor(null)).toEqual([]);
  });

  it("AC-07 style: a villa yard with a verified driveway accepts a parked car", () => {
    const car = SceneObjectRequestSchema.parse({
      presetId: "car.mercedes_300sl.gullwing",
      quantity: 1,
      targetSpaceId: "SPC_yard",
      state: "static",
    });
    const yard = (facts: SpaceInstance["facts"]) =>
      withSpaces(townhouse(), "villa", [
        space("SPC_yard", "villa.outdoor.san_vuon_rong", { facts }),
      ]);
    const check = (dna: ProjectDNA) =>
      validateObjectPlacement(dna, { projectType: "villa", sceneObjects: [car] });

    // No fact: the driveway is not on record, so the car is blocked (never invented).
    expect(check(yard({}))).toMatchObject([
      { code: "OBJECT_NO_PLACEMENT_ZONE", severity: "BLOCK", params: { reason: "zone_absent" } },
    ]);
    // Recorded but unknown evidence: a warning.
    expect(check(yard({ driveway: { value: true, evidence: unknown } }))).toMatchObject([
      { code: "OBJECT_NO_PLACEMENT_ZONE", severity: "WARN" },
    ]);
    // Verified or declared: allowed.
    for (const evidence of [verified, declared]) {
      const dna = yard({ driveway: { value: true, evidence } });
      expect(check(dna)).toEqual([]);
      expect(
        validateShot({ dna, shotIntent: { projectType: "villa", sceneObjects: [car] } }).verdict,
      ).toBe("ALLOW");
    }
    // A verified hardscape is an explicit zone too.
    expect(
      validateObjectPlacement(yard({ hardscape: { value: true, evidence: verified } }), {
        projectType: "villa",
        sceneObjects: [{ ...car, placementZoneId: "hardscape" }],
      }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------- 2. interior sync

describe("interior room sync and the interior space line", () => {
  it("suggests the ADR-027 room of the active interior space, once", () => {
    const master = withSpaces(interiorDna("living_room"), "villa", [
      space("SPC_m", "villa.sleeping.master_suite"),
    ]);
    expect(suggestInteriorRoom(master)).toBe("master_bedroom");
    // Already chosen: nothing to suggest.
    expect(
      suggestInteriorRoom(withSpaces(interiorDna(), "villa", master.spaceCatalog!.spaces)),
    ).toBe(null);
    // An exterior space, a preset without a room, no interior DNA: no suggestion.
    expect(
      suggestInteriorRoom(
        withSpaces(interiorDna(), "villa", [space("SPC_g", "villa.outdoor.san_vuon_rong")]),
      ),
    ).toBeNull();
    expect(
      suggestInteriorRoom(withSpaces(interiorDna(), "villa", [space("SPC_c", "custom")])),
    ).toBeNull();
    expect(
      suggestInteriorRoom(
        withSpaces(townhouse(), "villa", [space("SPC_m", "villa.sleeping.master_suite")]),
      ),
    ).toBeNull();
  });

  it("an interior project whose active space is a garden has no 'Interior space' line", () => {
    const spaces = [
      space("SPC_m", "villa.sleeping.master_suite"),
      space("SPC_g", "villa.outdoor.san_vuon_rong"),
    ];
    const garden = compileInterior(withSpaces(interiorDna(), "villa", spaces, "SPC_g"));
    expect(COMPILER_VERSION).toBe("pc-1.10.0");
    expect(garden.positivePrompt).not.toContain("Interior space:");
    expect(garden.positivePrompt).not.toMatch(/master bedroom/i);
    expect(garden.metadata.sections).not.toContain("form");
    expect(garden.positivePrompt).toContain("render only the large villa garden of this villa");

    const bedroom = compileInterior(withSpaces(interiorDna(), "villa", spaces, "SPC_m"));
    expect(bedroom.positivePrompt).toContain("Interior space: villa master bedroom.");
    // Without a catalog the interior line is unchanged.
    expect(compileInterior(interiorDna()).positivePrompt).toContain(
      "Interior space: villa master bedroom.",
    );
  });
});

// ---------------------------------------------------------------- 3. site-driven plan

const TOPOLOGIES: Record<string, SiteTopology | null> = {
  midBlock: { left: "attached", right: "attached", cornerLot: false },
  cornerLeft: { left: "open", right: "attached", cornerLot: true, cornerSide: "left" },
  cornerRight: { left: "attached", right: "open", cornerLot: true, cornerSide: "right" },
  openLeftUnknownRight: { left: "open", right: "unknown", cornerLot: false },
  undeclared: null,
};

const extraCameras: CameraDNA[] = [
  {
    schemaVersion: 1,
    id: "CAM_SIDE_LEFT",
    name: "Left side",
    viewType: "exterior_side",
    azimuthDeg: 90,
    isAnchorView: false,
    notes: "",
  },
  {
    schemaVersion: 1,
    id: "CAM_SIDE_RIGHT",
    name: "Right side",
    viewType: "exterior_side",
    azimuthDeg: -90,
    isAnchorView: false,
    notes: "",
  },
];

const withTopology = (topology: SiteTopology | null): ProjectDNA => {
  const dna = townhouse();
  dna.cameras.push(...structuredClone(extraCameras));
  if (topology) dna.context.siteTopology = topology;
  else {
    dna.context.left.adjacentBuildings = [];
    dna.context.right.adjacentBuildings = [];
    delete dna.context.siteTopology;
  }
  return dna;
};

const texts = (dna: ProjectDNA, projectType: ProjectType, cameraId: string, master: boolean) => {
  const b = compilePrompt({
    project: { id: "PRJ_SITE", name: "Site", projectType },
    dna,
    references: master ? [{ assetId: "AST_MASTER", role: "master_architecture" }] : [],
    cameraId,
  });
  return {
    positive: b.positivePrompt,
    negative: b.negativePrompt,
    preservation: b.preservationInstructions,
  };
};

const boundary = (kind: SiteBoundary["kind"], evidence = verified): SiteBoundary => ({
  kind,
  evidence,
});

describe("negative prompt and camera chip read the resolved site adjacency", () => {
  it("is byte-identical when `site` mirrors the toggles", () => {
    for (const [name, topology] of Object.entries(TOPOLOGIES)) {
      for (const projectType of ["townhouse", "villa"] as const) {
        const toggles = withTopology(topology);
        const mirrored = {
          ...structuredClone(toggles),
          site: siteForEditing(toggles, projectType),
        };
        for (const camera of toggles.cameras) {
          const label = `${name}/${projectType}/${camera.name}`;
          expect(siteCameraPlan(camera, toggles, projectType), label).toEqual(
            cameraSitePlan(camera, toggles.context, projectType),
          );
          expect(siteCameraPlan(camera, mirrored, projectType), label).toEqual(
            cameraSitePlan(camera, toggles.context, projectType),
          );
          for (const master of [true, false])
            expect(texts(mirrored, projectType, camera.id, master), label).toEqual(
              texts(toggles, projectType, camera.id, master),
            );
        }
      }
    }
  });

  it("follows `site` when it disagrees with the toggles", () => {
    const dna = withTopology(TOPOLOGIES.cornerLeft!);
    const frontLeft = dna.cameras.find(
      (c) => c.viewType === "exterior_corner" && c.azimuthDeg! > 0,
    )!;
    // The toggles say a left street corner; the verified site says the left side is attached.
    expect(cameraSitePlan(frontLeft, dna.context, "townhouse").mode).toBe("corner_side");
    const before = texts(dna, "townhouse", frontLeft.id, true);
    expect(before.negative).not.toContain("exposed side wall");

    dna.site = {
      version: 1,
      coordinateConvention: "viewer_facing_front_facade",
      front: boundary("street"),
      left: boundary("attached_building"),
      right: boundary("attached_building"),
      rear: boundary("unknown", unknown),
    };
    expect(siteCameraPlan(frontLeft, dna, "townhouse")).toMatchObject({
      mode: "oblique_street",
      side: "left",
    });
    const after = texts(dna, "townhouse", frontLeft.id, true);
    expect(after.negative).toContain("corner plot, street intersection, exposed side wall");
    expect(after.positive).toContain(
      "the left side wall stays hidden behind the attached neighbour",
    );
  });

  it("folds a boundary wall back to an unknown side, never an open one", () => {
    const site: SiteExtension = {
      version: 1,
      coordinateConvention: "viewer_facing_front_facade",
      front: boundary("street"),
      left: boundary("boundary_wall"),
      right: boundary("street"),
      rear: boundary("unknown", unknown),
    };
    expect(topologyFromAdjacency(resolveSiteAdjacency({ site }))).toEqual({
      left: "unknown",
      right: "open",
      cornerLot: true,
      cornerSide: "right",
    });
    expect(siteTopologyFromSite(site)).toEqual(topologyFromAdjacency(site));
    expect(siteCameraPlan(extraCameras[0]!, { site }, "interior").mode).toBe("normal");
  });
});

describe("heightRelation per side", () => {
  const site = siteForEditing(withTopology(TOPOLOGIES.midBlock!), "townhouse");

  it("sets, keeps and clears the height relation of a side", () => {
    const taller = withSiteBoundary(site, "left", { heightRelation: "taller" });
    expect(taller.left).toEqual({ ...site.left, heightRelation: "taller" });
    expect(taller.right).toEqual(site.right);
    expect(SiteExtensionSchema.parse(taller)).toEqual(taller);
    // Another edit keeps it; changing the kind or null removes it.
    expect(withSiteBoundary(taller, "left", { status: "verified" }).left.heightRelation).toBe(
      "taller",
    );
    expect(withSiteBoundary(taller, "left", { kind: "street" }).left).not.toHaveProperty(
      "heightRelation",
    );
    expect(withSiteBoundary(taller, "left", { heightRelation: null }).left).toEqual(site.left);
  });

  it("is offered for neighbours and walls only", () => {
    expect(sideHasHeightRelation("attached_building")).toBe(true);
    expect(sideHasHeightRelation("boundary_wall")).toBe(true);
    expect(sideHasHeightRelation("street")).toBe(false);
    expect(sideHasHeightRelation("open_space")).toBe(false);
  });
});

// ---------------------------------------------------------------- 4. camera intent

describe("camera intent for interiors", () => {
  it("an interior project whose active space is a garden is an outdoor shot", () => {
    const garden = withSpaces(interiorDna(), "villa", [
      space("SPC_g", "villa.outdoor.san_vuon_rong"),
    ]);
    expect(availableIntents(garden)).toContain("aerial");
    expect(resolveVisualIntent({ view: "overview", purpose: "landscape" }, garden).viewType).toBe(
      "exterior_front",
    );
    expect(suggestedCameraViewType({ view: "overview", purpose: "landscape" }, garden)).toBe(
      "exterior_front",
    );
    // Without an active space, the interior DNA decides.
    expect(availableIntents(interiorDna())).not.toContain("aerial");
  });

  it("interior overview never yields exterior_front", () => {
    const shots = [
      interiorDna(),
      withSpaces(interiorDna(), "villa", [space("SPC_m", "villa.sleeping.master_suite")]),
      // An exterior project whose active space is an interior room.
      withSpaces(townhouse(), "villa", [space("SPC_m", "villa.sleeping.master_suite")]),
    ];
    for (const dna of shots) {
      const overview = resolveVisualIntent({ view: "overview", purpose: "landscape" }, dna);
      expect(overview).toMatchObject({
        viewType: "interior_wide",
        presetId: "visual_intent_overview",
        composition: "wide view from the entrance showing the whole room",
      });
      expect(overview.lensMm).toBeGreaterThanOrEqual(20);
      expect(resolveVisualIntent({ view: "approach", purpose: "portrait" }, dna)).toMatchObject({
        viewType: "interior_wide",
        composition: "one-point perspective facing the main wall",
        aspectRatio: "4:5",
      });
      expect(resolveVisualIntent({ view: "detail", purpose: "square" }, dna).viewType).toBe(
        "interior_detail",
      );
      // An unavailable intent (aerial) falls back to the interior overview.
      expect(resolveVisualIntent({ view: "aerial", purpose: "landscape" }, dna).viewType).toBe(
        "interior_wide",
      );
      for (const view of VISUAL_INTENT_VIEWS.filter((v) => v === "overview" || v === "approach"))
        expect(suggestedCameraViewType({ view, purpose: "landscape" }, dna)).not.toBe(
          "exterior_front",
        );
    }
    // Exterior shots keep their suggestions.
    expect(
      resolveVisualIntent({ view: "overview", purpose: "landscape" }, townhouse()),
    ).toMatchObject({ viewType: "exterior_front", lensMm: 24 });
    expect(suggestedCameraViewType({ view: "approach", purpose: "landscape" })).toBe(
      "exterior_front",
    );
  });
});
