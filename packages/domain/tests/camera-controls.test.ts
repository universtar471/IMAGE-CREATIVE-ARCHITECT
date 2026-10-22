import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ProjectDNASchema,
  compilePrompt,
  defaultInteriorDNA,
  resolveVisualIntent,
  setShotPresets,
  availableIntents,
  presetsForShot,
  VISUAL_INTENT_VIEWS,
} from "../src";

const base = ProjectDNASchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
      "utf8",
    ),
  ),
);
const inside = { ...base, spaceCatalog: undefined, interior: defaultInteriorDNA() };

describe("shot camera controls", () => {
  it("gives each interior camera a distinct composition", () => {
    const descriptions = availableIntents(inside).map(
      (view) => resolveVisualIntent({ view, purpose: "landscape" }, inside).composition,
    );
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });
  it.each(VISUAL_INTENT_VIEWS)(
    "compiles the selected exterior view %s without a saved camera",
    (view) => {
      const shotIntent = setShotPresets(
        { projectType: "townhouse" },
        [`camera.${view}`],
        base,
      ).shotIntent;
      const camera = resolveVisualIntent(shotIntent.visualIntent!, base);
      const prompt = compilePrompt({
        project: { id: "P", name: "P", projectType: "townhouse" },
        dna: base,
        references: [],
        shotIntent,
      });
      expect(prompt.positivePrompt).toContain(`Camera:`);
      expect(prompt.positivePrompt).toContain(camera.composition);
      expect(prompt.metadata.cameraId).toBeNull();
      expect(prompt.shotIntent?.cameraId).toBeNull();
    },
  );

  it.each(["front", "street_oblique", "pedestrian", "overview", "approach", "detail"] as const)(
    "uses an interior camera for %s, without the default entrance view",
    (view) => {
      const visualIntent = { view, purpose: "landscape" as const };
      const camera = resolveVisualIntent(visualIntent, inside);
      expect(camera.viewType).toMatch(/^interior_/);
      const prompt = compilePrompt({
        project: { id: "P", name: "P", projectType: "interior" },
        dna: inside,
        references: [],
        shotIntent: { projectType: "interior", visualIntent },
      });
      expect(prompt.positivePrompt).toContain(camera.composition);
      expect(prompt.positivePrompt.match(/Camera:/g)).toHaveLength(1);
      if (view === "detail") {
        expect(prompt.positivePrompt).not.toContain(
          "wide view from the entrance showing the whole room",
        );
        expect(prompt.positivePrompt).toContain("close-up material and furniture detail");
      }
    },
  );

  it("offers interior labels while preserving existing camera ids", () => {
    const offered = presetsForShot(true);
    expect(offered.find((p) => p.id === "camera.street_oblique")?.labelEn).toBe("Room corner");
    expect(offered.find((p) => p.id === "camera.front")?.labelEn).toBe("Main wall");
    expect(offered.find((p) => p.id === "weather.light_rain")?.labelEn).toBe("Rain outside");
    expect(availableIntents(inside)).not.toContain("aerial");
  });
});
