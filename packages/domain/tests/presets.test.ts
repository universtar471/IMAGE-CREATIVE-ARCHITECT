import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPILER_VERSION,
  PRESETS_HEADING,
  PRESET_CATALOG_VERSION,
  PRESET_GROUPS,
  ProjectDNASchema,
  SHOT_PRESETS,
  SITE_FRONTAGE_TARGET,
  ShotIntentSchema,
  compilePrompt,
  normalizePresetIds,
  presetsForShot,
  sceneObjectPreset,
  setShotPresets,
  shotPreset,
  togglePreset,
  validateShot,
  type ProjectDNA,
  type ShotIntent,
} from "../src";

const baseDna = (): ProjectDNA =>
  ProjectDNASchema.parse(
    JSON.parse(
      readFileSync(
        new URL("../../../apps/desktop/tests/fixtures/nhapho-dna.json", import.meta.url),
        "utf8",
      ),
    ),
  );

const shot = (extra: Partial<ShotIntent> = {}): ShotIntent => ({
  projectType: "townhouse",
  ...extra,
});

const withPresets = (ids: string[], dna = baseDna(), base = shot()) =>
  setShotPresets(base, ids, dna).shotIntent;

const compile = (dna: ProjectDNA, intent?: ShotIntent) =>
  compilePrompt({
    project: { id: "PRJ_PS", name: "Presets", projectType: "townhouse" },
    dna,
    references: [],
    ...(intent ? { shotIntent: intent } : {}),
  });

describe("preset catalog", () => {
  it("has unique ids, known groups and bilingual labels", () => {
    const ids = SHOT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SHOT_PRESETS.length).toBeGreaterThanOrEqual(30);
    for (const p of SHOT_PRESETS) {
      expect(PRESET_GROUPS).toContain(p.group);
      expect(p.labelVi.trim()).not.toBe("");
      expect(p.labelEn.trim()).not.toBe("");
    }
    for (const group of PRESET_GROUPS)
      expect(SHOT_PRESETS.some((p) => p.group === group)).toBe(true);
  });

  it("only references scene object presets that exist", () => {
    for (const p of SHOT_PRESETS)
      for (const o of p.patch.objects ?? []) expect(sceneObjectPreset(o.presetId)).toBeDefined();
  });

  it("offers exterior-only presets outside only", () => {
    const inside = presetsForShot(true).map((p) => p.id);
    expect(inside).not.toContain("camera.aerial");
    expect(inside).not.toContain("cars.parked_sedan");
    expect(presetsForShot(false).map((p) => p.id)).toContain("camera.aerial");
  });
});

describe("selection", () => {
  it("toggles, deduplicates and lets exclusive presets replace each other", () => {
    let sel = togglePreset([], "time.golden_hour");
    sel = togglePreset(sel, "people.few_adults");
    sel = togglePreset(sel, "time.night");
    expect(sel).toEqual(["time.night", "people.few_adults"]);
    expect(togglePreset(sel, "time.night")).toEqual(["people.few_adults"]);
    expect(togglePreset(sel, "unknown.preset")).toEqual(sel);
    expect(normalizePresetIds(["weather.clear", "weather.clear", "nope"])).toEqual([
      "weather.clear",
    ]);
  });
});

describe("setShotPresets", () => {
  it("writes structured choices into the shot and never into the DNA", () => {
    const dna = baseDna();
    const before = JSON.stringify(dna);
    const intent = withPresets(
      ["time.golden_hour", "weather.after_rain", "camera.street_oblique", "effect.sunstar"],
      dna,
    );
    expect(JSON.stringify(dna)).toBe(before);
    expect(intent.lighting).toEqual({ timeOfDay: "golden_hour", weather: "after_rain" });
    expect(intent.visualIntent).toEqual({ view: "street_oblique", purpose: "landscape" });
    expect(intent.effects).toEqual({
      primary: { id: "sunstar", intensity: "light" },
      secondary: [],
    });
    expect(ShotIntentSchema.parse(intent)).toBeTruthy();
  });

  it("adds preset objects at the frontage and removes only them again", () => {
    const own = {
      presetId: "person.adult",
      quantity: 1,
      targetSpaceId: SITE_FRONTAGE_TARGET,
      state: "static" as const,
      sourceReferenceIds: [],
    };
    const dna = baseDna();
    const added = withPresets(["people.few_adults"], dna, shot({ sceneObjects: [own] }));
    expect(added.sceneObjects).toHaveLength(2);
    expect(added.sceneObjects![1]).toMatchObject({
      presetId: "person.adult",
      quantity: 2,
      targetSpaceId: SITE_FRONTAGE_TARGET,
    });
    const removed = setShotPresets(added, [], dna).shotIntent;
    expect(removed.sceneObjects).toEqual([own]);
    expect(removed.presetIds).toBeUndefined();
  });

  it("undoes a replaced view and effect but keeps the user's own choices", () => {
    const dna = baseDna();
    const a = withPresets(["camera.front", "effect.lens_flare"], dna);
    const b = setShotPresets(a, ["camera.aerial"], dna).shotIntent;
    expect(b.visualIntent?.view).toBe("aerial");
    expect(b.effects).toBeUndefined();
    const manual = shot({ visualIntent: { view: "detail", purpose: "portrait" } });
    const c = setShotPresets(manual, [], dna).shotIntent;
    expect(c.visualIntent).toEqual({ view: "detail", purpose: "portrait" });
  });

  it("skips presets that do not fit an interior shot without a target space", () => {
    const result = setShotPresets(
      { projectType: "interior" },
      ["cars.parked_sedan", "plants.potted", "time.night"],
      baseDna(),
    );
    expect(result.skipped).toEqual(["cars.parked_sedan", "plants.potted"]);
    expect(result.shotIntent.sceneObjects).toBeUndefined();
    expect(result.shotIntent.lighting).toEqual({ timeOfDay: "night" });
  });
});

