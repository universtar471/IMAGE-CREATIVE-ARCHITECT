import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ProjectDNASchema, compilePrompt, planDetailShots, type ProjectDNA } from "../src";
import { detailTargetSection } from "../src/prompt/sections/detailTarget";

const base = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

describe("architectural detail registry inputs", () => {
  it("parses the extended flat detail fields and the legacy shape", () => {
    const dna = base();
    dna.architecturalDetails = [
      {
        version: 1,
        id: "DTL_flat",
        spaceId: "SPC_living",
        facade: "front",
        floorId: "F2",
        verifiedLocation: { status: "verified", sourceAssetIds: ["AST_master"] },
        existence: true,
        materialIds: ["MAT_steel"],
        sourceAssetIds: ["AST_master"],
        locked: true,
      },
    ];
    expect(ProjectDNASchema.parse(dna).architecturalDetails?.[0]).toMatchObject({
      id: "DTL_flat",
      facade: "front",
      floorId: "F2",
    });
  });
});

describe("detail shot planner", () => {
  it("uses verified details, visible cameras and distinct angles", () => {
    const dna = base();
    dna.context.siteTopology = { left: "open", right: "open", cornerLot: false };
    dna.architecturalDetails = [1, 2, 3].map((index) => ({
      version: 1 as const,
      id: `DTL_${index}`,
      spaceId: "SPC_living",
      facade: "front" as const,
      floorId: "F2",
      verifiedLocation: true,
      existence: true,
      materialIds: index === 1 ? ["MAT_steel"] : [],
      locked: false,
    }));
    const plan = planDetailShots(dna, { count: 5, mode: "auto" });
    expect(plan.shots).toHaveLength(5);
    expect(plan.shortfall).toBe(0);
    for (const detailId of ["DTL_1", "DTL_2", "DTL_3"]) {
      const cameras = plan.shots
        .filter((shot) => shot.detailId === detailId)
        .map((shot) => shot.cameraSuggestion);
      expect(new Set(cameras).size).toBe(cameras.length);
    }
    expect(plan.shots.some((shot) => shot.shotType === "material_closeup")).toBe(true);
  });

  it("reports a shortfall instead of inventing a camera", () => {
    const dna = base();
    dna.architecturalDetails = [
      {
        version: 1,
        id: "DTL_rear",
        spaceId: "SPC_living",
        facade: "rear",
        floorId: "F2",
        verifiedLocation: true,
        existence: true,
        materialIds: [],
        locked: false,
      },
    ];
    const plan = planDetailShots(dna, { count: 2, mode: "auto" });
    expect(plan.shots).toEqual([]);
    expect(plan.shortfall).toBe(2);
    expect(plan.warnings).toContain("NO_VISIBLE_CAMERA:DTL_rear");
  });

  it("does not fall back to auto selection when manual selection is empty", () => {
    const dna = base();
    dna.architecturalDetails = [
      {
        version: 1,
        id: "DTL_front",
        spaceId: "SPC_living",
        facade: "front",
        verifiedLocation: true,
        existence: true,
        materialIds: [],
        locked: false,
      },
    ];
    const plan = planDetailShots(dna, { count: 1, mode: "manual", detailIds: [] });
    expect(plan.shots).toEqual([]);
    expect(plan.warnings).toEqual(["NO_SELECTED_DETAILS"]);
  });
});

describe("detail target prompt", () => {
  it("emits the SRS detail target section only for a selected detail", () => {
    const dna = base();
    dna.architecturalDetails = [
      {
        version: 1,
        id: "DTL_balcony",
        spaceId: "SPC_living",
        name: "balcony",
        facade: "front",
        floorId: "F2",
        verifiedLocation: true,
        existence: true,
        materialIds: ["MAT_steel"],
        locked: true,
      },
    ];
    expect(detailTargetSection(dna, undefined, "townhouse")).toBeNull();
    const section = detailTargetSection(dna, "DTL_balcony", "townhouse");
    expect(section).toContain("DETAIL TARGET:");
    expect(section).toContain("F2");
    expect(section).toContain("FRONT");
    expect(section).toContain("approved materials");

    const withoutTarget = compilePrompt({
      project: { id: "PRJ_1", name: "House", projectType: "townhouse" },
      dna,
      references: [],
    });
    const withTarget = compilePrompt({
      project: { id: "PRJ_1", name: "House", projectType: "townhouse" },
      dna,
      references: [],
      shotIntent: { projectType: "townhouse", cameraId: null, targetDetailId: "DTL_balcony" },
    });
    expect(withTarget.metadata.sections).toContain("detailTarget");
    expect(withoutTarget.metadata.sections).not.toContain("detailTarget");
  });
});
