import { describe, expect, it } from "vitest";
import { createInitialDNA } from "../src/knowledge/defaults";
import type { ProjectDNA } from "../src/schemas/projectDna";
import {
  DIAGRAM_CONCEPT_PROMPT,
  DIAGRAM_ISOMETRIC_CAMERA,
  DIAGRAM_LAYOUTS,
  DIAGRAM_PANEL,
  DIAGRAM_TYPES,
  DiagramNotApprovedError,
  allDiagramStepsApproved,
  allowedDiagramEvidence,
  approveDiagramStep,
  buildDiagramFrameItems,
  diagramSheetGeometry,
  diagramVideoTimeline,
  editDiagramStep,
  layoutDiagramFrame,
  layoutDiagramSheet,
  planDiagram,
  setDiagramStepFrame,
  wrapDiagramText,
  type DiagramPlan,
} from "../src/diagram";

const starter = (projectType: "townhouse" | "villa" | "office") =>
  createInitialDNA({ projectType, subtype: null, pack: null });

/** A facade-only project: plenty of exterior facts, no space facts, no plan. */
function facadeDna(projectType: "townhouse" | "villa" = "townhouse"): ProjectDNA {
  const dna = structuredClone(starter(projectType));
  dna.building.floors = 4;
  dna.building.dimensions = { widthM: 5, depthM: 18, heightM: 15 };
  dna.building.massing = {
    composition: "stacked boxes with a front setback",
    mainVolume: "narrow tall box",
    voids: ["central light well"],
  };
  dna.building.roof = { type: "flat roof terrace" };
  dna.building.openings = { rhythm: "vertical slots", windowType: "full-height" };
  dna.building.materials = [{ zone: "facade", description: "white render" }];
  return dna;
}

const verified = { status: "verified" as const, sourceAssetIds: [] };

function withSpaceFacts(dna: ProjectDNA): ProjectDNA {
  return {
    ...dna,
    spaceCatalog: {
      version: 1,
      buildingArchetype: "townhouse",
      spaces: [
        {
          id: "SPC_LIVING",
          presetId: "townhouse.living",
          facts: { widthM: { value: 4.5, evidence: verified } },
          lockedElementIds: [],
          approvedOptionalIds: [],
        },
      ],
    },
  };
}

const frameAttrs = (svg: string) =>
  [
    ...svg.matchAll(
      /data-frame="(\d+)" data-frame-x="([^"]+)" data-frame-y="([^"]+)" data-frame-width="([^"]+)" data-frame-height="([^"]+)"/g,
    ),
  ].map((m) => ({ x: m[2], y: m[3], w: m[4], h: m[5] }));

