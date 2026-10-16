import { describe, expect, it } from "vitest";
import { createInitialDNA } from "../src/knowledge/defaults";
import { layoutDiagramSheet, planDiagram, type DiagramStep } from "../src/diagram";

const starter = {
  projectType: "townhouse" as const,
  subtype: null,
  pack: null,
};

describe("diagram studio domain", () => {
  it("does not claim interior functions are verified from one facade render", () => {
    const dna = createInitialDNA(starter);
    const plan = planDiagram(dna, "functional_zoning", 6);

    expect(plan.steps.some((step) => step.evidence === "verified" && /phòng|bếp|living|kitchen/i.test(step.title.vi))).toBe(
      false,
    );
  });

  it("keeps fixed frame geometry and includes the illustrative label for six steps", () => {
    const dna = createInitialDNA(starter);
    const steps = planDiagram(dna, "concept_evolution", 6).steps;
    const svg = layoutDiagramSheet(steps, "2x3", "vi");

    expect([...svg.matchAll(/data-frame="(\d+)" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)]).toHaveLength(6);
    expect(new Set([...svg.matchAll(/data-frame="\d+" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g)].map((match) => `${match[3]}:${match[4]}`))).toEqual(
      new Set(["300:190"]),
    );
    expect(svg).toContain("sơ đồ diễn giải ý tưởng");
  });

  it("uses different step language for townhouses and villas", () => {
    const townhouse = planDiagram(createInitialDNA(starter), "concept_evolution", 6);
    const villa = planDiagram(
      createInitialDNA({ ...starter, projectType: "villa" }),
      "concept_evolution",
      6,
    );

    expect(townhouse.steps.map((step) => step.title.en)).not.toEqual(villa.steps.map((step) => step.title.en));
  });

  it("renders the same SVG bytes for the same steps", () => {
    const steps: DiagramStep[] = planDiagram(createInitialDNA(starter), "massing_voids", 4).steps;

    expect(layoutDiagramSheet(steps, "2x2", "en")).toBe(layoutDiagramSheet(steps, "2x2", "en"));
  });
});
