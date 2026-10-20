import { describe, expect, it } from "vitest";
import {
  ContextDNASchema,
  ProjectDNASchema,
  cameraSitePlan,
  compilePrompt,
  revealedSide,
  resolveSiteTopology,
} from "../src/index";
import { loadSeedRegistry } from "./helpers";
import {
  CAMERA_PRESETS,
  INTERIOR_STYLES,
  METAL_FINISHES,
  WALL_MATERIALS,
} from "../src/interior/catalog";
import type { CameraDNA } from "../src/schemas/future";
import type { ProjectDNA } from "../src/schemas/projectDna";

const camera = (overrides: Partial<CameraDNA> = {}): CameraDNA => ({
  schemaVersion: 1,
  id: "CAM_01J00000000000000000000001",
  name: "Test camera",
  isAnchorView: false,
  viewType: "exterior_corner",
  azimuthDeg: 45,
  heightM: 1.6,
  distanceM: 16,
  lensMm: 24,
  composition: "showing the front facade and the left side",
  notes: "",
  ...overrides,
});
const LEFT_ID = "CAM_01J00000000000000000000001";
const RIGHT_ID = "CAM_01J00000000000000000000003";
const AERIAL_ID = "CAM_01J00000000000000000000002";

const dna = (overrides: Record<string, unknown> = {}): ProjectDNA =>
  ProjectDNASchema.parse({
    schemaVersion: 1,
    building: {
      schemaVersion: 1,
      buildingType: "townhouse",
      dimensions: {},
      massing: {},
      roof: {},
      openings: {},
      materials: [],
      colorPalette: [],
      specialFeatures: [],
      notes: "",
    },
    context: {
      schemaVersion: 1,
      density: "high",
      left: { adjacentBuildings: ["attached neighbouring townhouse"] },
      right: { adjacentBuildings: ["attached neighbouring townhouse"] },
    },
    cameras: [],
    locks: {},
    ...overrides,
  });

describe("ADR-028 topology helpers", () => {
  it("covers camera mode table", () => {
    const attached = dna({
      context: { schemaVersion: 1, left: { adjacentBuildings: ["attached"] }, right: {} },
    }).context;
    expect(cameraSitePlan(camera(), attached, "custom").mode).toBe("oblique_street");
    expect(
      cameraSitePlan(camera({ viewType: "exterior_corner", azimuthDeg: -45 }), attached, "custom")
        .side,
    ).toBe("right");
    expect(
      cameraSitePlan(camera({ viewType: "aerial", azimuthDeg: 35 }), attached, "custom").mode,
    ).toBe("aerial_block");
    expect(
      cameraSitePlan(
        camera({ viewType: "aerial", azimuthDeg: 35 }),
        dna({ context: { schemaVersion: 1, density: "high" } }).context,
        "custom",
      ).mode,
    ).toBe("aerial_block");
    expect(cameraSitePlan(undefined, attached, "custom").mode).toBe("normal");
    expect(cameraSitePlan(camera(), attached, "interior").mode).toBe("normal");
    expect(
      cameraSitePlan(
        camera(),
        dna({
          context: {
            schemaVersion: 1,
            siteTopology: { left: "open", right: "unknown", cornerLot: false },
            left: {},
            right: {},
          },
        }).context,
        "custom",
      ).mode,
    ).toBe("normal");
    expect(
      cameraSitePlan(
        camera(),
        dna({
          context: {
            schemaVersion: 1,
            siteTopology: { left: "unknown", right: "unknown", cornerLot: false },
          },
        }).context,
        "custom",
      ).mode,
    ).toBe("unknown_side");
    expect(
      cameraSitePlan(
        camera({ azimuthDeg: 45 }),
        dna({
          context: {
            schemaVersion: 1,
            siteTopology: { left: "open", right: "unknown", cornerLot: true, cornerSide: "left" },
          },
        }).context,
        "custom",
      ).mode,
    ).toBe("corner_side");
  });

  it("infers attached text with diacritics, ascii, and party wall", () => {
    expect(
      resolveSiteTopology(
        dna({
          context: { schemaVersion: 1, left: { adjacentBuildings: ["nhà liền kề"] }, right: {} },
        }).context,
      ).left,
    ).toBe("attached");
    expect(
      resolveSiteTopology(
        dna({
          context: { schemaVersion: 1, left: { adjacentBuildings: ["nha lien ke"] }, right: {} },
        }).context,
      ).left,
    ).toBe("attached");
    expect(
      resolveSiteTopology(
        dna({ context: { schemaVersion: 1, left: { notes: "party wall" }, right: {} } }).context,
      ).left,
    ).toBe("attached");
    expect(
      resolveSiteTopology(
        dna({
          context: {
            schemaVersion: 1,
            siteTopology: { left: "unknown", right: "unknown", cornerLot: false },
            left: { adjacentBuildings: ["attached"] },
            right: {},
          },
        }).context,
      ).left,
    ).toBe("attached");
    expect(
      resolveSiteTopology(
        dna({
          context: {
            schemaVersion: 1,
            siteTopology: { left: "open", right: "unknown", cornerLot: false },
            left: { adjacentBuildings: ["attached"] },
            right: {},
          },
        }).context,
      ).left,
    ).toBe("open");
  });

  it("reveals sides from azimuth and preset ids", () => {
    expect(revealedSide(camera({ azimuthDeg: 0 }))).toBeNull();
    expect(revealedSide(camera({ azimuthDeg: -20 }))).toBe("right");
    expect(revealedSide(camera({ azimuthDeg: undefined, presetId: "front_left_corner" }))).toBe(
      "left",
    );
    expect(revealedSide(camera({ viewType: "aerial" }))).toBeNull();
  });
});