describe("planDiagram — evidence (AC-14)", () => {
  it("never states interior functions as verified from a single facade render", () => {
    const dna = facadeDna();
    for (const type of DIAGRAM_TYPES) {
      for (const count of [4, 6, 8, 12]) {
        const plan = planDiagram(dna, type, count, { projectType: "townhouse" });
        expect(plan.interiorVerifiable).toBe(false);
        for (const step of plan.steps.filter((s) => s.interior))
          expect(step.evidence, `${type} ${step.id}`).not.toBe("verified");
      }
    }
    const zoning = planDiagram(dna, "functional_zoning", 8, { projectType: "townhouse" });
    expect(zoning.steps.filter((s) => s.interior).map((s) => s.evidence)).toEqual(
      Array(zoning.steps.filter((s) => s.interior).length).fill("illustrative"),
    );
  });

  it("a floor plan makes interior steps inferred, confirmed space facts make them verified", () => {
    const withPlan = planDiagram(facadeDna(), "functional_zoning", 6, {
      projectType: "townhouse",
      sources: { floorPlan: true },
    });
    for (const step of withPlan.steps.filter((s) => s.interior))
      expect(step.evidence).toBe("inferred");

    const withFacts = planDiagram(withSpaceFacts(facadeDna()), "functional_zoning", 6, {
      projectType: "townhouse",
    });
    expect(withFacts.interiorVerifiable).toBe(true);
    const interior = withFacts.steps.filter((s) => s.interior);
    expect(interior.every((s) => s.evidence === "verified")).toBe(true);
    expect(interior[0]!.basis).toContain("spaceCatalog.spaces.SPC_LIVING");
  });

  it("refuses a manual 'verified' on an interior step without space facts", () => {
    const plan = planDiagram(facadeDna(), "functional_zoning", 6, { projectType: "townhouse" });
    const interior = plan.steps.find((s) => s.interior)!;
    expect(allowedDiagramEvidence(plan, interior)).toEqual(["inferred", "illustrative"]);
    expect(() => editDiagramStep(plan, interior.id, { evidence: "verified" })).toThrow(RangeError);
    const exterior = plan.steps.find((s) => !s.interior)!;
    expect(allowedDiagramEvidence(plan, exterior)).toContain("verified");
  });

  it("marks steps verified only with their facts, and records the basis", () => {
    const empty = planDiagram(starter("townhouse"), "massing_voids", 8, {
      projectType: "townhouse",
    });
    expect(empty.steps.every((s) => s.evidence !== "verified")).toBe(true);
    const full = planDiagram(facadeDna(), "massing_voids", 8, { projectType: "townhouse" });
    const lightWell = full.steps.find((s) => s.id === "massing_voids.light_well")!;
    expect(lightWell.evidence).toBe("verified");
    expect(lightWell.basis).toEqual(["building.massing.voids"]);
    // Airflow is always an idea, whatever the DNA says.
    const sun = planDiagram(facadeDna(), "sun_ventilation", 8, { projectType: "townhouse" });
    expect(sun.steps.find((s) => s.id === "sun_ventilation.airflow")!.evidence).toBe(
      "illustrative",
    );
  });
});

describe("planDiagram — sequences", () => {
  it("gives townhouses and villas different sequences", () => {
    for (const type of ["concept_evolution", "massing_voids", "circulation"] as const) {
      const townhouse = planDiagram(facadeDna("townhouse"), type, 6, { projectType: "townhouse" });
      const villa = planDiagram(facadeDna("villa"), type, 6, { projectType: "villa" });
      expect(townhouse.family).toBe("townhouse");
      expect(villa.family).toBe("villa");
      expect(townhouse.steps.map((s) => s.title.en)).not.toEqual(
        villa.steps.map((s) => s.title.en),
      );
    }
    const townhouse = planDiagram(facadeDna(), "concept_evolution", 8, {
      projectType: "townhouse",
    });
    expect(townhouse.steps.map((s) => s.id)).toContain("concept_evolution.light_well");
    const villa = planDiagram(facadeDna("villa"), "concept_evolution", 8, { projectType: "villa" });
    expect(villa.steps.map((s) => s.id)).toEqual(
      expect.arrayContaining(["concept_evolution.split", "concept_evolution.garden"]),
    );
  });

  it("falls back to the building type text when the project type is not given", () => {
    expect(planDiagram(starter("villa"), "concept_evolution", 4).family).toBe("villa");
    expect(planDiagram(starter("office"), "concept_evolution", 4).family).toBe("generic");
  });

  it("keeps the first and last step for 4, 6, 8 and custom counts, with unique ids", () => {
    const full = planDiagram(facadeDna(), "concept_evolution", 8, { projectType: "townhouse" });
    for (const count of [2, 4, 6, 8, 10, 12]) {
      const plan = planDiagram(facadeDna(), "concept_evolution", count, {
        projectType: "townhouse",
      });
      expect(plan.steps).toHaveLength(count);
      expect(plan.steps[0]!.id).toBe(full.steps[0]!.id);
      expect(plan.steps.at(-1)!.id).toBe(full.steps.at(-1)!.id);
      expect(new Set(plan.steps.map((s) => s.id)).size).toBe(count);
      expect(plan.steps.map((s) => s.index)).toEqual([...Array(count).keys()]);
    }
    const twelve = planDiagram(facadeDna(), "concept_evolution", 12, { projectType: "townhouse" });
    expect(
      twelve.steps
        .filter((s) => s.id.includes("development"))
        .every((s) => s.evidence === "illustrative"),
    ).toBe(true);
    expect(() => planDiagram(facadeDna(), "concept_evolution", 1)).toThrow(RangeError);
    expect(() => planDiagram(facadeDna(), "concept_evolution", 13)).toThrow(RangeError);
    expect(() => planDiagram(facadeDna(), "concept_evolution", 4.5)).toThrow(RangeError);
  });
});

