import { describe, expect, it } from "vitest";
import {
  DEFAULT_QC_SETTINGS,
  buildRepairGenerationRequest,
  mapArtifactBox,
  latestQcByAsset,
  isQcResponseCurrent,
  parseVisionReply,
  scoreReport,
  type QcReportDTO,
} from "../src/lib/qc";

const local = { edgeAlignment: 80, sharpness: 70, clippedPct: 0 };
const thresholds = { passMin: 70, categoryMin: 55, highArtifactFails: true };
const vision = {
  providerId: "openai",
  model: "vision-1",
  scores: { geometry: 80, material: 80, openings: 80, context: 80, lighting: 80 },
  artifacts: [],
  issues: [],
  repairInstruction: "Keep the facade aligned.",
};

describe("QC contract helpers", () => {
  it("rejects responses from an older project or asset selection", () => {
    expect(isQcResponseCurrent("project-a", "asset-a", "project-b", "asset-a")).toBe(false);
    expect(isQcResponseCurrent("project-a", "asset-a", "project-a", "asset-b")).toBe(false);
    expect(isQcResponseCurrent("project-a", "asset-a", "project-a", "asset-a")).toBe(true);
  });
  it("uses exact default settings and result rules", () => {
    expect(DEFAULT_QC_SETTINGS).toEqual({
      schemaVersion: 1,
      passMin: 70,
      categoryMin: 55,
      highArtifactFails: true,
      autoQc: "off",
      autoRepairMax: 0,
      visionProviderId: null,
      visionModel: null,
    });
    expect(scoreReport(local, null, thresholds)).toEqual({ overall: 80, result: "pass" });
    expect(scoreReport({ ...local, edgeAlignment: null }, null, thresholds)).toEqual({
      overall: null,
      result: "unscored",
    });
    expect(scoreReport({ ...local, edgeAlignment: 69 }, null, thresholds)).toEqual({
      overall: 69,
      result: "fail",
    });
    expect(
      scoreReport(local, { ...vision, scores: { ...vision.scores, material: 40 } }, thresholds)
        .result,
    ).toBe("fail");
    expect(
      scoreReport(local, { ...vision, scores: { ...vision.scores, material: 75 } }, thresholds)
        .result,
    ).toBe("warn");
  });

  it("extracts a strict vision object from surrounding text", () => {
    const parsed = parseVisionReply(
      `Here is the result: ${JSON.stringify({ scores: vision.scores, artifacts: [], issues: [], repairInstruction: "Keep it." })} Done.`,
    );
    expect(parsed.scores.geometry).toBe(80);
    expect(
      parseVisionReply(
        `prefix {"scores":{"geometry":1}} then ${JSON.stringify({ scores: vision.scores, artifacts: [], issues: [], repairInstruction: "Keep it." })}`,
      ),
    ).toEqual({
      scores: vision.scores,
      artifacts: [],
      issues: [],
      repairInstruction: "Keep it.",
    });
    expect(() => parseVisionReply("not json")).toThrow();
  });

  it("maps normalised artifact boxes to the displayed image rect", () => {
    expect(
      mapArtifactBox([0.1, 0.2, 0.5, 0.25], { left: 20, top: 30, width: 800, height: 400 }),
    ).toEqual({
      left: 100,
      top: 110,
      width: 400,
      height: 100,
    });
    expect(mapArtifactBox(null, { left: 0, top: 0, width: 1, height: 1 })).toBeNull();
  });

  it("selects the latest report per asset and builds the repair payload", () => {
    const reports = [
      { id: "QC_OLD", projectId: "p", assetId: "a", createdAt: "2026-01-01T00:00:00Z" },
      { id: "QC_NEW", projectId: "p", assetId: "a", createdAt: "2026-01-02T00:00:00Z" },
      { id: "QC_OTHER", projectId: "p", assetId: "b", createdAt: "2026-01-03T00:00:00Z" },
    ] as QcReportDTO[];
    expect(latestQcByAsset(reports).get("a")?.id).toBe("QC_NEW");
    expect(
      buildRepairGenerationRequest({
        projectId: "p",
        report: {
          ...reports[1]!,
          referenceAssetIds: ["ref"],
          local,
          vision,
          overall: 60,
          result: "warn",
          thresholds,
        },
        providerId: "openai",
        modelId: "vision-1",
        prompt: {
          compilerVersion: "test",
          positivePrompt: "repair",
          negativePrompt: "",
          referenceInstructions: "",
          preservationInstructions: "",
          metadata: {},
        },
        params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
      }),
    ).toMatchObject({
      purpose: "repair",
      referenceAssetIds: ["a", "ref"],
      params: { repair: { qcReportId: "QC_NEW" } },
    });
  });
});
