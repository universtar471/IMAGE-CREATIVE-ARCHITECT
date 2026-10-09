import { describe, expect, it } from "vitest";
import {
  BatchItemSchema,
  BatchReferenceLimitError,
  buildAnchorBatchItems,
  buildProductionBatchItems,
  compilePrompt,
  createInitialDNA,
  paramsForCamera,
  type BatchAsset,
  type BatchBuildInput,
  type CameraDNA,
  type GenerationParams,
  type ModelCapabilities,
} from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();
const pack = registry.resolve("villa").pack;

const camId = (n: number) => `CAM_01J${String(n).padStart(23, "0")}`;
const cam = (n: number, over: Partial<CameraDNA> = {}): CameraDNA => ({
  schemaVersion: 1,
  id: camId(n),
  name: `Cam ${n}`,
  viewType: "exterior_corner",
  isAnchorView: false,
  azimuthDeg: 45,
  notes: "",
  ...over,
});

const model = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
  id: "m",
  label: "Model",
  textToImage: true,
  imageToImage: true,
  maxReferenceImages: 4,
  maxOutputs: 4,
  aspectRatios: ["1:1", "3:2", "16:9"],
  imageSizes: ["1K"],
  supportsNegativePrompt: true,
  supportsSeed: true,
  qualityOptions: [],
  priceHint: null,
  ...over,
});

const params: GenerationParams = {
  aspectRatio: "1:1",
  imageSize: "1K",
  outputCount: 2,
  seed: null,
  quality: null,
};

const assets: BatchAsset[] = [
  { id: "AST_M", role: "master_architecture", status: "ready", originalName: "hero.png" },
  { id: "AST_A1", role: "regular_image", status: "ready", originalName: "anchor-1.png" },
  { id: "AST_A3", role: "regular_image", status: "ready", originalName: null },
  { id: "AST_MAT", role: "material_reference", status: "ready", originalName: "stone.jpg" },
  { id: "AST_ARCH", role: "architecture_reference", status: "ready", originalName: null },
  { id: "AST_MOOD", role: "mood_reference", status: "ready", originalName: null },
];

function input(over: Partial<BatchBuildInput> = {}): BatchBuildInput {
  const dna = createInitialDNA({ projectType: "villa", pack });
  dna.cameras = [
    cam(1, { name: "Corner", isAnchorView: true, aspectRatio: "3:2" }),
    cam(2, { name: "Garden", aspectRatio: "4:5" }),
    cam(3, { name: "Aerial", viewType: "aerial", isAnchorView: true, aspectRatio: "16:9" }),
  ];
  return {
    project: { id: "PRJ_1", name: "Villa", projectType: "villa", subtype: null },
    dna,
    pack,
    assets,
    masterAssetId: "AST_M",
    model: model(),
    params,
    ...over,
  };
}

const anchors = [
  { cameraId: camId(1), assetId: "AST_A1" },
  { cameraId: camId(3), assetId: "AST_A3" },
];

describe("anchor batch", () => {
  it("makes one item per anchor view with the master as reference", () => {
    const items = buildAnchorBatchItems(input());
    expect(items.map((i) => [i.cameraId, i.label, i.referenceAssetIds])).toEqual([
      [camId(1), "Corner — anchor", ["AST_M"]],
      [camId(3), "Aerial — anchor", ["AST_M"]],
    ]);
    for (const item of items) expect(BatchItemSchema.parse(item)).toEqual(item);
  });

  it("compiles each item for its camera", () => {
    const i = input();
    const [first] = buildAnchorBatchItems(i);
    expect(first!.prompt).toEqual(
      compilePrompt({
        project: i.project,
        dna: i.dna,
        pack: i.pack,
        references: [{ assetId: "AST_M", role: "master_architecture", label: "hero.png" }],
        cameraId: camId(1),
      }),
    );
    expect(first!.prompt.metadata.cameraId).toBe(camId(1));
    expect(first!.prompt.positivePrompt).toMatch(/Camera: exterior corner view/);
    expect(first!.prompt.referenceInstructions).toMatch(/^Image 1 \(hero\.png\) is the MASTER/);
  });

  it("uses the camera's aspect ratio when the model offers it", () => {
    const items = buildAnchorBatchItems(input());
    expect(items.map((i) => i.params.aspectRatio)).toEqual(["3:2", "16:9"]);
    expect(items[0]!.params).toMatchObject({ imageSize: "1K", outputCount: 2 });
    const noRatios = buildAnchorBatchItems(input({ model: model({ aspectRatios: [] }) }));
    expect(noRatios.map((i) => i.params.aspectRatio)).toEqual(["1:1", "1:1"]);
  });

  it("sends no references without a master or image-to-image", () => {
    expect(
      buildAnchorBatchItems(input({ masterAssetId: null })).map((i) => i.referenceAssetIds),
    ).toEqual([[], []]);
    expect(
      buildAnchorBatchItems(input({ model: model({ imageToImage: false }) })).map(
        (i) => i.referenceAssetIds,
      ),
    ).toEqual([[], []]);
  });

  it("is empty without anchor views", () => {
    const i = input();
    i.dna.cameras = i.dna.cameras.map((c) => ({ ...c, isAnchorView: false }));
    expect(buildAnchorBatchItems(i)).toEqual([]);
  });
});