describe("layoutDiagramSheet (AC-15)", () => {
  it("6 steps keep the same frame size and position, and every label is present", () => {
    const plan = planDiagram(facadeDna(), "concept_evolution", 6, { projectType: "townhouse" });
    for (const layout of DIAGRAM_LAYOUTS) {
      const svg = layoutDiagramSheet(plan.steps, layout, "vi", { type: plan.type });
      const frames = frameAttrs(svg);
      expect(frames).toHaveLength(6);
      expect(new Set(frames.map((f) => `${f.x}:${f.y}:${f.w}:${f.h}`))).toEqual(
        new Set([`0:${DIAGRAM_PANEL.frame.y}:320:180`]),
      );
      const geometry = diagramSheetGeometry(layout, 6);
      expect(new Set(geometry.frames.map((f) => `${f.width}x${f.height}`))).toEqual(
        new Set(["320x180"]),
      );
      for (const step of plan.steps) expect(svg).toContain(step.title.vi.split(" ")[0]!);
    }
    const svg = layoutDiagramSheet(plan.steps, "2x3", "vi", { type: plan.type });
    expect(svg).toContain("Diễn tiến ý tưởng");
    const nonVerified = plan.steps.filter((s) => s.evidence !== "verified").length;
    const verifiedCount = plan.steps.length - nonVerified;
    expect(nonVerified).toBeGreaterThan(0);
    expect(verifiedCount).toBeGreaterThan(0);
    // One badge per step plus one per legend entry.
    expect(svg.match(/sơ đồ diễn giải ý tưởng/g)!.length).toBeGreaterThanOrEqual(nonVerified);
    expect(svg).toContain("đã xác minh");
    const en = layoutDiagramSheet(plan.steps, "2x3", "en", { type: plan.type });
    expect(en).toContain("illustrative concept diagram");
    expect(en).toContain("Concept evolution");
    expect(en).not.toContain("sơ đồ");
  });

  it("lays panels on a fixed grid: same column x and row y for every layout", () => {
    expect(diagramSheetGeometry("2x2", 6)).toMatchObject({ columns: 2, rows: 3 });
    expect(diagramSheetGeometry("2x3", 6)).toMatchObject({ columns: 3, rows: 2 });
    expect(diagramSheetGeometry("2x4", 8)).toMatchObject({ columns: 4, rows: 2 });
    expect(diagramSheetGeometry("linear", 6)).toMatchObject({ columns: 6, rows: 1 });
    const g = diagramSheetGeometry("2x3", 6);
    expect(g.frames[0]!.x).toBe(g.frames[3]!.x);
    expect(g.frames[0]!.y).toBe(g.frames[1]!.y);
    expect(g.frames[1]!.x - g.frames[0]!.x).toBe(g.frames[2]!.x - g.frames[1]!.x);
  });

  it("renders byte-identical SVG across runs", () => {
    const run = () => {
      const plan = planDiagram(facadeDna(), "massing_voids", 6, { projectType: "townhouse" });
      return layoutDiagramSheet(plan.steps, "2x3", "vi", {
        type: plan.type,
        title: "Nhà phố Q3",
        sourceHref: "data:image/png;base64,AAAA",
      });
    };
    const a = run();
    const b = run();
    expect(a).toBe(b);
    expect(a).not.toMatch(/NaN|undefined|Infinity/);
    expect(a.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });

  it("uses the source render without frames and the generated frame when attached", () => {
    let plan = planDiagram(facadeDna(), "massing_voids", 4, { projectType: "townhouse" });
    const noImage = layoutDiagramSheet(plan.steps, "2x2", "en");
    expect(noImage).not.toContain("<image");
    const source = layoutDiagramSheet(plan.steps, "2x2", "en", {
      sourceHref: "data:image/png;base64,SRC",
    });
    expect(source.match(/href="data:image\/png;base64,SRC"/g)).toHaveLength(4);
    plan = setDiagramStepFrame(plan, plan.steps[1]!.id, "AST_FRAME");
    const framed = layoutDiagramSheet(plan.steps, "2x2", "en", {
      sourceHref: "data:image/png;base64,SRC",
      frameHrefs: { AST_FRAME: "data:image/png;base64,FRAME" },
    });
    expect(framed.match(/base64,SRC/g)).toHaveLength(3);
    expect(framed.match(/base64,FRAME/g)).toHaveLength(1);
  });

  it("escapes user text and keeps it vector", () => {
    const plan = planDiagram(facadeDna(), "massing_voids", 4, { projectType: "townhouse" });
    const edited = editDiagramStep(plan, plan.steps[0]!.id, {
      title: { vi: `Khối <a> & "b"`, en: "Mass <a> & 'b'" },
    });
    const svg = layoutDiagramSheet(edited.steps, "2x2", "en");
    expect(svg).toContain("Mass &lt;a&gt; &amp; &apos;b&apos;");
    expect(svg).not.toContain("<a>");
  });

  it("wraps and truncates long text with an ellipsis", () => {
    expect(wrapDiagramText("một hai ba bốn năm sáu bảy tám", 8, 2)).toEqual(["một hai", "ba bốn…"]);
    expect(wrapDiagramText("short", 20, 2)).toEqual(["short"]);
  });

  it("builds a 16:9 video frame per step with the same badge rules", () => {
    const plan = planDiagram(facadeDna(), "sun_ventilation", 4, { projectType: "townhouse" });
    const idea = plan.steps.find((s) => s.evidence !== "verified")!;
    const frame = layoutDiagramFrame(idea, idea.index, 4, "vi");
    expect(frame).toContain('viewBox="0 0 1600 900"');
    expect(frame).toContain(`0${idea.index + 1}/04`);
    expect(frame).toContain("sơ đồ diễn giải ý tưởng");
    expect(layoutDiagramFrame(idea, idea.index, 4, "vi")).toBe(frame);
    const fact = plan.steps.find((s) => s.evidence === "verified")!;
    expect(layoutDiagramFrame(fact, fact.index, 4, "vi")).toContain("đã xác minh");
  });
});

describe("approval, frames and video timeline", () => {
  const approveAll = (plan: DiagramPlan) =>
    plan.steps.reduce((p, s) => approveDiagramStep(p, s.id), plan);

  it("needs every step approved; any edit clears that step's approval", () => {
    const plan = planDiagram(facadeDna(), "concept_evolution", 4, { projectType: "townhouse" });
    expect(() => diagramVideoTimeline(plan)).toThrow(DiagramNotApprovedError);
    const approved = approveAll(plan);
    expect(allDiagramStepsApproved(approved)).toBe(true);
    expect(diagramVideoTimeline(approved, 2500)).toEqual([
      { stepId: plan.steps[0]!.id, durationMs: 2500, motion: "appear" },
      { stepId: plan.steps[1]!.id, durationMs: 2500, motion: "zoom" },
      { stepId: plan.steps[2]!.id, durationMs: 2500, motion: "pan" },
      { stepId: plan.steps[3]!.id, durationMs: 2500, motion: "zoom" },
    ]);
    const edited = editDiagramStep(approved, plan.steps[2]!.id, {
      caption: { vi: "Chú thích mới", en: "New caption" },
    });
    expect(edited.steps[2]!.approved).toBe(false);
    expect(edited.steps[1]!.approved).toBe(true);
    // A no-op edit keeps the approval.
    const same = editDiagramStep(approved, plan.steps[0]!.id, { title: plan.steps[0]!.title });
    expect(same.steps[0]!.approved).toBe(true);
    const framed = setDiagramStepFrame(approved, plan.steps[0]!.id, "AST_X");
    expect(framed.steps[0]).toMatchObject({ frameAssetId: "AST_X", approved: false });
  });

  it("builds one frame item per step with the SRS §10.3 prompt and one fixed camera", () => {
    const dna = facadeDna();
    const plan = planDiagram(dna, "concept_evolution", 6, { projectType: "townhouse" });
    const params = {
      aspectRatio: "16:9",
      imageSize: "1K",
      outputCount: 1,
      seed: null,
      quality: null,
    };
    const items = buildDiagramFrameItems({
      project: { id: "PRJ_1", name: "Nhà phố", projectType: "townhouse" },
      dna,
      assets: [{ id: "AST_SRC", role: "master_architecture", originalName: "render.png" }],
      sourceAssetId: "AST_SRC",
      plan,
      model: { imageToImage: true, maxReferenceImages: 4 },
      params,
    });
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.cameraId).toBeNull();
      expect(item.referenceAssetIds).toEqual(["AST_SRC"]);
      expect(item.params).toEqual(params);
      expect(item.prompt.positivePrompt.startsWith(DIAGRAM_CONCEPT_PROMPT)).toBe(true);
      expect(item.prompt.positivePrompt).toContain(DIAGRAM_ISOMETRIC_CAMERA.prompt);
      expect(item.prompt.positivePrompt).toContain("no text");
    }
    const textOnly = buildDiagramFrameItems({
      project: { id: "PRJ_1", name: "Nhà phố", projectType: "townhouse" },
      dna,
      assets: [{ id: "AST_SRC", role: "master_architecture" }],
      sourceAssetId: "AST_SRC",
      plan: planDiagram(dna, "functional_zoning", 4, { projectType: "townhouse" }),
      model: { imageToImage: false, maxReferenceImages: 0 },
      params,
    });
    expect(textOnly[0]!.referenceAssetIds).toEqual([]);
    expect(
      textOnly.some((i) => i.prompt.positivePrompt.includes("Do not draw interior rooms")),
    ).toBe(true);
  });
});

