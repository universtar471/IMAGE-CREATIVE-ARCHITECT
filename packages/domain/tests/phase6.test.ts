import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BatchCreateRequestSchema,
  GenerationSubmitRequestSchema,
  QcArtifactSchema,
  QcListRequestSchema,
  QcRunRequestSchema,
  QcSettingsSchema,
  QcVisionSchema,
  buildRepairPrompt,
  buildVisionPrompt,
  createInitialDNA,
  defaultQcSettings,
  isGenerationAllowed,
  parseVisionReply,
  scoreReport,
  type QcReportDTO,
} from "../src";

const dna = createInitialDNA({ projectType: "custom", pack: null });

const promptBundle = {
  compilerVersion: "pc-1.2.0",
  positivePrompt: "",
  negativePrompt: "",
  referenceInstructions: "",
  preservationInstructions: "",
  metadata: {},
};

const generationRequest = (purpose: string, params: Record<string, unknown> = {}) => ({
  projectId: "PRJ_1",
  providerId: "provider",
  modelId: "model",
  purpose,
  prompt: promptBundle,
  referenceAssetIds: purpose === "repair" ? ["AST_1", "AST_2"] : [],
  params: {
    aspectRatio: null,
    imageSize: null,
    outputCount: 1,
    seed: null,
    quality: null,
    ...params,
  },
  cameraId: null,
});

describe("phase 6 QC schemas", () => {
  it("uses the exact QC settings defaults", () => {
    expect(defaultQcSettings()).toEqual({
      schemaVersion: 1,
      passMin: 70,
      categoryMin: 55,
      highArtifactFails: true,
      autoQc: "off",
      autoRepairMax: 0,
      visionProviderId: null,
      visionModel: null,
    });
    expect(QcSettingsSchema.parse({})).toEqual(defaultQcSettings());
  });

  it("validates QC requests and vision shapes", () => {
    expect(
      QcRunRequestSchema.parse({ projectId: "PRJ_1", assetId: "AST_1", vision: null }),
    ).toEqual({ projectId: "PRJ_1", assetId: "AST_1", vision: null });
    expect(QcListRequestSchema.parse({ projectId: "PRJ_1" })).toEqual({ projectId: "PRJ_1" });
    expect(
      QcVisionSchema.parse({
        providerId: "openai",
        model: "vision",
        scores: { geometry: 80, material: 81, openings: 82, context: 83, lighting: 84 },
        artifacts: [{ label: "warp", severity: "medium", box: [0, 0.2, 1, 0.8] }],
        issues: [{ category: "geometry", text: "minor warp" }],
        repairInstruction: "Straighten the facade.",
      }),
    ).toBeTruthy();
    expect(() => QcArtifactSchema.parse({ label: "x", severity: "critical", box: null })).toThrow();
  });

  it("requires repair.qcReportId for repair and accepts it for batch requests", () => {
    expect(() => GenerationSubmitRequestSchema.parse(generationRequest("repair"))).toThrow(
      /params\.repair/i,
    );
    expect(
      GenerationSubmitRequestSchema.parse(
        generationRequest("repair", { repair: { qcReportId: "QC_01ARZ3NDEKTSV4RRFFQ69G5FAV" } }),
      ).params.repair,
    ).toEqual({ qcReportId: "QC_01ARZ3NDEKTSV4RRFFQ69G5FAV" });
    expect(
      BatchCreateRequestSchema.parse({
        projectId: "PRJ_1",
        name: "repair",
        providerId: "provider",
        modelId: "model",
        purpose: "repair",
        items: [
          {
            cameraId: null,
            label: "repair",
            prompt: promptBundle,
            referenceAssetIds: ["AST_1", "AST_2"],
            params: {
              aspectRatio: null,
              imageSize: null,
              outputCount: 1,
              seed: null,
              quality: null,
              repair: { qcReportId: "QC_01ARZ3NDEKTSV4RRFFQ69G5FAV" },
            },
          },
        ],
      }),
    ).toBeTruthy();
  });
});