describe("ADR-028 compiler", () => {
  const input = (projectType: "townhouse" | "interior" = "townhouse", cameraId?: string) => ({
    project: { id: "P1", name: "Anchor", projectType, subtype: "default" },
    dna: dna({
      context: {
        schemaVersion: 1,
        density: "high",
        left: { adjacentBuildings: ["attached neighbouring townhouse"] },
        right: { adjacentBuildings: ["attached neighbouring townhouse"] },
      },
      cameras: [
        camera({ id: LEFT_ID, presetId: "front_left_corner" }),
        camera({ id: RIGHT_ID, presetId: "front_right_corner", azimuthDeg: -45 }),
        camera({ id: AERIAL_ID, viewType: "aerial", presetId: "aerial_three_quarter" }),
      ],
      ...(projectType === "interior"
        ? {
            interior: {
              schemaVersion: 1,
              buildingUseId: "apartment",
              roomId: "living_room",
              styleId: "modern",
              paletteId: "cool_neutral",
              surfaces: {
                floor: [],
                wall: [],
                ceiling: [],
                cabinetry: [],
                countertop: [],
                textile: [],
                metal: [],
              },
              furnitureIds: [],
              cameraPresetId: "wide_entrance",
              notes: "",
            },
          }
        : {}),
    }),
    references: [{ assetId: "master", role: "master_architecture" as const }],
    cameraId:
      cameraId === "left"
        ? LEFT_ID
        : cameraId === "right"
          ? RIGHT_ID
          : cameraId === "aerial"
            ? AERIAL_ID
            : cameraId,
  });

  it("uses view-aware framing, master surroundings, party-wall rules and aerial block", () => {
    const left = compilePrompt(input("townhouse", "left"));
    expect(left.compilerVersion).toBe("pc-1.10.0");
    expect(left.positivePrompt).toContain("exterior three-quarter view");
    expect(left.positivePrompt).not.toContain("street-level exterior view");
    expect(left.positivePrompt).not.toContain("showing the front facade and the left side");
    expect(left.preservationInstructions).toContain("visible site");
    expect(left.preservationInstructions).toContain("party walls hidden");
    expect(left.negativePrompt).toContain("exposed side wall");
    const right = compilePrompt({
      ...input("townhouse", "right"),
      dna: dna({
        context: {
          schemaVersion: 1,
          density: "high",
          left: { adjacentBuildings: ["attached neighbouring townhouse"] },
          right: { adjacentBuildings: ["attached neighbouring townhouse"] },
        },
        cameras: [
          camera({ id: LEFT_ID, presetId: "front_left_corner", azimuthDeg: 45 }),
          camera({ id: RIGHT_ID, presetId: "front_right_corner", azimuthDeg: -45 }),
        ],
      }),
    });
    expect(right.positivePrompt).not.toContain("showing the front facade and the right side");
    expect(right.positivePrompt).toContain(
      "front-right oblique street view from eye level, about 30–35° off the facade axis, looking along the street",
    );
    expect(right.preservationInstructions).toContain(
      "The building is attached to neighbouring buildings on both sides.",
    );
    expect(right.preservationInstructions).toContain("party walls hidden");
    expect(right.negativePrompt).toContain("exposed side wall");
    const aerial = compilePrompt(input("townhouse", "aerial"));
    expect(
      aerial.positivePrompt.startsWith("Architectural visualization (aerial architectural view)"),
    ).toBe(true);
    expect(aerial.positivePrompt).not.toContain("plot");
    expect(aerial.preservationInstructions).toContain("same continuous mid-block street");
  });

  it("keeps an open villa corner normal and appends interior master text", () => {
    const openVilla = compilePrompt({
      ...input("townhouse", "left"),
      dna: dna({
        context: {
          schemaVersion: 1,
          siteTopology: { left: "open", right: "open", cornerLot: false },
          left: {},
          right: {},
        },
        cameras: [camera({ id: LEFT_ID })],
      }),
    });
    expect(openVilla.preservationInstructions).not.toContain("oblique street view");
    const interior = compilePrompt(input("interior", undefined));
    expect(interior.compilerVersion).toBe("pc-1.10.0");
    expect(interior.preservationInstructions).toContain(
      "Keep the same room, window positions, view outside and lighting character.",
    );
    // pc-1.4.0 had no provenance fields (ADR-034); compare the prompt content only.
    const {
      validatorVersion: _v,
      catalogVersion: _c,
      sourceHash: _s,
      configHash: _h,
      resolvedWarnings: _w,
      ...interiorContent
    } = interior;
    const pc14InteriorBundle = {
      ...interiorContent,
      compilerVersion: "pc-1.4.0",
      preservationInstructions: interior.preservationInstructions
        .replace("Keep the same room, window positions, view outside and lighting character.", "")
        .trim(),
    };
    expect(pc14InteriorBundle).toMatchInlineSnapshot(`
      {
        "compilerVersion": "pc-1.4.0",
        "metadata": {
          "anchorImage": null,
          "cameraId": null,
          "dnaSchemaVersion": 1,
          "knowledgePack": null,
          "locks": {
            "building": false,
            "camera": false,
            "context": false,
            "lighting": false,
            "mood": false,
            "weather": false,
          },
          "projectId": "P1",
          "projectType": "interior",
          "referenceCount": 1,
          "referenceRoles": {
            "master_architecture": 1,
          },
          "sections": [
            "subject",
            "form",
            "language",
            "materials",
            "furnishing",
            "context",
            "camera",
            "quality",
          ],
          "subtype": "default",
        },
        "negativePrompt": "distorted perspective, warped or bent vertical lines, inconsistent floor count, melted or impossible geometry, floating structural elements, illegible text or watermarks, low resolution, oversaturated colors",
        "positivePrompt": "Architectural visualization (interior view) of a townhouse, project type: interior.

      Interior space: apartment living room.

      Interior style: Modern, clean lines and flat planes.

      Materials and colors: soft gray, white and pale wood.

      Furnishing: balanced furnishing density.

      Surroundings and views: high density. On the left side: adjacent: attached neighbouring townhouse. On the right side: adjacent: attached neighbouring townhouse.

      Camera: wide view from the entrance showing the whole room.

      Photorealistic professional architectural photography, accurate proportions, straight verticals, high detail.",
        "preservationInstructions": "Preserve the architecture of Image 1 (master): do not change building massing, floor count, roof form, opening positions or facade proportions.",
        "referenceInstructions": "Image 1 is the MASTER architecture image: treat it as the authoritative design. Match its building massing, proportions, floor count, roof form, facade composition, window layout and visible materials exactly. Where the text description differs from this image, follow this image.",
      }
    `);
    const exteriorNoCamera = compilePrompt(input("townhouse", undefined));
    expect(exteriorNoCamera.preservationInstructions).toContain(
      "source of truth for both the building and its visible site",
    );
  });

  it("matches known style phrases and passes unknown styles through", () => {
    const known = compilePrompt({
      ...input(),
      dna: dna({
        building: {
          schemaVersion: 1,
          buildingType: "villa",
          architecturalStyle: "Mediterranean",
          dimensions: {},
          massing: {},
          roof: {},
          openings: {},
          materials: [],
          colorPalette: [],
          specialFeatures: [],
          notes: "",
        },
      }),
    });
    expect(known.positivePrompt).toContain("do not add arches unless present in the reference");
    const unknown = compilePrompt({
      ...input(),
      dna: dna({
        building: {
          schemaVersion: 1,
          buildingType: "villa",
          architecturalStyle: "My Custom Style",
          dimensions: {},
          massing: {},
          roof: {},
          openings: {},
          materials: [],
          colorPalette: [],
          specialFeatures: [],
          notes: "",
        },
      }),
    });
    expect(unknown.positivePrompt).toContain("My Custom Style");
  });
});

