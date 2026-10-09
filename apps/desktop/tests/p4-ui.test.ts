import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createProject } from "../src/app/services";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { applyGradePixel, neutralGrade } from "../src/lib/grade";
import { adoptMoodPreset, buildMoodVariationItems } from "../src/features/mood/variation";
import { en } from "../src/i18n/en";
import { vi } from "../src/i18n/vi";
import { asset } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
});
afterEach(() => setTransport(null));

describe("P4 grade and mood UI helpers", () => {
  it("keeps neutral grade pixel identity and changes a warm pixel", () => {
    expect(applyGradePixel([12, 80, 200], neutralGrade())).toEqual([12, 80, 200]);
    expect(
      applyGradePixel([120, 100, 80], { ...neutralGrade(), temperature: 100 })[0],
    ).toBeGreaterThan(120);
  });

  it("builds one variation item per preset and preserves the source first", async () => {
    const p = await createProject({
      name: "Mood",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    db.assets.SOURCE = asset(p.id, "SOURCE", { role: "master_architecture" });
    db.projects[p.id]!.activeMasterAssetId = "SOURCE";
    const b = await call("project_get", { projectId: p.id });
    const items = buildMoodVariationItems({
      dna: b.dna,
      project: b.project,
      pack: null,
      assets: b.assets,
      sourceAssetId: "SOURCE",
      model: { imageToImage: true, maxReferenceImages: 4 },
      params: { aspectRatio: "1:1", imageSize: null, outputCount: 1, seed: null, quality: null },
      presets: [
        { id: "rain", label: "Rain", values: { weather: { preset: "Rain" } } },
        { id: "blue", label: "Blue hour", values: { lighting: { timeOfDay: "blue_hour" } } },
      ],
    });
    expect(items.map((x) => x.label)).toEqual(["Rain", "Blue hour"]);
    expect(items.every((x) => x.referenceAssetIds[0] === "SOURCE")).toBe(true);
    expect(items[0]!.prompt.preservationInstructions).toMatch(/change only light/);
  });

  it("adopts unlocked mood sections and leaves locked lighting unchanged", async () => {
    const p = await createProject({
      name: "Mood",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const dna = (await call("project_get", { projectId: p.id })).dna;
    const next = adoptMoodPreset(
      { ...dna, locks: { ...dna.locks, lighting: true } },
      {
        id: "rain",
        label: "Rain",
        values: {
          lighting: { timeOfDay: "night" },
          weather: { preset: "Rain" },
          mood: { preset: "Rain" },
        },
      },
    );
    expect(next.lighting).toEqual(dna.lighting);
    expect(next.weather?.preset).toBe("Rain");
    expect(next.mood?.preset).toBe("Rain");
  });
});

describe("mock grade_apply", () => {
  it("creates a new asset and version without mutating the source", async () => {
    const p = await createProject({
      name: "Grade",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    db.assets.SOURCE = asset(p.id, "SOURCE", { role: "master_architecture" });
    db.projects[p.id]!.activeMasterAssetId = "SOURCE";
    const before = structuredClone(db.assets.SOURCE);
    const created = await call("grade_apply", {
      projectId: p.id,
      assetId: "SOURCE",
      grade: neutralGrade(),
      label: "Neutral",
    });
    expect(created.id).not.toBe("SOURCE");
    expect(created.parentAssetId).toBe("SOURCE");
    expect(created.operation).toBe("color_grade");
    expect(db.assets.SOURCE).toEqual(before);
    expect(
      (await call("version_list", { projectId: p.id })).some(
        (v) => v.assetId === created.id && v.operation === "color_grade",
      ),
    ).toBe(true);
  });
});

describe("P4 i18n parity", () => {
  it("has every new UI key in English and Vietnamese", () => {
    expect(Object.keys(en.lighting)).toEqual(Object.keys(vi.lighting));
    expect(Object.keys(en.moodGrade)).toEqual(Object.keys(vi.moodGrade));
  });
});