describe("QC scoring", () => {
  const local = { edgeAlignment: 80, sharpness: 40, clippedPct: 0 };
  const thresholds = { passMin: 70, categoryMin: 55, highArtifactFails: true };
  const vision = (
    scores: number[],
    artifacts: Array<{ severity: "low" | "medium" | "high" }> = [],
  ) => ({
    providerId: "p",
    model: "m",
    scores: {
      geometry: scores[0]!,
      material: scores[1]!,
      openings: scores[2]!,
      context: scores[3]!,
      lighting: scores[4]!,
    },
    artifacts: artifacts.map((a) => ({ label: "artifact", ...a, box: null })),
    issues: [],
    repairInstruction: "",
  });

  it("scores vision pass, warn, category fail, overall fail and high artifact", () => {
    expect(scoreReport(local, vision([80, 80, 80, 80, 80]), thresholds)).toEqual({
      overall: 80,
      result: "pass",
    });
    expect(scoreReport(local, vision([71, 71, 71, 71, 71]), thresholds)).toEqual({
      overall: 71,
      result: "warn",
    });
    expect(scoreReport(local, vision([54, 80, 80, 80, 80]), thresholds)).toEqual({
      overall: 74.8,
      result: "fail",
    });
    expect(scoreReport(local, vision([40, 40, 40, 40, 40]), thresholds)).toEqual({
      overall: 40,
      result: "fail",
    });
    expect(
      scoreReport(local, vision([80, 80, 80, 80, 80], [{ severity: "high" }]), thresholds),
    ).toEqual({ overall: 80, result: "fail" });
    expect(
      scoreReport(local, vision([80, 80, 80, 80, 80], [{ severity: "high" }]), {
        ...thresholds,
        highArtifactFails: false,
      }),
    ).toEqual({ overall: 80, result: "pass" });
  });

  it("uses edge alignment without vision and reports unscored when it is absent", () => {
    expect(scoreReport({ ...local, edgeAlignment: 75 }, null, thresholds)).toEqual({
      overall: 75,
      result: "warn",
    });
    expect(scoreReport({ ...local, edgeAlignment: null }, null, thresholds)).toEqual({
      overall: null,
      result: "unscored",
    });
  });
});

describe("vision reply parser", () => {
  const valid = JSON.stringify({
    scores: { geometry: 120.4, material: -2, openings: 50.5, context: 75, lighting: 99 },
    artifacts: [{ label: "edge", severity: "high", box: [-1, 0.25, 2, 0.5] }],
    issues: [{ category: "artifact", text: "edge halo" }],
    repairInstruction: "Remove the halo.",
  });

  it.each([
    valid,
    `\`\`\`json\n${valid}\n\`\`\``,
    `Here is the result: ${valid} Thanks.`,
    `Use {not JSON} before the answer: ${valid}`,
  ])("extracts JSON from %s", (text) => {
    expect(parseVisionReply(text)).toEqual({
      scores: { geometry: 100, material: 0, openings: 51, context: 75, lighting: 99 },
      artifacts: [{ label: "edge", severity: "high", box: [0, 0.25, 1, 0.5] }],
      issues: [{ category: "artifact", text: "edge halo" }],
      repairInstruction: "Remove the halo.",
    });
  });

  it.each(["", '{"scores": {', '{"scores":{"geometry":50}}'])("rejects %s", (text) => {
    expect(() => parseVisionReply(text)).toThrow(/^Vision reply is not valid QC JSON:/);
  });

  it("rejects unknown severity and category", () => {
    expect(() => parseVisionReply(valid.replace('"high"', '"critical"'))).toThrow(
      /Vision reply is not valid QC JSON/,
    );
    expect(() => parseVisionReply(valid.replace('"artifact"', '"other"'))).toThrow(
      /Vision reply is not valid QC JSON/,
    );
  });
});