describe("diagramFrameOutputs", () => {
  it("takes the newest frame batch and matches frames by step id", async () => {
    const { diagramFrameOutputs } = await import("../src/diagram");
    const plan = planDiagram(facadeDna(), "concept_evolution", 4, { projectType: "townhouse" });
    const gen = (
      batchId: string,
      stepId: string,
      out: string,
      createdAt: string,
      status = "completed",
    ) => ({
      batchId,
      status,
      createdAt,
      outputAssetIds: [out],
      prompt: { metadata: { diagram: { type: "concept_evolution", stepId } } },
    });
    const old = plan.steps.map((s, i) => gen("BAT_OLD", s.id, `AST_OLD_${i}`, "2026-01-01"));
    const fresh = [...plan.steps]
      .reverse()
      .map((s, i) =>
        gen(
          "BAT_NEW",
          s.id,
          `AST_NEW_${s.index}`,
          `2026-02-0${i + 1}`,
          i === 0 ? "running" : "completed",
        ),
      );
    const other = {
      ...gen("BAT_X", plan.steps[0]!.id, "AST_X", "2027-01-01"),
      prompt: { metadata: {} },
    };
    const result = diagramFrameOutputs(plan, [...old, ...fresh, other]);
    expect(result.batchId).toBe("BAT_NEW");
    expect(result.complete).toBe(false);
    expect(result.frames[plan.steps[0]!.id]).toBe("AST_NEW_0");
    expect(result.frames[plan.steps[3]!.id]).toBeUndefined();
    expect(diagramFrameOutputs(plan, old)).toMatchObject({ batchId: "BAT_OLD", complete: true });
    expect(diagramFrameOutputs(plan, [])).toEqual({ batchId: null, frames: {}, complete: false });
  });
});