describe("production batch", () => {
  const extras = ["AST_MOOD", "AST_MAT", "AST_ARCH"];

  it("orders master, the camera's anchor, then extras in compiler order", () => {
    const items = buildProductionBatchItems(
      input({ extraReferenceIds: extras }),
      [camId(3), camId(1), camId(2)],
      anchors,
    );
    expect(items.map((i) => [i.label, i.referenceAssetIds])).toEqual([
      ["Corner — production", ["AST_M", "AST_A1", "AST_ARCH", "AST_MAT"]],
      ["Garden — production", ["AST_M", "AST_ARCH", "AST_MAT", "AST_MOOD"]],
      ["Aerial — production", ["AST_M", "AST_A3", "AST_ARCH", "AST_MAT"]],
    ]);
    const lines = items[0]!.prompt.referenceInstructions.split("\n");
    expect(lines[0]).toMatch(/^Image 1 \(hero\.png\) is the MASTER/);
    expect(lines[1]).toMatch(/^Image 2 \(anchor-1\.png\) is the APPROVED ANCHOR/);
    expect(items[0]!.prompt.metadata.anchorImage).toBe(2);
    expect(items[1]!.prompt.metadata.anchorImage).toBeNull();
    // Garden's 4:5 is not offered → the dialog's ratio stays.
    expect(items.map((i) => i.params.aspectRatio)).toEqual(["3:2", "1:1", "16:9"]);
  });

  it("never drops master or anchor when capping", () => {
    const two = buildProductionBatchItems(
      input({ extraReferenceIds: extras, model: model({ maxReferenceImages: 2 }) }),
      [camId(1), camId(2)],
      anchors,
    );
    expect(two.map((i) => i.referenceAssetIds)).toEqual([
      ["AST_M", "AST_A1"],
      ["AST_M", "AST_ARCH"],
    ]);
    // A camera without an anchor only needs the master; extras are trimmed to fit.
    const one = buildProductionBatchItems(
      input({ extraReferenceIds: extras, model: model({ maxReferenceImages: 1 }) }),
      [camId(2)],
      anchors,
    );
    expect(one[0]!.referenceAssetIds).toEqual(["AST_M"]);
  });

  it("fails instead of dropping the anchor when the model takes too few references", () => {
    const build = (m: ModelCapabilities) =>
      buildProductionBatchItems(input({ model: m }), [camId(2), camId(1)], anchors);
    expect(() => build(model({ maxReferenceImages: 1 }))).toThrow(BatchReferenceLimitError);
    try {
      build(model({ maxReferenceImages: 1 }));
    } catch (err) {
      expect(err).toBeInstanceOf(BatchReferenceLimitError);
      const e = err as BatchReferenceLimitError;
      expect(e.cameraId).toBe(camId(1));
      expect(e.required).toBe(2);
      expect(e.max).toBe(1);
      expect(e.message).toMatch(/Corner.*master and its approved anchor.*at most 1.*another model/);
    }
    // A model without image-to-image cannot carry the master either.
    expect(() => build(model({ imageToImage: false }))).toThrow(/does not accept reference/);
  });

  it("skips unknown cameras, unknown or duplicate extras and a second master", () => {
    const items = buildProductionBatchItems(
      input({
        extraReferenceIds: ["AST_MAT", "AST_MAT", "ghost", "AST_M", "AST_A1", "AST_OLD_MASTER"],
        assets: [...assets, { id: "AST_OLD_MASTER", role: "master_architecture", status: "ready" }],
      }),
      [camId(1), "CAM_UNKNOWN"],
      anchors,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.referenceAssetIds).toEqual(["AST_M", "AST_A1", "AST_MAT"]);
  });

  it("an extra that is another camera's anchor is a plain reference", () => {
    const [item] = buildProductionBatchItems(
      input({ extraReferenceIds: ["AST_A3"] }),
      [camId(1)],
      anchors,
    );
    expect(item!.referenceAssetIds).toEqual(["AST_M", "AST_A1", "AST_A3"]);
    expect(item!.prompt.referenceInstructions.split("\n")[2]).toMatch(/is a general image/);
  });

  it("ignores an anchor whose asset is unknown or is the master", () => {
    const items = buildProductionBatchItems(
      input(),
      [camId(1), camId(3)],
      [
        { cameraId: camId(1), assetId: "ghost" },
        { cameraId: camId(3), assetId: "AST_M" },
      ],
    );
    expect(items.map((i) => i.referenceAssetIds)).toEqual([["AST_M"], ["AST_M"]]);
  });

  it("is deterministic regardless of input order", () => {
    const a = buildProductionBatchItems(
      input({ extraReferenceIds: extras }),
      [camId(1), camId(3)],
      anchors,
    );
    const b = buildProductionBatchItems(
      input({ extraReferenceIds: [...extras].reverse(), assets: [...assets].reverse() }),
      [camId(3), camId(1)],
      [...anchors].reverse(),
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("paramsForCamera", () => {
  it("overrides only with an offered ratio and never mutates", () => {
    const p = { ...params };
    expect(paramsForCamera(p, { aspectRatio: "16:9" }, model()).aspectRatio).toBe("16:9");
    expect(paramsForCamera(p, { aspectRatio: "9:21" }, model()).aspectRatio).toBe("1:1");
    expect(paramsForCamera(p, {}, model()).aspectRatio).toBe("1:1");
    expect(p).toEqual(params);
  });
});
