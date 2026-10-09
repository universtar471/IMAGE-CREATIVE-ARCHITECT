import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { COMPILER_VERSION, type BatchDTO, type GenerationDTO, type JobDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { applyGradePixel, neutralGrade } from "../src/lib/grade";
import {
  adoptMoodPreset,
  adoptMoodPresetSections,
  buildMoodVariationItems,
} from "../src/features/mood/variation";
import { adoptContactMood } from "../src/features/camera/ContactSheet";
import { ContactSheet } from "../src/features/camera/ContactSheet";
import { resolveMoodPreset } from "../src/features/camera/contactGroups";
import {
  MoodGradePanel,
  presetSelectValue,
  weatherPresetValues,
} from "../src/features/mood/MoodGradePanel";
import { en } from "../src/i18n/en";
import { vi } from "../src/i18n/vi";
import { asset, deferredTransport, waitFor } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

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
          atmosphere: "Rain",
        },
      },
    );
    expect(next.lighting).toEqual(dna.lighting);
    expect(next.weather?.preset).toBe("Rain");
    expect(next.mood?.preset).toBe("Rain");
  });

  it("returns every unlocked section changed by a preset", async () => {
    const p = await createProject({
      name: "Mood sections",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const dna = (await call("project_get", { projectId: p.id })).dna;
    const preset = {
      id: "blue-hour",
      label: "Blue hour",
      values: {
        lighting: { timeOfDay: "blue_hour" },
        weather: { haze: "high" },
        atmosphere: "cinematic",
      },
    };
    const sections = adoptMoodPresetSections(dna, preset);
    expect(sections.lighting?.timeOfDay).toBe("blue_hour");
    expect(sections.weather?.haze).toBe("high");
    expect(sections.mood?.atmosphere).toBe("cinematic");
  });

  it("resolves a mood variation label to its preset id", () => {
    expect(resolveMoodPreset("Blue hour", [{ id: "mood.blue", label: "Blue hour" }])).toEqual({
      id: "mood.blue",
      label: "Blue hour",
    });
  });

  it("adopts the preset selected from a Contact Sheet group", async () => {
    const p = await createProject({
      name: "Contact mood",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const dna = (await call("project_get", { projectId: p.id })).dna;
    const next = adoptContactMood(dna, {
      id: "rain",
      label: "Rain",
      values: { weather: { haze: "high" } },
    });
    expect(next.weather?.haze).toBe("high");
  });

  it("uses preset ids, never preset labels, for section selectors", () => {
    expect(presetSelectValue({ presetId: "mood.blue", preset: "Blue hour" })).toBe("mood.blue");
  });

  it("merges weather preset values as a direct section partial", () => {
    expect(weatherPresetValues({ id: "rain", label: "Rain", values: { haze: "high" } })).toEqual({
      haze: "high",
    });
  });

  it("adopts all unlocked sections from the Mood / Grade panel", async () => {
    const p = await createProject({
      name: "Mood panel",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(p.id);
    render(createElement(MoodGradePanel));

    fireEvent.change(screen.getByLabelText("Mood preset"), { target: { value: "cinematic" } });
    const next = useStudio.getState().workspace!.draftDna;
    expect(next.mood?.atmosphere).toBe("cinematic tropical dusk");
    expect(next.lighting?.timeOfDay).toBe("blue_hour");
    expect(next.weather?.haze).toBe("light");
  });

  it("skips locked lighting and weather when Mood / Grade adopts a preset", async () => {
    const p = await createProject({
      name: "Locked mood panel",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(p.id);
    const before = useStudio.getState().workspace!.draftDna;
    useStudio.getState().editDna("locks", { ...before.locks, lighting: true, weather: true });
    render(createElement(MoodGradePanel));

    fireEvent.change(screen.getByLabelText("Mood preset"), { target: { value: "cinematic" } });
    const next = useStudio.getState().workspace!.draftDna;
    expect(next.mood?.atmosphere).toBe("cinematic tropical dusk");
    expect(next.lighting).toEqual(before.lighting);
    expect(next.weather).toEqual(before.weather);
  });

  it("merges direct weather preset values when its picker is used", async () => {
    const p = await createProject({
      name: "Weather picker",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(p.id);
    render(createElement(MoodGradePanel));

    fireEvent.change(screen.getByLabelText("Weather preset"), {
      target: { value: "monsoon_rain" },
    });
    expect(useStudio.getState().workspace!.draftDna.weather).toMatchObject({
      presetId: "monsoon_rain",
      sky: "heavy monsoon rain",
      groundWetness: "soaked",
      haze: "rain mist",
    });
  });

  it("updates lighting, weather, and mood when Contact Sheet adopts a variation", async () => {
    const p = await createProject({
      name: "Contact panel",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(p.id);
    const ws = useStudio.getState().workspace!;
    const batch = {
      id: "BAT_MOOD",
      projectId: p.id,
      name: "Mood variations",
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation",
      createdAt: "2026-10-09T00:00:00Z",
      jobIds: ["JOB_MOOD"],
      counts: {
        queued: 0,
        running: 0,
        retrying: 0,
        completed: 1,
        failed: 0,
        cancelled: 0,
        interrupted: 0,
      },
    } satisfies BatchDTO;
    const generation = {
      id: "GEN_MOOD",
      projectId: p.id,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      purpose: "variation",
      status: "completed",
      prompt: {
        compilerVersion: COMPILER_VERSION,
        positivePrompt: "",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
      referenceAssetIds: [],
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
      parentAssetId: null,
      outputAssetIds: ["OUT_MOOD"],
      error: null,
      cameraId: null,
      batchId: batch.id,
      jobId: "JOB_MOOD",
      createdAt: "2026-10-09T00:00:00Z",
      startedAt: "2026-10-09T00:00:00Z",
      finishedAt: "2026-10-09T00:00:01Z",
      durationMs: 1000,
    } satisfies GenerationDTO;
    const job = {
      id: "JOB_MOOD",
      projectId: p.id,
      batchId: batch.id,
      generationId: generation.id,
      cameraId: null,
      providerId: "local_preview",
      modelId: "placeholder-v1",
      label: "Cinematic dusk",
      status: "completed",
      priority: 0,
      attempt: 1,
      maxAttempts: 1,
      nextAttemptAt: null,
      error: null,
      createdAt: "2026-10-09T00:00:00Z",
      startedAt: "2026-10-09T00:00:00Z",
      finishedAt: "2026-10-09T00:00:01Z",
    } satisfies JobDTO;
    useStudio.setState({
      workspace: {
        ...ws,
        batches: [batch],
        generations: [generation],
        assets: [...ws.assets, asset(p.id, "OUT_MOOD")],
      },
      jobs: [job],
      contactBatchId: batch.id,
    });
    render(createElement(ContactSheet));

    fireEvent.click(screen.getByRole("button", { name: "Adopt this mood" }));
    const next = useStudio.getState().workspace!.draftDna;
    expect(next.mood?.atmosphere).toBe("cinematic tropical dusk");
    expect(next.lighting?.timeOfDay).toBe("blue_hour");
    expect(next.weather?.haze).toBe("light");
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

  it("does not select a grade result after switching projects", async () => {
    const first = await createProject({
      name: "First",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const second = await createProject({
      name: "Second",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    db.assets.SOURCE_A = asset(first.id, "SOURCE_A", { role: "master_architecture" });
    db.assets.SOURCE_B = asset(second.id, "SOURCE_B", { role: "master_architecture" });
    db.projects[first.id]!.activeMasterAssetId = "SOURCE_A";
    db.projects[second.id]!.activeMasterAssetId = "SOURCE_B";
    const delayed = deferredTransport(createMockTransport(db));
    delayed.hold("grade_apply");
    setTransport(delayed.transport);
    await useStudio.getState().openProject(first.id);
    const pending = useStudio.getState().applyGrade(neutralGrade());
    await waitFor(() => delayed.pending("grade_apply") === 1, "grade_apply request");
    await useStudio.getState().openProject(second.id);
    delayed.release("grade_apply");
    const created = await pending;
    expect(created).toBeDefined();
    expect(useStudio.getState().workspace?.project.id).toBe(second.id);
    expect(useStudio.getState().selectedAssetId).toBe("SOURCE_B");
  });
});

describe("P4 i18n parity", () => {
  it("has every new UI key in English and Vietnamese", () => {
    expect(Object.keys(en.lighting)).toEqual(Object.keys(vi.lighting));
    expect(Object.keys(en.moodGrade)).toEqual(Object.keys(vi.moodGrade));
  });
});
