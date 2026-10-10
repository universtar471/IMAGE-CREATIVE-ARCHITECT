import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  GenerationSubmitRequestSchema,
  ModelCapabilitiesSchema,
  ProjectDNASchema,
  RegionEditParamsSchema,
  RegionListRequestSchema,
  RegionSaveRequestSchema,
  RegionDeleteRequestSchema,
  buildRegionEditPrompt,
  createInitialDNA,
  featherMask,
  isGenerationAllowed,
  rasterizeMask,
  sceneObjectLines,
  type RegionShape,
} from "../src";

const dna = createInitialDNA({ projectType: "custom", pack: null });

const promptBundle = {
  compilerVersion: "pc-1.3.0",
  positivePrompt: "",
  negativePrompt: "",
  referenceInstructions: "",
  preservationInstructions: "",
  metadata: {},
};

function generationRequest(over: Record<string, unknown> = {}) {
  return {
    projectId: "PRJ_1",
    providerId: "provider",
    modelId: "model",
    purpose: "region_edit",
    prompt: promptBundle,
    referenceAssetIds: ["AST_1"],
    params: {
      aspectRatio: null,
      imageSize: null,
      outputCount: 1,
      seed: null,
      quality: null,
      region: {
        regionIds: ["RGN_01J00000000000000000000001"],
        instruction: "Turn the wall blue.",
        mode: "edit",
      },
    },
    cameraId: null,
    ...over,
  };
}

describe("phase 7 region schemas", () => {
  it("keeps old DNA valid and accepts an additive scene graph", () => {
    expect(
      ProjectDNASchema.parse({
        schemaVersion: 1,
        building: { schemaVersion: 1, buildingType: "villa" },
        context: { schemaVersion: 1 },
      }).scene,
    ).toBeUndefined();
    const parsed = ProjectDNASchema.parse({
      ...dna,
      scene: {
        schemaVersion: 1,
        objects: [
          {
            id: "OBJ_01J00000000000000000000001",
            name: "South wall",
            category: "wall",
            material: "brick",
            relations: [{ type: "above", targetId: "OBJ_01J00000000000000000000002" }],
          },
        ],
      },
    });
    expect(parsed.scene?.objects[0]?.name).toBe("South wall");
  });

  it("applies region refinements and purpose requirements", () => {
    expect(
      RegionSaveRequestSchema.safeParse({
        projectId: "PRJ_1",
        assetId: "AST_1",
        region: {
          label: "brush",
          kind: "zone",
          objectId: null,
          shape: { type: "brush", strokes: [{ points: [], radius: 0.1 }] },
        },
      }).success,
    ).toBe(false);
    expect(
      RegionEditParamsSchema.safeParse({
        regionIds: [],
        instruction: "",
        mode: "edit",
      }).success,
    ).toBe(false);
    expect(
      RegionEditParamsSchema.safeParse({
        regionIds: ["RGN_01J00000000000000000000001"],
        instruction: "",
        mode: "material_replace",
      }).success,
    ).toBe(false);
    expect(
      RegionEditParamsSchema.parse({
        regionIds: ["RGN_01J00000000000000000000001"],
        instruction: "",
        mode: "material_replace",
        material: "terrazzo",
      }).material,
    ).toBe("terrazzo");
    expect(() =>
      GenerationSubmitRequestSchema.parse(
        generationRequest({
          referenceAssetIds: ["AST_1", "AST_2"],
        }),
      ),
    ).toThrow(/exactly one reference/i);
    expect(() =>
      GenerationSubmitRequestSchema.parse(
        generationRequest({
          params: { ...generationRequest().params, region: undefined },
        }),
      ),
    ).toThrow(/params\.region/i);
    expect(RegionListRequestSchema.parse({ projectId: "PRJ_1", assetId: "AST_1" })).toEqual({
      projectId: "PRJ_1",
      assetId: "AST_1",
    });
    expect(
      RegionDeleteRequestSchema.parse({
        projectId: "PRJ_1",
        regionId: "RGN_01J00000000000000000000001",
      }),
    ).toBeTruthy();
    expect(
      RegionSaveRequestSchema.safeParse({
        projectId: "PRJ_1",
        assetId: "AST_1",
        region: {
          label: "wall",
          kind: "object",
          objectId: null,
          shape: { type: "rect", x: 0, y: 0, w: 1, h: 1 },
        },
      }).success,
    ).toBe(true);
  });

  it("defaults model mask support to false", () => {
    expect(
      ModelCapabilitiesSchema.parse({
        id: "m",
        label: "Model",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 1,
        maxOutputs: 1,
        aspectRatios: [],
        imageSizes: [],
        supportsNegativePrompt: false,
        supportsSeed: false,
        qualityOptions: [],
        priceHint: null,
        vision: false,
      }).supportsMask,
    ).toBe(false);
  });
});

