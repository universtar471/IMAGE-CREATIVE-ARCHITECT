import { describe, expect, it } from "vitest";
import {
  GRADE_LOOK_CATALOG,
  GRADE_LOOK_IDS,
  GRADE_LOOKS,
  ColorGradeDNASchema,
  applyGradeToImageData,
} from "../src/index";

describe("Color Grading Studio V5.2", () => {
  it("has 30 unique localized presets with a matching schema and pixel grade", () => {
    expect(GRADE_LOOK_CATALOG).toHaveLength(30);
    expect(new Set(GRADE_LOOK_CATALOG.map((v) => v.id)).size).toBe(30);
    expect(new Set(GRADE_LOOK_IDS)).toEqual(new Set(Object.keys(GRADE_LOOKS)));
    expect(new Set(GRADE_LOOK_IDS)).toEqual(new Set(GRADE_LOOK_CATALOG.map((v) => v.id)));
    expect(new Set(GRADE_LOOK_CATALOG.map((v) => v.category)).size).toBe(6);
    for (const entry of GRADE_LOOK_CATALOG) {
      expect(entry.labelVi.length).toBeGreaterThan(2);
      expect(entry.labelEn.length).toBeGreaterThan(2);
      expect(entry.descriptionVi.length).toBeGreaterThan(3);
      expect(entry.descriptionEn.length).toBeGreaterThan(3);
      expect(ColorGradeDNASchema.safeParse(GRADE_LOOKS[entry.id]).success).toBe(true);
    }
  });
  it("retains pixel positions and alpha for every look", () => {
    const source = new Uint8ClampedArray([47, 97, 177, 10, 201, 128, 83, 221]);
    for (const look of GRADE_LOOK_CATALOG) {
      const output = applyGradeToImageData(source, GRADE_LOOKS[look.id]);
      expect(output).toHaveLength(source.length);
      expect([output[3], output[7]]).toEqual([10, 221]);
      expect([...source]).toEqual([47, 97, 177, 10, 201, 128, 83, 221]);
    }
  });
});
