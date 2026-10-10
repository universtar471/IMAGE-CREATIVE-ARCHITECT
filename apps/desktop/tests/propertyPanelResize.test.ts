import { describe, expect, it } from "vitest";
import { clampPanelWidth, readPanelWidth } from "../src/components/panels/PropertyPanelResize";

describe("property panel resize helpers", () => {
  it("clamps widths to the supported range", () => {
    expect(clampPanelWidth(100)).toBe(320);
    expect(clampPanelWidth(500)).toBe(500);
    expect(clampPanelWidth(900)).toBe(720);
  });
  it("uses the default when storage is unavailable or invalid", () => {
    expect(readPanelWidth({ getItem: () => "bad" })).toBe(380);
    expect(readPanelWidth({ getItem: () => { throw new Error("blocked"); } })).toBe(380);
  });
});
