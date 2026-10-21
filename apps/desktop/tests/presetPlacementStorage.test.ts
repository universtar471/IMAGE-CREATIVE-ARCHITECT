import { afterEach, expect, it } from "vitest";
import { loadShotIntent, saveShotIntent, clearShotIntent } from "../src/lib/shotIntentStorage";

afterEach(() => clearShotIntent("placement-upgrade"));

it("upgrades saved preset cars while retaining explicit and manual placements", () => {
  const car = {
    presetId: "car.generic.vn_city_car",
    targetSpaceId: "site_frontage",
    quantity: 1,
    state: "static" as const,
    sourceReferenceIds: [],
  };
  saveShotIntent("placement-upgrade", {
    projectType: "townhouse",
    presetIds: ["cars.city_car"],
    sceneObjects: [car, { ...car, placementZoneId: "existing_road" }, { ...car }],
  });
  const objects = loadShotIntent("placement-upgrade")!.sceneObjects!;
  expect(objects[0]!.autoPlacement).toBe(true);
  expect(objects[1]!.autoPlacement).toBeUndefined();
  expect(objects[2]!.autoPlacement).toBeUndefined();
});
