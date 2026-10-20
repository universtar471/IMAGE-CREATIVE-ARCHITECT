import { describe, expect, it } from "vitest";
import {
  effectivePanelWidth,
  layoutTier,
  MIN_CANVAS_WIDTH,
  NAV_WIDTH,
  workspaceLayout,
} from "../src/features/workspace/layout";

describe("responsive workspace layout (ADR-044)", () => {
  it("maps the measured CSS width to a tier, Windows scale included", () => {
    // 1920 px monitor at 100 / 125 / 150 / 200 % → 1920 / 1536 / 1280 / 960 CSS px.
    expect([1920, 1536, 1280, 960].map(layoutTier)).toEqual([
      "wide",
      "regular",
      "regular",
      "narrow",
    ]);
    expect([1440, 1000, 999, 800, 799, 640].map(layoutTier)).toEqual([
      "regular",
      "compact",
      "narrow",
      "narrow",
      "tight",
      "tight",
    ]);
  });

  it("flags short windows and switches to icon nav and a drawer when narrow", () => {
    expect(workspaceLayout(1280, 720)).toMatchObject({ tier: "regular", short: true });
    expect(workspaceLayout(1024, 768)).toMatchObject({
      short: false,
      iconNav: true,
      drawer: false,
    });
    expect(workspaceLayout(800, 600)).toMatchObject({ iconNav: true, drawer: true, short: true });
    // Unmeasured (tests, first paint): a regular, docked layout.
    expect(workspaceLayout(0, 0)).toMatchObject({ tier: "regular", drawer: false, short: false });
  });

  it("keeps the user's inspector width but never squeezes the canvas below its minimum", () => {
    const wide = workspaceLayout(1920, 1080);
    expect(effectivePanelWidth(600, wide)).toBe(600);
    const compact = workspaceLayout(1000, 768);
    const shown = effectivePanelWidth(600, compact);
    expect(shown).toBeLessThanOrEqual(1000 - NAV_WIDTH.compact - MIN_CANVAS_WIDTH);
    expect(shown).toBeGreaterThanOrEqual(300);
    // Growing the window again gives the stored width back.
    expect(effectivePanelWidth(600, workspaceLayout(1920, 1080))).toBe(600);
    // A drawer fits the window.
    expect(effectivePanelWidth(700, workspaceLayout(800, 600))).toBeLessThanOrEqual(
      800 - NAV_WIDTH.narrow,
    );
  });
});
