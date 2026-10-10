import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  compilePrompt,
  createInitialDNA,
  sortReferences,
  type CameraDNA,
  type PromptCompileInput,
  type PromptReference,
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

  it("orders and instructs a structure sketch immediately after the master", () => {
    const bundle = compilePrompt(
      input("villa", {
        references: [
          { assetId: "R", role: "architecture_reference" },
          { assetId: "S", role: "structure_sketch" },
          { assetId: "M", role: "master_architecture" },
        ],
      }),
    );
    const lines = bundle.referenceInstructions.split("\n");
    expect(lines[1]).toBe(
      "Image 2 is the STRUCTURE source (sketch, massing model or 3D view): keep its building geometry, camera viewpoint, proportions, floor count, openings and roof form exactly; render it as a finished photorealistic building with the materials, lighting and context described below; do not add or remove building parts.",
    );
    expect(lines[0]).toMatch(/^Image 1 is the MASTER/);
    expect(lines[2]).toMatch(/^Image 3 is an architecture reference/);
    expect(bundle.preservationInstructions).toContain(
      "Follow the geometry and viewpoint of Image 2 (structure sketch) exactly; replace sketch lines, flat colours and model textures with real materials.",
    );
    expect(bundle.preservationInstructions).toContain(
      "Preserve the architecture of Image 1 (master)",
    );
  });

  it("preserves a structure sketch when no master is present", () => {
    const bundle = compilePrompt(
      input("villa", { references: [{ assetId: "S", role: "structure_sketch" }] }),
    );
    expect(bundle.preservationInstructions).toContain("No master architecture image is set");
    expect(bundle.preservationInstructions).toContain(
      "Follow the geometry and viewpoint of Image 1 (structure sketch) exactly",
    );
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

  it("with a master, floor count and materials follow the master image, not the DNA text", () => {
    const i = input("villa");
    i.dna.building.floors = 2;
    i.dna.building.materials = [{ zone: "walls", description: "white render" }];
    i.references = [{ assetId: "M", role: "master_architecture" }];
    const bundle = compilePrompt(i);
    expect(bundle.preservationInstructions).not.toMatch(/Keep exactly 2 floors/);
    expect(bundle.preservationInstructions).not.toMatch(/Do not substitute/);
    expect(bundle.preservationInstructions).toMatch(
      /Keep the floor count shown in Image 1 \(master\)/,
    );
    expect(bundle.preservationInstructions).toMatch(
      /Keep the facade materials visible in Image 1 \(master\)/,
    );
    expect(bundle.referenceInstructions).toMatch(/differs from this image, follow this image/);
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
      knowledgePack: "interior/default@1.2.0",
      referenceCount: 0,
    });
  });
});

