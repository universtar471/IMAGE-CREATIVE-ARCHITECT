import { describe, expect, it } from "vitest";
import {
  anchorViews,
  blankCamera,
  cameraFromPreset,
  cameraReadiness,
  cameraWorkflowReadiness,
  CameraDNASchema,
  createInitialDNA,
  createUlidGenerator,
  duplicateCamera,
  isStableId,
  newCameraId,
  uniqueCameraName,
  validateCamera,
  validateProjectDNA,
  type CameraDNA,
  type CameraPreset,
} from "../src";
import { loadSeedRegistry } from "./helpers";

const registry = loadSeedRegistry();

const camId = (n: number) => `CAM_01J${String(n).padStart(23, "0")}`;

const cam = (over: Partial<CameraDNA> = {}): CameraDNA => ({
  schemaVersion: 1,
  id: camId(1),
  name: "Front",
  viewType: "exterior_front",
  isAnchorView: false,
  notes: "",
  ...over,
});

describe("ULID / camera ids", () => {
  it("creates valid CAM_ ids", () => {
    const id = newCameraId();
    expect(isStableId(id, "CAM")).toBe(true);
    expect(CameraDNASchema.shape.id.safeParse(id).success).toBe(true);
    expect(newCameraId()).not.toBe(id);
  });

  it("encodes the time prefix in Crockford base32", () => {
    const zero = createUlidGenerator(
      (b) => b.fill(0),
      () => 0,
    );
    expect(zero()).toBe("0".repeat(26));
    const max = createUlidGenerator(
      (b) => b.fill(255),
      () => 2 ** 48 - 1,
    );
    expect(max()).toBe("7ZZZZZZZZZ" + "Z".repeat(16));
    expect(createUlidGenerator(undefined, () => 1_469_918_176_385)().slice(0, 10)).toBe(
      "01ARYZ6S41",
    );
  });

  it("is time-ordered and monotonic within one millisecond", () => {
    let t = 1_700_000_000_000;
    const gen = createUlidGenerator(undefined, () => t);
    const ids = [gen(), gen(), gen()];
    t += 1;
    ids.push(gen());
    t -= 5; // a clock going backwards must not break ordering
    ids.push(gen());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("increments the random part with carry", () => {
    const full = createUlidGenerator(
      (b) => b.fill(31),
      () => 5,
    );
    full();
    expect(() => full()).toThrow(/overflow/);
    const gen = createUlidGenerator(
      (b) => b.fill(0).fill(31, 15),
      () => 5,
    );
    expect(gen().slice(10)).toBe("000000000000000Z");
    expect(gen().slice(10)).toBe("0000000000000010");
  });

  it("rejects out-of-range time", () => {
    expect(() => createUlidGenerator(undefined, () => -1)()).toThrow(RangeError);
    expect(() => createUlidGenerator(undefined, () => 2 ** 48)()).toThrow(RangeError);
  });
});

describe("camera creation", () => {
  const preset: CameraPreset = {
    id: "front_left_corner",
    label: "Front-left corner",
    viewType: "exterior_corner",
    azimuthDeg: 45,
    elevationDeg: 0,
    heightM: 1.6,
    distanceM: 25,
    lensMm: 24,
    aspectRatio: "3:2",
    composition: "two-point perspective",
    anchorRecommended: true,
  };

  it("names uniquely, case-insensitively", () => {
    expect(uniqueCameraName("Front", [])).toBe("Front");
    expect(uniqueCameraName("Front", ["front ", "Front 2"])).toBe("Front 3");
    expect(uniqueCameraName("  ", [])).toBe("Camera");
  });

  it("turns a preset into a valid camera", () => {
    const c = cameraFromPreset(preset, ["Front-left corner"], camId(7));
    expect(c).toEqual({
      schemaVersion: 1,
      id: camId(7),
      name: "Front-left corner 2",
      viewType: "exterior_corner",
      presetId: "front_left_corner",
      isAnchorView: true,
      azimuthDeg: 45,
      elevationDeg: 0,
      heightM: 1.6,
      distanceM: 25,
      lensMm: 24,
      aspectRatio: "3:2",
      composition: "two-point perspective",
      notes: "",
    });
    expect(CameraDNASchema.parse(c)).toEqual(c);
    expect(JSON.stringify(cameraFromPreset({ ...preset, composition: undefined }))).not.toContain(
      "composition",
    );
  });

  it("every seed preset makes a valid camera with a fresh id", () => {
    for (const pack of registry.listSubtypes("villa").concat(registry.listSubtypes("interior"))) {
      for (const p of pack.cameraPresets) {
        const c = cameraFromPreset(p);
        expect(CameraDNASchema.safeParse(c).success).toBe(true);
        expect(isStableId(c.id, "CAM")).toBe(true);
      }
    }
  });

  it("makes blank cameras and duplicates", () => {
    const b = blankCamera(["Camera 1"], camId(2));
    expect(b).toEqual({
      schemaVersion: 1,
      id: camId(2),
      name: "Camera 2",
      viewType: "custom",
      isAnchorView: false,
      notes: "",
    });
    expect(blankCamera([]).name).toBe("Camera 1");
    expect(CameraDNASchema.safeParse(b).success).toBe(true);

    const original = cam({ isAnchorView: true, lensMm: 24 });
    const copy = duplicateCamera(original, ["Front"], camId(3));
    expect(copy).toMatchObject({
      id: camId(3),
      name: "Front copy",
      lensMm: 24,
      isAnchorView: false,
    });
    expect(original.isAnchorView).toBe(true);
  });
});

describe("per-camera readiness", () => {
  it("lists the viewpoint fields still missing", () => {
    const missing = (c: CameraDNA) =>
      cameraReadiness(c)
        .filter((i) => !i.done)
        .map((i) => i.key);
    expect(missing(cam())).toEqual(["azimuthDeg", "elevationDeg", "distanceM", "lensMm"]);
    expect(missing(cam({ azimuthDeg: 0, heightM: 1.6, distanceM: 20, lensMm: 28 }))).toEqual([]);
    expect(cameraReadiness(cam({ viewType: "interior_wide" })).map((i) => i.key)).not.toContain(
      "azimuthDeg",
    );
  });
});

describe("anchor views and workflow readiness", () => {
  const cameras = [
    cam({ id: camId(1), name: "A", isAnchorView: true }),
    cam({ id: camId(2), name: "B" }),
    cam({ id: camId(3), name: "C", isAnchorView: true }),
  ];

  it("lists anchor views in DNA order", () => {
    expect(anchorViews({ cameras }).map((c) => c.name)).toEqual(["A", "C"]);
  });

  it("explains what is missing", () => {
    const empty = cameraWorkflowReadiness({ cameras: [] });
    expect(empty.map((i) => [i.key, i.done])).toEqual([
      ["cameras.any", false],
      ["cameras.viewpoint", true],
      ["cameras.anchorView", false],
    ]);

    const vague = cam({ id: camId(4), name: "Vague", viewType: "custom" });
    const r = cameraWorkflowReadiness(
      { cameras: [...cameras, vague] },
      { masterApproved: false, anchors: [{ cameraId: camId(1) }] },
    );
    const byKey = Object.fromEntries(r.map((i) => [i.key, i]));
    expect(byKey["cameras.viewpoint"]).toMatchObject({ done: false, detail: "Vague" });
    expect(byKey["master.approved"]?.done).toBe(false);
    expect(byKey["anchors.complete"]).toMatchObject({ done: false, detail: "C" });

    const done = cameraWorkflowReadiness(
      { cameras },
      { masterApproved: true, anchors: [{ cameraId: camId(1) }, { cameraId: camId(3) }] },
    );
    expect(done.every((i) => i.done)).toBe(true);
  });
});

describe("camera validation", () => {
  it("gives field messages for the editor", () => {
    const r = validateCamera({ ...cam(), lensMm: -5, elevationDeg: 120, name: " " });
    expect(r.ok ? {} : r.fieldErrors).toEqual({
      name: "This field cannot be empty.",
      elevationDeg: "Must be at most 90.",
      lensMm: "Must be greater than 0.",
    });
    const bad = validateCamera({ ...cam(), id: "CAM_nope", viewType: "drone" });
    expect(bad.ok ? {} : bad.fieldErrors).toEqual({
      id: "Invalid camera id.",
      viewType: "Choose a view type from the list.",
    });
  });

  it("flags a duplicate name against the other cameras", () => {
    const r = validateCamera(cam({ id: camId(2), name: "front " }), [cam()]);
    expect(r.ok ? {} : r.fieldErrors).toEqual({ name: "Another camera already uses this name." });
    expect(validateCamera(cam({ id: camId(2), name: "Side" }), [cam()]).ok).toBe(true);
  });

  it("validateProjectDNA rejects duplicate camera ids and names", () => {
    const dna = createInitialDNA({ projectType: "villa", pack: registry.resolve("villa").pack });
    const two = [cam(), cam({ id: camId(2), name: "Side" })];
    expect(validateProjectDNA({ ...dna, cameras: two }).ok).toBe(true);
    const r = validateProjectDNA({ ...dna, cameras: [cam(), cam({ name: "FRONT" })] });
    expect(r.ok ? {} : r.fieldErrors).toEqual({
      "cameras.1.id": "Another camera already uses this id.",
      "cameras.1.name": "Another camera already uses this name.",
    });
    const nested = validateProjectDNA({ ...dna, cameras: [cam({ distanceM: 0 })] });
    expect(nested.ok ? {} : nested.fieldErrors).toEqual({
      "cameras.0.distanceM": "Must be greater than 0.",
    });
  });
});
