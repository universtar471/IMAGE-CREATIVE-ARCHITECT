import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MOTION_PRESETS,
  ProjectDNASchema,
  VIDEO_COMPILER_VERSION,
  compileVideoPrompt,
  estimateVideoCost,
  isVideoAsset,
  modelDurations,
  motionPreset,
  type ProjectDNA,
  type VideoShot,
} from "../src";

const dna = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

const shot = (over: Partial<VideoShot> = {}): VideoShot => ({
  motionPresetId: "dolly_in",
  durationSec: 5,
  aspectRatio: null,
  sourceAssetId: "AST_SRC",
  ...over,
});

describe("video prompts (ADR-043)", () => {
  it("has eight self-written motions, each with something to avoid", () => {
    expect(MOTION_PRESETS.map((p) => p.id)).toHaveLength(8);
    for (const preset of MOTION_PRESETS) {
      expect(preset.motionEn.length).toBeGreaterThan(20);
      expect(preset.avoidEn.length).toBeGreaterThan(0);
    }
    expect(motionPreset("cinemagraph")?.motionEn).toMatch(/completely still/);
  });

  it("is deterministic and keeps the architecture rigid", () => {
    const a = compileVideoPrompt(dna(), shot());
    expect(compileVideoPrompt(dna(), shot())).toEqual(a);
    expect(a.compilerVersion).toBe(VIDEO_COMPILER_VERSION);
    expect(a.positivePrompt).toContain("glides slowly forward");
    expect(a.preservationInstructions).toMatch(/rigid/);
    expect(a.negativePrompt).toContain("extra or missing floors");
    expect(a.metadata).toMatchObject({ kind: "video", motionPresetId: "dolly_in", durationSec: 5 });
    expect(
      compileVideoPrompt(dna(), shot({ motionPresetId: "orbit_left" })).positivePrompt,
    ).not.toBe(a.positivePrompt);
  });

  it("appends the user's note last and records it as a section", () => {
    const b = compileVideoPrompt(dna(), shot({ note: "  Light rain.  " }));
    expect(b.positivePrompt.endsWith("Light rain.")).toBe(true);
    expect(b.metadata.sections).toContainEqual({ id: "note", source: "user" });
  });

  it("never writes to the DNA", () => {
    const input = dna();
    const before = JSON.stringify(input);
    compileVideoPrompt(input, shot());
    expect(JSON.stringify(input)).toBe(before);
  });

  it("reads durations and per-clip prices from the model", () => {
    const model = { imageSizes: ["5s", "10s", "1K"], priceHint: { "5s": 7000 } };
    expect(modelDurations(model)).toEqual([5, 10]);
    expect(estimateVideoCost(model, 5)).toBe(7000);
    expect(estimateVideoCost(model, 10)).toBeNull();
    expect(estimateVideoCost({ priceHint: null }, 5)).toBeNull();
  });

  it("tells video assets apart", () => {
    expect(isVideoAsset({ mimeType: "video/mp4" })).toBe(true);
    expect(isVideoAsset({ mimeType: "image/png", mediaKind: "video" })).toBe(true);
    expect(isVideoAsset({ mimeType: "image/png" })).toBe(false);
    expect(isVideoAsset({ mimeType: null })).toBe(false);
  });
});