describe("phase 7 masks", () => {
  const shapes: RegionShape[] = [
    { type: "rect", x: 0.1, y: 0.1, w: 0.3, h: 0.4 },
    {
      type: "polygon",
      points: [
        [0.55, 0.1],
        [0.9, 0.2],
        [0.75, 0.55],
        [0.5, 0.4],
      ],
    },
    {
      type: "brush",
      strokes: [
        {
          points: [
            [0.1, 0.8],
            [0.45, 0.8],
          ],
          radius: 0.06,
        },
      ],
    },
  ];

  it("uses pixel centres, unions shapes, and blurs deterministically", () => {
    const mask = rasterizeMask(shapes, 16, 12);
    expect(mask).toHaveLength(16 * 12);
    expect(mask.some((value) => value === 255)).toBe(true);
    expect(mask.some((value) => value === 0)).toBe(true);
    const feathered = featherMask(mask, 16, 12, 2);
    expect(feathered).toHaveLength(mask.length);
    expect(feathered.some((value, index) => value > 0 && value < 255 && mask[index] === 0)).toBe(
      true,
    );
  });

  it("regenerates the checked-in mask vectors exactly", () => {
    const vectors = JSON.parse(
      readFileSync(new URL("../test-vectors/masks.json", import.meta.url), "utf8"),
    ) as Array<{
      width: number;
      height: number;
      shapes: RegionShape[];
      mask: number[];
      feather?: { radiusPx: number; output: number[] };
    }>;
    for (const vector of vectors) {
      expect(Array.from(rasterizeMask(vector.shapes, vector.width, vector.height))).toEqual(
        vector.mask,
      );
      if (vector.feather)
        expect(
          Array.from(
            featherMask(
              Uint8Array.from(vector.mask),
              vector.width,
              vector.height,
              vector.feather.radiusPx,
            ),
          ),
        ).toEqual(vector.feather.output);
    }
  });
});

describe("phase 7 region prompts and scene pinning", () => {
  it("builds deterministic edit and material prompts", () => {
    const withScene = structuredClone(dna);
    withScene.scene = {
      schemaVersion: 1,
      objects: [
        {
          id: "OBJ_01J00000000000000000000001",
          name: "South wall",
          category: "wall",
          relations: [],
        },
      ],
    };
    const regions = [
      {
        id: "RGN_01J00000000000000000000001",
        projectId: "PRJ_1",
        assetId: "AST_1",
        label: "Facade",
        kind: "object" as const,
        objectId: "OBJ_01J00000000000000000000001",
        shape: { type: "rect" as const, x: 0, y: 0, w: 0.5, h: 0.5 },
        createdAt: "",
        updatedAt: "",
      },
    ];
    const edit = buildRegionEditPrompt({
      dna: withScene,
      regions,
      params: { regionIds: [regions[0]!.id], instruction: "Add a planter.", mode: "edit" },
      nativeMask: false,
    });
    expect(edit).toMatchInlineSnapshot(`
      "Edit only these regions: Facade (South wall). Instruction: Add a planter.
      The second image is a black-and-white mask; only its white area may change.
      Keep everything outside the selected regions unchanged."
    `);
    expect(
      buildRegionEditPrompt({
        dna: withScene,
        regions,
        params: {
          regionIds: [regions[0]!.id],
          instruction: "",
          mode: "material_replace",
          material: "terrazzo",
        },
        nativeMask: true,
      }),
    ).toContain(
      "replace the surface material of Facade (South wall) with terrazzo; keep geometry, edges, openings, lighting direction",
    );
    expect(
      sceneObjectLines({
        ...withScene,
        locks: { ...withScene.locks, objectIds: ["OBJ_01J00000000000000000000001"] },
      }),
    ).toEqual([
      'Preserve pinned scene object "South wall" (wall): keep it exactly in place and unchanged.',
    ]);
    expect(COMPILER_VERSION).toBe("pc-1.3.0");
  });

  it("gates region edits like variations", () => {
    expect(
      isGenerationAllowed("region_edit", [], {
        masterApproved: true,
        anchorCameraIds: [],
        approvedAnchorCameraIds: [],
      }),
    ).toEqual({ ok: true });
    expect(
      isGenerationAllowed("region_edit", [], {
        masterApproved: false,
        anchorCameraIds: [],
        approvedAnchorCameraIds: [],
      }),
    ).toEqual({ ok: false, blockedBy: "generate.master" });
  });
});
