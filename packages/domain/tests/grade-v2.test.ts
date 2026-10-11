import { describe, expect, it } from "vitest";
import {
  ARCH_LUT_FILTER,
  ColorGradeDNASchema,
  GRADE_STYLE_PRESETS,
  gradePresetsForStyle,
  isGradeV2,
  isLogLut,
  INTERIOR_STYLES,
  stylePhrase,
} from "../src";

describe("grade v2", () => {
  const splitTone = {
    shadowsHue: 0,
    shadowsSat: 100,
    highlightsHue: 360,
    highlightsSat: 0,
    balance: -100,
  };

  it("accepts all v2 fields at their boundaries", () => {
    expect(
      ColorGradeDNASchema.safeParse({
        schemaVersion: 1,
        texture: -100,
        vignette: 100,
        grain: 100,
        splitTone,
        toneCurve: "matte",
        lut: { lutId: "example", strength: 0 },
      }).success,
    ).toBe(true);
  });

  it("rejects out-of-range fields", () => {
    const cases = [
      { texture: -101 },
      { vignette: 101 },
      { grain: -1 },
      { grain: 101 },
      { splitTone: { ...splitTone, shadowsHue: 361 } },
      { splitTone: { ...splitTone, highlightsSat: 101 } },
      { splitTone: { ...splitTone, balance: -101 } },
      { toneCurve: "invalid" },
      { lut: { lutId: "x", strength: 101 } },
    ];
    for (const fields of cases)
      expect(ColorGradeDNASchema.safeParse({ schemaVersion: 1, ...fields }).success).toBe(false);
  });

  it("detects only set v2 fields", () => {
    expect(isGradeV2({ schemaVersion: 1, exposure: 10 })).toBe(false);
    expect(isGradeV2({ schemaVersion: 1, toneCurve: "none" })).toBe(true);
    expect(isGradeV2({ schemaVersion: 1, grain: 0 })).toBe(true);
  });

  it("matches the specified log naming regex", () => {
    expect(isLogLut("D-Log")).toBe(true);
    expect(isLogLut("SLog3")).toBe(false);
    expect(isLogLut("Vlog")).toBe(true);
    expect(isLogLut("logo")).toBe(false);
  });

  it("keeps the exact architecture category keywords", () => {
    expect(ARCH_LUT_FILTER.exclude).toEqual([
      "food",
      "wedding",
      "portrait",
      "nude",
      "boho",
      "insta",
      "men",
      "rose gold",
      "peach",
      "royal",
      "majestic",
      "bright wedding",
      "rover",
    ]);
    expect(ARCH_LUT_FILTER.prefer).toEqual([
      "aerial",
      "drone",
      "urban",
      "city",
      "landscape",
      "scenery",
      "natural",
      "earthy",
      "gray",
      "kodak",
      "film",
      "japan",
      "night",
      "cinematic",
      "moody",
      "teal",
      "travel",
    ]);
  });

  it("maps real style ids and validates every preset grade", () => {
    expect(gradePresetsForStyle("japandi")).toContain("earthy_muted");
    expect(gradePresetsForStyle("tropical")).toContain("tropical_forest");
    for (const preset of Object.values(GRADE_STYLE_PRESETS)) {
      expect(ColorGradeDNASchema.safeParse({ schemaVersion: 1, ...preset.grade }).success).toBe(
        true,
      );
    }
  });

  it("uses only known interior styles or exterior style keys", () => {
    const interiorStyleIds = new Set<string>(INTERIOR_STYLES.map(({ id }) => id));
    for (const preset of Object.values(GRADE_STYLE_PRESETS)) {
      for (const style of preset.styles) {
        expect(
          interiorStyleIds.has(style) || stylePhrase(style) !== style,
          `${style} is not a known style`,
        ).toBe(true);
      }
    }
  });
});
