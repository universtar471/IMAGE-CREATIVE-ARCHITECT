import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANALYSIS_BOARD_SIZE,
  ANALYSIS_SYSTEM_PROMPT,
  analysisSystemPrompt,
  IMAGE_RECIPES,
  ProjectDNASchema,
  analysisBoardSvg,
  compilePrompt,
  imageRecipe,
  parseImageAnalysis,
  planRecipe,
  shotPreset,
  wrapText,
  type AnalysisBoardLabels,
  type ProjectDNA,
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

describe("image recipes (ADR-042)", () => {
  it("only reference presets of the catalog", () => {
    for (const recipe of IMAGE_RECIPES) {
      expect(recipe.variants.length).toBeGreaterThan(0);
      for (const v of recipe.variants)
        for (const id of v.presetIds) expect(shotPreset(id), `${recipe.id}/${id}`).toBeDefined();
    }
    expect(imageRecipe("lighting_scenarios")?.variants).toHaveLength(6);
  });

  it("layers each variant on the user's chips, the variant winning exclusive keys", () => {
    const base = {
      projectType: "townhouse" as const,
      presetIds: ["render.viewport_to_photo", "time.golden_hour", "people.few_adults"],
    };
    const plan = planRecipe(imageRecipe("lighting_scenarios")!, base, dna());
    expect(plan.map((p) => p.variant.id)).toEqual([
      "morning",
      "midday",
      "golden",
      "overcast",
      "blue",
      "night",
    ]);
    const night = plan.at(-1)!.shotIntent;
    expect(night.presetIds).toEqual([
      "render.viewport_to_photo",
      "time.night",
      "weather.clear",
      "people.few_adults",
    ]);
    expect(night.lighting).toEqual({ timeOfDay: "night", weather: "clear" });
    // Each plan compiles to its own prompt.
    const prompts = plan.map(
      (p) =>
        compilePrompt({
          project: { id: "PRJ_R", name: "R", projectType: "townhouse" },
          dna: dna(),
          references: [],
          shotIntent: p.shotIntent,
        }).positivePrompt,
    );
    expect(new Set(prompts).size).toBe(6);
  });

  it("picks variants and leaves out the ones that cannot fit the shot", () => {
    const picked = planRecipe(imageRecipe("weather_set")!, { projectType: "townhouse" }, dna(), [
      "mist",
    ]);
    expect(picked.map((p) => p.variant.id)).toEqual(["mist"]);
    expect(picked[0]!.shotIntent.lighting).toEqual({ timeOfDay: "dawn", weather: "morning_mist" });
    const indoor = planRecipe(imageRecipe("facade_palette")!, { projectType: "interior" }, dna());
    expect(indoor).toEqual([]);
  });

  it("palette and moodboard sentences keep the rest of the design", () => {
    expect(shotPreset("palette.charcoal")!.keepEn).toMatch(/keep the geometry/);
    expect(shotPreset("render.material_moodboard")!.keepEn).toMatch(/no text/);
  });
});

const labels: AnalysisBoardLabels = {
  title: "Image analysis",
  inferred: "Inferred from the image",
  materials: "Materials",
  palette: "Palette",
  composition: "Composition",
  viewpoint: "Viewpoint",
  lighting: "Lighting",
  focus: "Focus",
  observations: "Observations",
  confidence: { low: "unclear", medium: "fairly clear", high: "clear" },
  footer: "AI inference from the image; not a measurement.",
};

const reply = {
  materials: [{ name: "Timber louvres", location: "upper facade", confidence: "high" }],
  palette: [{ hex: "#c8a27a", name: "Warm timber" }],
  composition: { viewpoint: "Street-level oblique", lighting: "Low warm sun" },
  observations: ["Planting softens the base <of> the building & entrance."],
};

describe("evidence analysis (ADR-042)", () => {
  it("parses JSON, a fenced reply, and rejects bad shapes", () => {
    const ok = parseImageAnalysis("```json\n" + JSON.stringify(reply) + "\n```");
    expect(ok).toMatchObject({ ok: true, analysis: { palette: [{ hex: "#c8a27a" }] } });
    expect(parseImageAnalysis("nope")).toEqual({ ok: false, reason: "not_json" });
    expect(parseImageAnalysis(JSON.stringify({ palette: [{ hex: "red", name: "x" }] }))).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(parseImageAnalysis("{}")).toMatchObject({ ok: true, analysis: { materials: [] } });
  });

  it("draws an escaped, deterministic board that says it is inferred", () => {
    const parsed = parseImageAnalysis(JSON.stringify(reply));
    if (!parsed.ok) throw new Error("parse failed");
    const svg = analysisBoardSvg(parsed.analysis, "data:image/png;base64,AA", labels);
    expect(svg).toBe(analysisBoardSvg(parsed.analysis, "data:image/png;base64,AA", labels));
    expect(svg).toContain(`width="${ANALYSIS_BOARD_SIZE.width}"`);
    expect(svg).toContain("Inferred from the image");
    expect(svg).toContain("Timber louvres — upper facade (clear)");
    expect(svg).toContain("&lt;of&gt;");
    expect(svg).toContain("building &amp;");
    expect(svg).not.toMatch(/& /);
    expect(svg).not.toContain("<of>");
    expect(svg).toContain('fill="#c8a27a"');
  });

  it("asks for findings in the UI language, instructions staying English", () => {
    expect(analysisSystemPrompt("Vietnamese")).toContain("written in Vietnamese");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("written in English");
  });

  it("wraps text by words", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
  });
});