describe("ADR-028 schema and packs", () => {
  it("validates corner side refinement and accepts partial topology", () => {
    expect(
      ContextDNASchema.safeParse({ schemaVersion: 1, siteTopology: { cornerLot: true } }).success,
    ).toBe(false);
    expect(
      ContextDNASchema.safeParse({
        schemaVersion: 1,
        siteTopology: { cornerLot: true, cornerSide: "left", left: "open" },
      }).success,
    ).toBe(true);
  });

  it("updates every seed pack invariant", () => {
    const registry = loadSeedRegistry();
    const packs = [
      "custom",
      "townhouse",
      "urban_villa",
      "villa",
      "single_storey_house",
      "prefab_modular",
      "interior",
    ] as const;
    for (const pack of packs.flatMap((type) => registry.listSubtypes(type))) {
      for (const preset of pack.cameraPresets) {
        if (pack.projectType === "interior" && ["interior_wide"].includes(preset.viewType))
          expect(preset.lensMm ?? 0).toBeGreaterThanOrEqual(20);
        const parsed = ProjectDNASchema.parse({
          schemaVersion: 1,
          building: {
            schemaVersion: 1,
            buildingType: pack.defaults.building?.buildingType ?? "townhouse",
            dimensions: {},
            massing: {},
            roof: {},
            openings: {},
            materials: [],
            colorPalette: [],
            specialFeatures: [],
            notes: "",
          },
          context: {
            schemaVersion: 1,
            density: "high",
            siteTopology: { left: "attached", right: "attached", cornerLot: false },
          },
          cameras: [
            {
              ...camera(),
              id: LEFT_ID,
              presetId: preset.id,
              viewType: preset.viewType,
              azimuthDeg: preset.azimuthDeg,
              lensMm: preset.lensMm,
              composition: preset.composition,
            },
          ],
          locks: {},
        });
        const compiled = compilePrompt({
          project: { id: "P", name: "P", projectType: pack.projectType, subtype: pack.subtype },
          dna: parsed,
          pack,
          references: [],
          cameraId: LEFT_ID,
        });
        if (pack.projectType !== "interior")
          expect(compiled.positivePrompt.toLowerCase()).not.toContain("plot");
        if (preset.id.includes("corner"))
          expect(compiled.positivePrompt).not.toContain(
            "showing the front facade and the left side",
          );
      }
    }
  });

  it("has reviewed catalog prompts", () => {
    expect(INTERIOR_STYLES.find((x) => x.id === "scandinavian")?.prompt).toContain("pale oak");
    expect(INTERIOR_STYLES.find((x) => x.id === "indochine")?.prompt).toContain(
      "dark stained timber",
    );
    expect(INTERIOR_STYLES.find((x) => x.id === "mediterranean")?.prompt).toContain(
      "do not add arches",
    );
    expect(WALL_MATERIALS.find((x) => x.id === "paint")?.prompt).toContain("smooth matte");
    expect(METAL_FINISHES.find((x) => x.id === "stainless_steel")?.prompt).toContain("brushed");
    expect(CAMERA_PRESETS.find((x) => x.id === "wide_entrance")?.prompt).toContain("whole room");
  });
});