describe("compiler PRESETS section", () => {
  it("is byte-identical without presets and versioned with them", () => {
    expect(COMPILER_VERSION).toBe("pc-1.10.0");
    const dna = baseDna();
    const plain = compile(dna);
    expect(plain.positivePrompt).not.toContain(PRESETS_HEADING);
    expect(plain.metadata.presetSources).toBeUndefined();
    const intent = withPresets(["render.viewport_to_photo", "time.golden_hour"], dna);
    const bundle = compile(dna, intent);
    expect(bundle.positivePrompt).toContain(PRESETS_HEADING);
    expect(bundle.positivePrompt).toContain(shotPreset("render.viewport_to_photo")!.promptEn!);
    expect(bundle.metadata.presetSources).toEqual(["render.viewport_to_photo", "time.golden_hour"]);
    expect(bundle.metadata.presetCatalogVersion).toBe(PRESET_CATALOG_VERSION);
    expect(bundle.configHash).not.toBe(plain.configHash);
    expect(compile(dna, intent)).toEqual(bundle);
  });

  it("uses the shot's time of day and weather instead of the DNA values", () => {
    const dna = baseDna();
    const bundle = compile(dna, withPresets(["time.night", "weather.light_rain"], dna));
    expect(bundle.positivePrompt).toContain("Lighting: night, sun from east");
    expect(bundle.positivePrompt).not.toContain("preset daylight");
    expect(bundle.positivePrompt).not.toContain("morning");
    expect(bundle.positivePrompt).toContain("Weather: light rain.");
  });

  it("keeps locked lighting and weather, and the validator blocks the preset", () => {
    const dna = { ...baseDna(), locks: { ...baseDna().locks, lighting: true, weather: true } };
    dna.weather = { schemaVersion: 1, notes: "", preset: "clear" };
    const intent = withPresets(["time.night", "weather.clear", "weather.light_rain"], dna);
    const bundle = compile(dna, intent);
    expect(bundle.positivePrompt).toContain("morning");
    expect(bundle.positivePrompt).not.toContain(PRESETS_HEADING);
    const verdict = validateShot({ dna, shotIntent: intent });
    expect(verdict.verdict).toBe("BLOCK");
    expect(verdict.issues.map((i) => i.code).sort()).toEqual([
      "LOCKED_LIGHTING_CONFLICT",
      "LOCKED_WEATHER_CONFLICT",
    ]);
    const same = withPresets(["time.morning", "weather.clear"], dna);
    expect(validateShot({ dna, shotIntent: same }).verdict).toBe("ALLOW");
  });

  it("adds a viewpoint line only when no DNA camera is compiled", () => {
    const dna = baseDna();
    const bundle = compile(dna, withPresets(["camera.aerial"], dna));
    expect(bundle.positivePrompt).toMatch(/Viewpoint: high overview .*24 mm lens feel\./);
  });

  it("compiles colour looks nowhere and object presets through SCENE OBJECTS", () => {
    const dna = baseDna();
    const bundle = compile(dna, withPresets(["look.warm_tropical", "people.few_adults"], dna));
    expect(bundle.positivePrompt).not.toContain(PRESETS_HEADING);
    expect(bundle.shotIntent?.gradeLookId).toBe("warm_tropical");
    expect(bundle.metadata.sections).toContain("sceneObjects");
  });
});
