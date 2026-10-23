import { describe, expect, it } from "vitest";
import {
  cameraPresetsFor,
  cameraScopeFromDna,
  cameraPosition,
  normalizeAzimuth,
  normalizeCameraPose,
  samePose,
} from "../src/features/camera/multiAngleModel";

describe("Multi-Angle Camera M1 domain", () => {
  it("keeps interior and building presets strictly separate", () => {
    const interior = cameraPresetsFor("interior");
    const building = cameraPresetsFor("building");
    expect(interior.length).toBe(4);
    expect(building.length).toBe(4);
    expect(interior.every((p) => p.scope === "interior")).toBe(true);
    expect(building.every((p) => p.scope === "building")).toBe(true);
    expect(new Set(interior.map((p) => p.id)).size).toBe(4);
    expect(interior.some((p) => building.some((b) => b.id === p.id))).toBe(false);
  });
  it("derives building scope from DNA without an interior scene", () => {
    expect(cameraScopeFromDna({})).toBe("building");
  });
  it("normalizes azimuth and clamps unsafe camera parameters", () => {
    expect(normalizeAzimuth(405)).toBe(45);
    expect(normalizeAzimuth(-405)).toBe(-45);
    expect(normalizeAzimuth(Number.NaN)).toBe(0);
    expect(
      normalizeCameraPose({ azimuthDeg: 720, elevationDeg: 100, distanceM: -12 }, "interior"),
    ).toEqual({ azimuthDeg: 0, elevationDeg: 75, distanceM: 0.5 });
    expect(
      normalizeCameraPose({ azimuthDeg: 0, elevationDeg: -100, distanceM: Infinity }, "building"),
    ).toEqual({ azimuthDeg: 0, elevationDeg: -75, distanceM: 15 });
  });
  it("preserves the positive clockwise azimuth camera convention", () => {
    const front = cameraPosition({ azimuthDeg: 0, elevationDeg: 0, distanceM: 10 });
    const clockwise = cameraPosition({ azimuthDeg: 90, elevationDeg: 0, distanceM: 10 });
    expect(front.x).toBeCloseTo(0);
    expect(front.y).toBeCloseTo(10);
    expect(clockwise.x).toBeCloseTo(-10);
    expect(clockwise.y).toBeCloseTo(0);
  });
  it("labels left/right according to Camera Director's clockwise convention", () => {
    const presets = cameraPresetsFor("building");
    const left = presets.find((p) => p.id === "front_left")!;
    const right = presets.find((p) => p.id === "front_right")!;
    expect(left.pose.azimuthDeg).toBe(45);
    expect(right.pose.azimuthDeg).toBe(-45);
    expect(cameraPosition(left.pose).x).toBeLessThan(0);
    expect(cameraPosition(right.pose).x).toBeGreaterThan(0);
  });
  it("does not mutate preset defaults", () => {
    const original = cameraPresetsFor("building")[0]!.pose;
    expect(samePose(normalizeCameraPose(original, "building"), original)).toBe(true);
  });
});
