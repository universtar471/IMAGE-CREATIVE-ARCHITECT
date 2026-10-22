import { expect, it } from "vitest";
import {
  parseInteriorRecommendation,
  interiorRecommendationPrompt,
} from "../src/generationPresets/recommendations";

const analysis = {
  room_type: "living room",
  existing_style: "modern",
  geometry: "Rectangular room with existing windows",
  materials: ["wood"],
  colors: ["black", "white"],
  lighting: "daylight",
  strengths: ["clear circulation"],
  weaknesses: ["flat shadows"],
};
const recommendation = (style_id: string) => ({
  style_id,
  style_name: "Model supplied label",
  compatibility_score: 90,
  short_reason: "Compatible with the existing space",
  suggested_lighting: "soft_natural",
  recommended_change_level: 1,
});
const reply = {
  analysis,
  recommendations: ["japandi", "modern", "minimalist"].map(recommendation),
};
it("recovers fenced JSON with trailing commas and returns exactly three catalogue styles", () => {
  const result = parseInteriorRecommendation(
    "```json\n" + JSON.stringify(reply).replace(/}$/, ",}") + "\n```",
    "style",
  );
  expect(result.recommendations).toHaveLength(3);
  expect(interiorRecommendationPrompt("style")).toContain("exactly three");
});
it("rejects missing fields, unknown ids, duplicates, truncated JSON and invalid lighting", () => {
  for (const raw of [
    "{",
    JSON.stringify({ analysis }),
    JSON.stringify({
      ...reply,
      recommendations: [recommendation("invented"), ...reply.recommendations.slice(1)],
    }),
    JSON.stringify({ ...reply, recommendations: Array(3).fill(recommendation("japandi")) }),
    JSON.stringify({ preset: "rain", reason: "Outside" }),
  ])
    expect(() =>
      parseInteriorRecommendation(raw, raw.includes('"preset"') ? "lighting" : "style"),
    ).toThrow();
});
it("accepts indoor lighting advice without generating or changing any workflow state", () => {
  expect(
    parseInteriorRecommendation('{"preset":"warm","reason":"Fits existing lamps"}', "lighting"),
  ).toEqual({ preset: "warm", reason: "Fits existing lamps" });
});