describe("QC prompts and repair gating", () => {
  it("matches the shared repair prompt snapshot", () => {
    const vector = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "packages/domain/test-vectors/repair-prompt.json"),
        "utf8",
      ),
    ) as {
      dna: Parameters<typeof buildRepairPrompt>[0]["dna"];
      report: QcReportDTO;
      expected: string;
    };
    expect(buildRepairPrompt({ dna: vector.dna, report: vector.report })).toBe(vector.expected);
  });
  it("builds deterministic vision prompts with DNA facts and same-view guidance", () => {
    const first = buildVisionPrompt({ dna, purpose: "enhance" });
    expect(first).toEqual(buildVisionPrompt({ dna, purpose: "enhance" }));
    expect(first.system).toContain("geometry");
    expect(first.system).toContain("scores");
    expect(first.system).toContain("artifacts");
    expect(first.system).toContain("repairInstruction");
    expect(first.user).toContain(dna.building.buildingType);
    expect(first.user).toContain("same viewpoint");
    expect(buildVisionPrompt({ dna, purpose: "hero" }).user).not.toContain("same viewpoint");
    expect(first).toMatchInlineSnapshot(`
      {
        "system": "You are a strict architectural image quality-control judge. Compare the evaluated image with its reference images and the supplied project DNA facts.

      Score exactly these five categories from 0 to 100:
      - geometry: building massing, proportions, floor count, roof form, perspective and structural consistency.
      - material: specified facade, roof and surface materials, colors, texture fidelity and finish consistency.
      - openings: window and door count, placement, rhythm, frames, glazing and alignment.
      - context: site layout, streets, neighbouring buildings, landscape, vegetation and background consistency.
      - lighting: time of day, direction, intensity, shadows, artificial lights, weather and atmosphere consistency.

      List visible image-generation artifacts separately. Artifact severity must be low, medium or high. Each box must be [x,y,w,h] normalized to 0..1, or null when no useful box can be given. Issue category must be geometry, material, openings, context, lighting or artifact.

      Return JSON only, without markdown or prose, using exactly these top-level keys:
      {"scores":{"geometry":0,"material":0,"openings":0,"context":0,"lighting":0},"artifacts":[{"label":"","severity":"low","box":null}],"issues":[{"category":"geometry","text":""}],"repairInstruction":""}",
        "user": "Generation purpose: enhance.
      This output must keep the same viewpoint, camera, framing and composition as its primary reference. Treat any drift as a geometry issue.
      Project DNA facts:
      Building DNA: {"buildingType":"Custom","colorPalette":[],"dimensions":{},"massing":{"voids":[]},"materials":[],"notes":"","openings":{},"roof":{},"schemaVersion":1,"specialFeatures":[]}
      Context DNA: {"atmosphereNotes":"","distantBackground":[],"front":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"left":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"negativeConstraints":[],"rear":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"right":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"schemaVersion":1}
      Camera DNA: []
      Lighting DNA: null
      Weather DNA: null
      Mood DNA: null",
      }
    `);
  });

  it("builds a constrained repair prompt from issues, artifacts and instruction", () => {
    const report = {
      vision: {
        providerId: "provider",
        model: "model",
        scores: { geometry: 40, material: 80, openings: 40, context: 80, lighting: 80 },
        issues: [{ category: "geometry", text: "window rhythm drifts" }],
        artifacts: [{ label: "halo", severity: "high", box: [0.1, 0.2, 0.3, 0.4] }],
        repairInstruction: "Restore the window rhythm.",
      },
    } as unknown as QcReportDTO;
    const prompt = buildRepairPrompt({ dna, report });
    expect(prompt).toContain("window rhythm drifts");
    expect(prompt).toContain("halo");
    expect(prompt).toContain("Restore the window rhythm.");
    expect(prompt).toContain("Keep the architecture, camera and composition unchanged");
    expect(prompt).toMatchInlineSnapshot(`
      "Repair this architectural image. Fix only the QC issues and artifacts listed below.
      QC issues:
      1. [geometry] window rhythm drifts
      QC artifacts:
      1. [high] halo; box: [0.1,0.2,0.3,0.4]
      Repair instruction: Restore the window rhythm.
      Keep the architecture, camera and composition unchanged. Keep every element not explicitly listed above unchanged, including geometry, materials, openings, context, lighting, weather and mood.
      Do not redesign, restyle, reframe, crop, add or remove anything else.
      Project facts to preserve:
      Building DNA: {"buildingType":"Custom","colorPalette":[],"dimensions":{},"massing":{"voids":[]},"materials":[],"notes":"","openings":{},"roof":{},"schemaVersion":1,"specialFeatures":[]}
      Context DNA: {"atmosphereNotes":"","distantBackground":[],"front":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"left":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"negativeConstraints":[],"rear":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"right":{"adjacentBuildings":[],"elements":[],"notes":"","vegetation":[]},"schemaVersion":1}
      Camera DNA: []
      Lighting DNA: null
      Weather DNA: null
      Mood DNA: null"
    `);
  });

  it("gates repair like variation", () => {
    expect(
      isGenerationAllowed("repair", [], {
        masterApproved: true,
        anchorCameraIds: [],
        approvedAnchorCameraIds: [],
      }),
    ).toEqual({ ok: true });
    expect(
      isGenerationAllowed("repair", [], {
        masterApproved: false,
        anchorCameraIds: [],
        approvedAnchorCameraIds: [],
      }),
    ).toEqual({ ok: false, blockedBy: "generate.master" });
  });
});
