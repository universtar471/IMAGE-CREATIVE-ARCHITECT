import { describe, expect, it } from "vitest";
import {
  blankCamera,
  compilePrompt,
  defaultInteriorDNA,
  createInitialDNA,
  InteriorGenerationSchema,
  initialInteriorGeneration,
  composeInteriorGeneration,
  setGenerationPreserve,
} from "../src";

function fixture() {
  const camera = {
    ...blankCamera([]),
    viewType: "interior_wide" as const,
    azimuthDeg: 37.5,
    elevationDeg: 12,
    distanceM: 4.5,
    lensMm: 35,
  };
  const state = {
    ...initialInteriorGeneration(),
    goal: "redesign" as const,
    preserve: { ...initialInteriorGeneration().preserve, camera: false },
    camera: { mode: "studio" as const, cameraId: camera.id },
  };
  const dna = {
    ...createInitialDNA({ projectType: "interior", pack: null }),
    interior: defaultInteriorDNA(),
    cameras: [camera],
  };
  return { camera, state, dna };
}
describe("linked Camera DNA for interior generation", () => {
  it("keeps legacy state valid and validates stable links", () => {
    expect(InteriorGenerationSchema.parse(initialInteriorGeneration()).camera).toEqual({
      mode: "original",
    });
    expect(
      InteriorGenerationSchema.safeParse({
        ...initialInteriorGeneration(),
        camera: { mode: "studio" },
      }).success,
    ).toBe(false);
    expect(
      InteriorGenerationSchema.safeParse({
        ...initialInteriorGeneration(),
        camera: { mode: "original", cameraId: blankCamera([]).id },
      }).success,
    ).toBe(false);
  });
  it("uses exact room-local pose without retaining the source camera lock", () => {
    const { state, camera } = fixture();
    const result = composeInteriorGeneration(state, [], "", camera);
    expect(result.positivePrompt).toContain("room-local azimuth 37.5 degrees");
    expect(result.positivePrompt).toContain("elevation 12 degrees");
    expect(result.positivePrompt).toContain("distance 4.5 m");
    expect(result.positivePrompt).toContain("35 mm lens");
    expect(result.preservationInstructions).not.toContain("viewpoint");
    expect(result.positivePrompt).not.toContain("front facade");
  });
  it("refuses missing/deleted links and refuses camera changes under effective hard locks", () => {
    const { state } = fixture();
    expect(() => composeInteriorGeneration(state, [])).toThrow(/camera is missing/);
    expect(() =>
      composeInteriorGeneration({ ...state, preserve: { ...state.preserve, camera: true } }, []),
    ).toThrow(/preservation conflicts/);
    expect(() => composeInteriorGeneration({ ...state, changeLevel: 0 }, [])).toThrow(
      /preservation conflicts/,
    );
    expect(setGenerationPreserve(state, "camera", true).camera).toEqual({ mode: "original" });
  });
  it("hashes pose changes and preserves immutable prompt camera snapshots", () => {
    const { state, dna } = fixture();
    const input = {
      project: { id: "PRJ_SYNC", name: "Sync", projectType: "interior" as const },
      dna,
      references: [],
      shotIntent: { projectType: "interior" as const, interiorGeneration: state },
    };
    const first = compilePrompt(input);
    dna.cameras[0]!.azimuthDeg = 62;
    const second = compilePrompt(input);
    expect(first.metadata.interiorCameraSnapshot).toMatchObject({ azimuthDeg: 37.5 });
    expect(first.positivePrompt).toContain("37.5 degrees");
    expect(second.positivePrompt).toContain("62 degrees");
    expect(first.sourceHash).not.toBe(second.sourceHash);
  });
});