describe("camera section (pc-1.1.0)", () => {
  const corner: CameraDNA = {
    schemaVersion: 1,
    id: "CAM_01J00000000000000000000001",
    name: "Front-left corner",
    viewType: "exterior_corner",
    isAnchorView: true,
    azimuthDeg: 45,
    elevationDeg: 0,
    heightM: 1.6,
    distanceM: 25,
    lensMm: 24,
    composition: "two-point perspective",
    notes: "keep the gate in frame",
  };

  const withCamera = (over: Partial<PromptCompileInput> = {}) => {
    const i = input("villa", over);
    i.dna.cameras = [corner];
    return i;
  };

  it("adds a camera section right after context", () => {
    const bundle = compilePrompt({ ...withCamera(), cameraId: corner.id });
    const sections = bundle.metadata.sections as string[];
    expect(sections.indexOf("camera")).toBe(sections.indexOf("context") + 1);
    const paragraphs = bundle.positivePrompt.split("\n\n");
    expect(paragraphs[sections.indexOf("camera")]).toBe(
      "Camera: exterior corner view; viewpoint: front-left three-quarter view from eye level; lens: 24 mm wide-angle lens; distance: about 25 m from the building; composition: two-point perspective; camera notes: keep the gate in frame.",
    );
    expect(bundle.metadata.cameraId).toBe(corner.id);
  });

  it("omits the section without a camera or for an unknown camera", () => {
    for (const cameraId of [undefined, null, "CAM_01J00000000000000000000099"]) {
      const bundle = compilePrompt({ ...withCamera(), cameraId });
      expect(bundle.metadata.sections).not.toContain("camera");
      expect(bundle.metadata.cameraId).toBeNull();
      expect(bundle.positivePrompt).not.toMatch(/^Camera:/m);
    }
  });

  it("puts the camera section after the subject when there is no context", () => {
    const bundle = compilePrompt({
      project: { id: "PRJ_X", name: "Bare", projectType: "custom" },
      dna: { ...createInitialDNA({ projectType: "custom", pack: null }), cameras: [corner] },
      references: [],
      cameraId: corner.id,
    });
    expect(bundle.metadata.sections).toEqual(["subject", "camera", "quality"]);
  });

  it("states a camera lock only when a camera is rendered", () => {
    const i = withCamera();
    i.dna.locks.camera = true;
    expect(compilePrompt({ ...i, cameraId: corner.id }).preservationInstructions).toMatch(
      /Camera DNA is LOCKED/,
    );
    expect(compilePrompt(i).preservationInstructions).not.toMatch(/Camera DNA/);
  });

  it("describes aerial and interior cameras", () => {
    const aerial: CameraDNA = {
      ...corner,
      id: "CAM_01J00000000000000000000002",
      viewType: "aerial",
      azimuthDeg: -35,
      elevationDeg: 32,
      lensMm: 35,
      composition: undefined,
      notes: "",
    };
    const i = input("villa");
    i.dna.cameras = [aerial];
    expect(compilePrompt({ ...i, cameraId: aerial.id }).positivePrompt).toMatch(
      /Camera: aerial view; viewpoint: front-right three-quarter view from an aerial viewpoint, about 32° down; lens: 35 mm natural standard lens; distance: about 25 m from the building\./,
    );

    const room: CameraDNA = {
      schemaVersion: 1,
      id: "CAM_01J00000000000000000000003",
      name: "Wide",
      viewType: "interior_wide",
      isAnchorView: false,
      azimuthDeg: 90,
      heightM: 1.5,
      lensMm: 16,
      notes: "",
    };
    const ii = input("interior");
    ii.dna.cameras = [room];
    expect(compilePrompt({ ...ii, cameraId: room.id }).positivePrompt).toMatch(
      /Camera: wide interior view; viewpoint: view from eye level; lens: 16 mm ultra-wide-angle lens\./,
    );
  });

  it("is deterministic and independent of camera list order", () => {
    const other = { ...corner, id: "CAM_01J00000000000000000000004", name: "Other" };
    const a = withCamera();
    a.dna.cameras = [corner, other];
    const b = structuredClone(a);
    b.dna.cameras = [other, corner];
    expect(compilePrompt({ ...a, cameraId: corner.id })).toEqual(
      compilePrompt({ ...b, cameraId: corner.id }),
    );
  });
});

describe("anchor references (pc-1.1.0)", () => {
  const refs: PromptReference[] = [
    { assetId: "AST_9", role: "material_reference" },
    { assetId: "AST_1", role: "regular_image", label: "anchor.png", isAnchor: true },
    { assetId: "AST_5", role: "architecture_reference" },
    { assetId: "AST_7", role: "master_architecture", label: "hero.png" },
  ];

  it("numbers the anchor right after the master with its own instruction", () => {
    const bundle = compilePrompt(input("villa", { references: refs }));
    const lines = bundle.referenceInstructions.split("\n");
    expect(lines[0]).toMatch(/^Image 1 \(hero\.png\) is the MASTER/);
    expect(lines[1]).toMatch(/^Image 2 \(anchor\.png\) is the APPROVED ANCHOR view/);
    expect(lines[1]).toMatch(/master stays authoritative for the architecture/);
    expect(lines[2]).toMatch(/^Image 3 is an architecture reference/);
    expect(lines[3]).toMatch(/^Image 4 is a material reference/);
    expect(bundle.preservationInstructions).toMatch(/Preserve the architecture of Image 1/);
    expect(bundle.preservationInstructions).toMatch(/composition of Image 2 \(anchor view\)/);
    expect(bundle.metadata.anchorImage).toBe(2);
    expect(sortReferences(refs).map((r) => r.assetId)).toEqual([
      "AST_7",
      "AST_1",
      "AST_5",
      "AST_9",
    ]);
  });

  it("is independent of reference order with an anchor", () => {
    const a = compilePrompt(input("villa", { references: refs }));
    const b = compilePrompt(input("villa", { references: [...refs].reverse() }));
    expect(a).toEqual(b);
  });

  it("without a master the anchor comes first; a master flagged as anchor stays the master", () => {
    const noMaster = compilePrompt(
      input("villa", { references: refs.filter((r) => r.role !== "master_architecture") }),
    );
    expect(noMaster.referenceInstructions.split("\n")[0]).toMatch(/^Image 1 .*APPROVED ANCHOR/);

    const both = compilePrompt(
      input("villa", {
        references: [{ assetId: "AST_7", role: "master_architecture", isAnchor: true }],
      }),
    );
    expect(both.referenceInstructions).toMatch(/is the MASTER/);
    expect(both.referenceInstructions).not.toMatch(/ANCHOR/);
    expect(both.metadata.anchorImage).toBeNull();
  });
});
