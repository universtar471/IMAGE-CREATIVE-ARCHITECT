import { describe, expect, it } from "vitest";
import {
  GRADE_LOOKS,
  KnowledgeRegistry,
  LightingDNASchema,
  MoodPresetSchema,
  ProjectDNASchema,
  adoptMoodPreset,
  applyGradePixel,
  applyGradeToImageData,
  buildMoodVariationItems,
  compilePrompt,
  createInitialDNA,
  newLightingId,
} from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();

describe("phase 4 schemas and packs", () => {
  it("accepts new lighting fields and generates a valid light id", () => {
    const id = newLightingId();
    expect(id).toMatch(/^LGT_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(
      LightingDNASchema.parse({
        schemaVersion: 1,
        timeOfDay: "blue_hour",
        artificialLighting: [{ id, type: "uplight", zone: "facade_uplights", enabled: true }],
      }).artificialLighting[0]?.enabled,
    ).toBe(true);
  });

  it("ships the required preset counts and resolves inherited lists", () => {
    for (const pack of registry.listSubtypes("villa")) {
      expect(pack.lightingPresets.length).toBeGreaterThanOrEqual(4);
      expect(pack.weatherPresets.length).toBeGreaterThanOrEqual(3);
      expect(pack.moodPresets.length).toBeGreaterThanOrEqual(4);
      expect(new Set(pack.moodPresets.map((p) => p.id)).size).toBe(pack.moodPresets.length);
      for (const preset of pack.moodPresets)
        expect(MoodPresetSchema.parse(preset).values).toEqual(preset.values);
    }
    expect(registry.weatherPresets("villa", "tropical").map((p) => p.id)).toContain("monsoon_rain");
    expect(registry.lightingPresets("urban_villa").map((p) => p.id)).toContain("night_street");
  });
});

describe("phase 4 compiler and mood batches", () => {
  it("emits deterministic lighting/weather/mood sections and lock lines", () => {
    const dna = createInitialDNA({ projectType: "villa", pack: registry.resolve("villa").pack });
    dna.lighting = {
      schemaVersion: 1,
      timeOfDay: "night",
      artificialLighting: [
        { type: "LED", temperatureK: 2700, intensity: "medium", zone: "pool", enabled: true },
      ],
    };
    dna.weather = { schemaVersion: 1, sky: "rain clouds", notes: "" };
    dna.mood = { schemaVersion: 1, atmosphere: "cinematic", notes: "" };
    dna.locks.mood = true;
    const bundle = compilePrompt({
      project: { id: "PRJ_X", name: "X", projectType: "villa" },
      dna,
      references: [],
    });
    expect(bundle.metadata.sections).toEqual(
      expect.arrayContaining(["lighting", "weather", "mood"]),
    );
    expect(bundle.positivePrompt).toMatch(/pool at 2700K, medium/);
    expect(bundle.preservationInstructions).toMatch(/Mood DNA is LOCKED/);
  });

  it("adopts unlocked moods and skips locked ones", () => {
    const dna = createInitialDNA({ projectType: "villa", pack: registry.resolve("villa").pack });
    const preset = registry.moodPresets("villa")[0]!;
    expect(adoptMoodPreset(dna, preset).mood?.presetId).toBe(preset.id);
    dna.locks.mood = true;
    expect(adoptMoodPreset(dna, preset).mood).toBeUndefined();
    expect(ProjectDNASchema.parse(dna)).toEqual(dna);
  });

  it("builds one source-preserving item per mood preset", () => {
    const pack = registry.resolve("villa").pack!;
    const dna = createInitialDNA({ projectType: "villa", pack });
    const presets = pack.moodPresets.slice(0, 2);
    const items = buildMoodVariationItems({
      project: { id: "PRJ_X", name: "X", projectType: "villa" },
      dna,
      pack,
      assets: [{ id: "AST_M", role: "master_architecture", status: "ready" }],
      masterAssetId: "AST_M",
      sourceAssetId: "AST_M",
      presets,
      model: {
        id: "m",
        label: "Model",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 1,
        maxOutputs: 4,
        aspectRatios: [],
        imageSizes: [],
        supportsNegativePrompt: true,
        supportsSeed: false,
        qualityOptions: [],
        priceHint: null,
        vision: false,
      },
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
    });
    expect(items.map((item) => item.label)).toEqual(presets.map((preset) => preset.label));
    expect(items.every((item) => item.referenceAssetIds[0] === "AST_M")).toBe(true);
    expect(items[0]?.prompt.preservationInstructions).toMatch(
      /change only light, weather and atmosphere/,
    );
  });

  it("treats a selected output as the master reference for mood variations", () => {
    const pack = registry.resolve("villa").pack!;
    const dna = createInitialDNA({ projectType: "villa", pack });
    const [item] = buildMoodVariationItems({
      project: { id: "PRJ_X", name: "X", projectType: "villa" },
      dna,
      pack,
      assets: [
        { id: "AST_M", role: "master_architecture", status: "ready" },
        { id: "AST_OUTPUT", role: "regular_image", status: "ready", originalName: "output.png" },
      ],
      masterAssetId: "AST_M",
      sourceAssetId: "AST_OUTPUT",
      presets: [pack.moodPresets[0]!],
      model: {
        id: "m",
        label: "Model",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 1,
        maxOutputs: 4,
        aspectRatios: [],
        imageSizes: [],
        supportsNegativePrompt: true,
        supportsSeed: false,
        qualityOptions: [],
        priceHint: null,
        vision: false,
      },
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
    });

    expect(item!.prompt.referenceInstructions).toMatch(/^Image 1 \(output\.png\) is the MASTER/);
    expect(item!.prompt.preservationInstructions).toMatch(/Preserve the architecture of Image 1/);
    expect(item!.prompt.metadata.referenceRoles).toEqual({ master_architecture: 1 });
  });

  it("loads mood lighting and weather values and respects locks when varying and adopting", () => {
    const loaded = new KnowledgeRegistry([
      {
        source: "villa/test",
        data: {
          packVersion: "1.2.0",
          projectType: "villa",
          subtype: "test",
          label: "Test villa",
          moodPresets: [
            {
              id: "blue_rain",
              label: "Blue rain",
              tags: ["blue", "rain"],
              values: {
                atmosphere: "quiet rainy evening",
                lighting: { timeOfDay: "blue_hour", intensity: "soft" },
                weather: { sky: "monsoon clouds", groundWetness: "soaked" },
              },
            },
          ],
        },
      },
    ]);
    expect(loaded.issues).toEqual([]);
    const pack = loaded.resolve("villa", "test").pack!;
    const preset = pack.moodPresets[0]!;
    expect(preset.values).toMatchObject({
      atmosphere: "quiet rainy evening",
      lighting: { timeOfDay: "blue_hour", intensity: "soft" },
      weather: { sky: "monsoon clouds", groundWetness: "soaked" },
    });

    const dna = createInitialDNA({ projectType: "villa", pack });
    dna.lighting = { schemaVersion: 1, timeOfDay: "midday", artificialLighting: [] };
    dna.weather = { schemaVersion: 1, sky: "clear", notes: "" };
    dna.locks.lighting = true;
    const [item] = buildMoodVariationItems({
      project: { id: "PRJ_X", name: "X", projectType: "villa" },
      dna,
      pack,
      assets: [{ id: "AST_M", role: "master_architecture", status: "ready" }],
      sourceAssetId: "AST_M",
      presets: [preset],
      model: {
        id: "m",
        label: "Model",
        textToImage: true,
        imageToImage: true,
        maxReferenceImages: 1,
        maxOutputs: 4,
        aspectRatios: [],
        imageSizes: [],
        supportsNegativePrompt: true,
        supportsSeed: false,
        qualityOptions: [],
        priceHint: null,
        vision: false,
      },
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
    });
    expect(item!.prompt.positivePrompt).toMatch(/Lighting: midday/);
    expect(item!.prompt.positivePrompt).not.toMatch(/blue hour/);
    expect(item!.prompt.positivePrompt).toMatch(/Weather: monsoon clouds.*soaked/);
    expect(item!.prompt.positivePrompt).toMatch(/Mood: quiet rainy evening/);

    const adopted = adoptMoodPreset(dna, preset);
    expect(adopted.lighting).toEqual(dna.lighting);
    expect(adopted.weather).toMatchObject({ sky: "monsoon clouds", groundWetness: "soaked" });
    expect(adopted.mood).toMatchObject({
      presetId: "blue_rain",
      preset: "Blue rain",
      atmosphere: "quiet rainy evening",
    });

    const fullyLocked = structuredClone(dna);
    fullyLocked.locks.weather = true;
    fullyLocked.locks.mood = true;
    fullyLocked.mood = { schemaVersion: 1, atmosphere: "original mood", notes: "" };
    const lockedAdoption = adoptMoodPreset(fullyLocked, preset);
    expect(lockedAdoption.lighting).toEqual(fullyLocked.lighting);
    expect(lockedAdoption.weather).toEqual(fullyLocked.weather);
    expect(lockedAdoption.mood).toEqual(fullyLocked.mood);
  });
});

describe("grade math", () => {
  it("keeps identity exact and alpha unchanged", () => {
    const grade = GRADE_LOOKS.neutral;
    expect(applyGradePixel([0, 127, 255], grade)).toEqual([0, 127, 255]);
    const data = new Uint8ClampedArray([0, 127, 255, 37, 80, 90, 100, 99]);
    applyGradeToImageData(data, grade);
    expect([...data]).toEqual([0, 127, 255, 37, 80, 90, 100, 99]);
  });

  it("returns a graded buffer without mutating the source by default", () => {
    const source = new Uint8ClampedArray([20, 80, 140, 37, 220, 160, 100, 99]);
    const before = new Uint8ClampedArray(source);
    const output = applyGradeToImageData(source, GRADE_LOOKS.warm_tropical);

    expect(output).not.toBe(source);
    expect([...source]).toEqual([...before]);
    expect([...output]).not.toEqual([...before]);
    expect([output[3], output[7]]).toEqual([37, 99]);
  });

  it("supports an explicit in-place output buffer", () => {
    const data = new Uint8ClampedArray([20, 80, 140, 37]);
    expect(applyGradeToImageData(data, GRADE_LOOKS.warm_tropical, data)).toBe(data);
    expect([...data]).not.toEqual([20, 80, 140, 37]);
    expect(data[3]).toBe(37);
  });
});
