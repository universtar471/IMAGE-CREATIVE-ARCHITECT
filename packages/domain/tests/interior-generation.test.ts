import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankCamera, compilePrompt, defaultInteriorDNA, ProjectDNASchema } from "../src";
import {
  InteriorGenerationSchema,
  initialInteriorGeneration,
  selectGenerationGoal,
  selectChangeLevel,
  resolveGenerationConflicts,
  keepGenerationLock,
  composeInteriorGeneration,
  GENERATION_GOALS,
  GENERATION_ROOMS,
} from "../src/generationPresets";

describe("structured interior generation", () => {
  it("does not confuse Vietnamese night/natural lighting or wall colour with furniture or structural changes", () => {
    const state = {
      ...initialInteriorGeneration({ assetId: "source", type: "photo" }),
      preserve: {
        layout: true,
        camera: true,
        architecture: true,
        furniture: true,
        materials: false,
      },
    };
    for (const instruction of [
      "Đổi ánh sáng ban đêm",
      "Thêm ánh sáng tự nhiên",
      "Đổi màu tường thành trắng",
      "Change the wall color to white",
    ])
      expect(resolveGenerationConflicts({ ...state, instruction })).toEqual([]);
  });
  it("treats reference colours as a material-lock conflict and clears the actual permission on Keep lock", () => {
    const state = initialInteriorGeneration({ assetId: "source", type: "photo" });
    state.reference = {
      assetId: "ref",
      attributes: { style: false, colors: true, materials: false, layout: false, lighting: false },
    };
    const conflict = resolveGenerationConflicts(state).find((item) => item.lock === "materials");
    expect(conflict).toBeDefined();
    expect(keepGenerationLock(state, conflict!).reference?.attributes.colors).toBe(false);
  });
  const dna = {
    ...ProjectDNASchema.parse(
      JSON.parse(
        readFileSync(
          new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
          "utf8",
        ),
      ),
    ),
    interior: defaultInteriorDNA(),
  };
  it("numbers the source first even when the selected reference has a master asset role", () => {
    const state = initialInteriorGeneration({ assetId: "source", type: "photo" });
    state.reference = {
      assetId: "ref",
      attributes: { style: true, colors: false, materials: false, layout: false, lighting: false },
    };
    const result = compilePrompt({
      project: { id: "P", name: "P", projectType: "interior" },
      dna,
      references: [
        { assetId: "source", role: "regular_image" },
        { assetId: "ref", role: "master_architecture" },
      ],
      shotIntent: {
        projectType: "interior",
        interiorGeneration: state,
        presetIds: ["camera.aerial"],
      },
    });
    expect(result.referenceInstructions).toContain("Image 1 is the authoritative source");
    expect(result.referenceInstructions).toContain("Image 2 is a selective reference");
    expect(result.shotIntent?.presetIds).toBeUndefined();
  });
  it("keeps the saved Camera Director path unchanged when an explicit camera is requested", () => {
    const camera = {
      ...blankCamera([], "CAM_00000000000000000000000000"),
      composition: "Director room framing",
    };
    const result = compilePrompt({
      project: { id: "P", name: "P", projectType: "interior" },
      dna: { ...dna, cameras: [camera] },
      cameraId: camera.id,
      references: [],
      shotIntent: { projectType: "interior", interiorGeneration: initialInteriorGeneration() },
    });
    expect(result.metadata.interiorComposerVersion).toBeUndefined();
    expect(result.positivePrompt).toContain("Director room framing");
  });
  it("defaults source-image work to original camera and preserves the design", () => {
    const state = initialInteriorGeneration({ assetId: "source", type: "render" });
    expect(state.camera.mode).toBe("original");
    expect(state.preserve).toEqual({
      architecture: true,
      layout: true,
      camera: true,
      furniture: true,
      materials: true,
    });
    expect(InteriorGenerationSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });
  it("uses config-backed goals and functional room context without furniture lists", () => {
    expect(GENERATION_GOALS).toHaveLength(6);
    expect(GENERATION_ROOMS).toHaveLength(9);
    for (const preset of [...GENERATION_GOALS, ...GENERATION_ROOMS]) {
      expect(preset.icon).toMatch(/^icon-/);
      expect(preset.promptFragment).not.toBe("");
      expect(preset).toHaveProperty("constraints");
      expect(preset).toHaveProperty("defaults");
      expect(preset).toHaveProperty("conflicts");
    }
  });
  it("sets redesign defaults through transitions and keeps user input", () => {
    const state = { ...initialInteriorGeneration(), instruction: "My existing request" };
    const next = selectGenerationGoal(state, "redesign");
    expect(next.changeLevel).toBe(2);
    expect(next.preserve).toMatchObject({
      architecture: true,
      camera: true,
      furniture: false,
      materials: false,
    });
    expect(next.instruction).toBe(state.instruction);
    expect(selectChangeLevel(next, 0).preserve).toEqual({
      architecture: true,
      layout: true,
      camera: true,
      furniture: true,
      materials: true,
    });
  });
  it("does not silently send a sofa replacement against a furniture lock", () => {
    const state = {
      ...initialInteriorGeneration({ assetId: "source", type: "photo" }),
      instruction: "Đổi sofa thành sofa da nâu.",
    };
    const conflicts = resolveGenerationConflicts(state);
    expect(conflicts.some((c) => c.lock === "furniture")).toBe(true);
    expect(() =>
      composeInteriorGeneration(state, [{ assetId: "source", role: "regular_image" }]),
    ).toThrow();
    const kept = keepGenerationLock(
      state,
      conflicts.find((c) => c.lock === "furniture")!,
    );
    expect(kept.preserve.furniture).toBe(true);
    expect(kept.instruction).not.toContain("Đổi sofa");
    const unlocked = {
      ...state,
      preserve: { ...state.preserve, furniture: false, materials: false },
    };
    expect(resolveGenerationConflicts(unlocked)).toEqual([]);
  });
  it("does not treat a negated request as a lock conflict", () => {
    const state = {
      ...initialInteriorGeneration(),
      instruction: "Không đổi sofa. Do not move the camera.",
    };
    expect(resolveGenerationConflicts(state)).toEqual([]);
  });
  it("keeps hard locks above style and protects the original camera in every dimension", () => {
    const state = {
      ...initialInteriorGeneration({ assetId: "source", type: "render" }),
      style: "japandi" as const,
    };
    const prompt = composeInteriorGeneration(state, [
      { assetId: "source", role: "structure_sketch" },
    ]);
    expect(prompt.preservationInstructions).toMatch(
      /viewpoint.*perspective.*camera height.*viewing direction.*horizon.*framing/,
    );
    expect(prompt.preservationInstructions).toContain("materials");
    expect(prompt.positivePrompt).not.toContain("warm beige");
    expect(prompt.positivePrompt).not.toContain("add a sofa");
    expect(prompt.referenceInstructions).not.toContain("loose inspiration");
    expect(prompt.negativePrompt).toContain("floating furniture");
  });
  it("does not let a reference replace source architecture or violate locked layout", () => {
    const state = initialInteriorGeneration({ assetId: "source", type: "photo" });
    state.reference = {
      assetId: "ref",
      attributes: { style: true, colors: false, materials: false, layout: true, lighting: false },
    };
    expect(resolveGenerationConflicts(state).some((c) => c.lock === "layout")).toBe(true);
    state.reference.attributes.layout = false;
    const prompt = composeInteriorGeneration(state, [
      { assetId: "source", role: "regular_image" },
      { assetId: "ref", role: "architecture_reference" },
    ]);
    expect(prompt.referenceInstructions).toContain("Image 2");
    expect(prompt.referenceInstructions).toContain("Never copy architecture");
    expect(prompt.referenceInstructions).toContain("style only");
  });
});
