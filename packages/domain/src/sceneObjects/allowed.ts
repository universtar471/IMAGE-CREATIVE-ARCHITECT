/**
 * Which objects a target space allows, and where they may stand (SRS §7.1 table, ADR-036).
 *
 * The space kind comes from the Space Catalog (zone, category and a few stable preset ids);
 * the catalog itself is read only. Exterior shots may also target the street frontage
 * (`SITE_FRONTAGE_TARGET`), whose road comes from the site front boundary.
 *
 * | kind           | allowed                          | condition                                  |
 * |----------------|----------------------------------|--------------------------------------------|
 * | bedroom/living | people, pets, plants             | never cars or motorbikes                   |
 * | frontage       | people, cars, motorbikes, bikes  | vehicles only on the existing road/sidewalk |
 * | garage         | cars, motorbikes, people         | when the bay has enough room               |
 * | villa_yard     | parked vehicles, people, pets, plants | vehicles on driveway/hardscape only   |
 * | pool           | people only                      | no vehicles                                |
 * | lobby          | people, plants                   |                                            |
 */
import { isConfirmed } from "../facts/evidence";
import type { ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import type { SpaceInstance } from "../schemas/extensions";
import { resolveSiteAdjacency } from "../site/adjacency";
import { resolveActiveSpace } from "../spaceCatalog/resolve";
import type { SpacePreset } from "../spaceCatalog/schemas";
import {
  SCENE_OBJECT_TYPES,
  type PlacementZoneId,
  type SceneObjectState,
  type SceneObjectType,
} from "./schemas";

/** Target id of the street frontage of an exterior shot (not a catalog space). */
export const SITE_FRONTAGE_TARGET = "site.frontage";

export const SCENE_SPACE_KINDS = [
  "bedroom",
  "living",
  "lobby",
  "garage",
  "pool",
  "villa_yard",
  "frontage",
  "interior_other",
  "outdoor_other",
  "custom",
] as const;
export type SceneSpaceKind = (typeof SCENE_SPACE_KINDS)[number];

const GARAGE_PRESETS = new Set(["townhouse.special.gara_tang_tret", "villa.service.gara"]);
const POOL_PRESETS = new Set([
  "villa.outdoor.ho_boi",
  "resort.outdoor.ho_boi_chung",
  "resort.outdoor.ho_boi_rieng",
]);
const LOBBY_PRESETS = new Set([
  "hotel.living.sanh_don",
  "hotel.living.quay_le_tan",
  "hotel.living.lobby_lounge",
  "hotel.living.khu_cho",
  "hotel.living.sanh_thang_may",
  "resort.living.arrival_pavilion",
  "resort.living.lobby_mo",
  "resort.living.lounge_nghi_duong",
  "resort.living.khu_cho",
]);
/** A townhouse front yard sits on the street: it follows the frontage rules. */
const FRONTAGE_PRESETS = new Set(["townhouse.outdoor.san_truoc_nho"]);

/** The space kind of a catalog preset (`custom` for a custom or unknown preset). */
export function sceneSpaceKind(preset: SpacePreset | null): SceneSpaceKind {
  if (!preset) return "custom";
  if (GARAGE_PRESETS.has(preset.id)) return "garage";
  if (POOL_PRESETS.has(preset.id)) return "pool";
  if (LOBBY_PRESETS.has(preset.id)) return "lobby";
  if (FRONTAGE_PRESETS.has(preset.id)) return "frontage";
  if (preset.zone === "interior") {
    if (preset.category === "sleeping") return "bedroom";
    if (preset.category === "living") return "living";
    return "interior_other";
  }
  if (
    preset.zone === "exterior" &&
    preset.category === "outdoor" &&
    preset.buildingArchetypes.includes("villa")
  )
    return "villa_yard";
  return "outdoor_other";
}

/**
 * Space facts the placement rules read (`SpaceInstance.facts`, boolean values): a driveway
 * or hardscape of a villa yard, the bay of a garage. The space wizard edits them with an
 * evidence badge; the validator never assumes them.
 */
export const SPACE_PLACEMENT_FACTS = ["driveway", "hardscape", "garage_bay"] as const;
export type SpacePlacementFact = (typeof SPACE_PLACEMENT_FACTS)[number];

const PLACEMENT_FACTS_BY_KIND: Partial<Record<SceneSpaceKind, readonly SpacePlacementFact[]>> = {
  villa_yard: ["driveway", "hardscape"],
  garage: ["garage_bay"],
};

/** The placement facts that matter for a preset's space kind (none for most spaces). */
export function placementFactsFor(preset: SpacePreset | null): readonly SpacePlacementFact[] {
  return PLACEMENT_FACTS_BY_KIND[sceneSpaceKind(preset)] ?? [];
}

/** Allowed zones per object type; the first zone is the default. Absent type = not allowed. */
type KindRule = Partial<Record<SceneObjectType, readonly PlacementZoneId[]>>;

const HOME_ROOM: KindRule = { person: ["floor"], pet: ["floor"], plant: ["floor"] };
const VEHICLE_YARD: readonly PlacementZoneId[] = ["driveway", "hardscape"];
const STREET: readonly PlacementZoneId[] = ["existing_road", "sidewalk"];

export const SCENE_OBJECT_TABLE: Readonly<Record<SceneSpaceKind, KindRule>> = {
  bedroom: HOME_ROOM,
  living: HOME_ROOM,
  lobby: { person: ["floor"], plant: ["floor"] },
  garage: { car: ["garage_bay"], motorbike: ["garage_bay"], person: ["floor"] },
  pool: { person: ["pool_deck"] },
  villa_yard: {
    car: VEHICLE_YARD,
    motorbike: VEHICLE_YARD,
    bicycle: VEHICLE_YARD,
    person: ["garden", "hardscape"],
    pet: ["garden", "hardscape"],
    plant: ["garden", "hardscape"],
  },
  frontage: {
    person: ["sidewalk", "existing_road"],
    car: ["existing_road"],
    motorbike: STREET,
    bicycle: STREET,
  },
  interior_other: { person: ["floor"], plant: ["floor"] },
  outdoor_other: { person: ["ground"], pet: ["ground"], plant: ["ground"] },
  custom: { person: ["floor"], plant: ["floor"] },
};

/** Zones where a vehicle may be shown moving; elsewhere vehicles are parked only. */
export const MOVING_VEHICLE_ZONES: readonly PlacementZoneId[] = ["existing_road"];

export type SceneTarget = {
  id: string;
  kind: SceneSpaceKind;
  /** The DNA space; `null` for the street frontage. */
  space: SpaceInstance | null;
  preset: SpacePreset | null;
};

/**
 * The target of an object request. The frontage exists only for exterior project types;
 * `null` when the id names no space of the DNA.
 */
export function resolveSceneTarget(
  dna: Pick<ProjectDNA, "spaceCatalog">,
  projectType: ProjectType,
  targetSpaceId: string,
): SceneTarget | null {
  if (targetSpaceId === SITE_FRONTAGE_TARGET)
    return projectType === "interior"
      ? null
      : { id: targetSpaceId, kind: "frontage", space: null, preset: null };
  const active = resolveActiveSpace(dna, { targetSpaceId });
  if (!active) return null;
  return {
    id: targetSpaceId,
    kind: sceneSpaceKind(active.preset),
    space: active.space,
    preset: active.preset,
  };
}

export type ObjectTypeRule = {
  type: SceneObjectType;
  allowed: boolean;
  /** Allowed zones, default first; empty when the type is not allowed. */
  zones: readonly PlacementZoneId[];
};

/** The §7.1 rule of a space kind for every object type, in catalog order. */
export function allowedObjectsForKind(kind: SceneSpaceKind): ObjectTypeRule[] {
  const rule = SCENE_OBJECT_TABLE[kind];
  return SCENE_OBJECT_TYPES.map((type) => {
    const zones = rule[type] ?? [];
    return { type, allowed: zones.length > 0, zones };
  });
}

export function isObjectAllowed(kind: SceneSpaceKind, type: SceneObjectType): boolean {
  return (SCENE_OBJECT_TABLE[kind][type]?.length ?? 0) > 0;
}

export function defaultZone(kind: SceneSpaceKind, type: SceneObjectType): PlacementZoneId | null {
  return SCENE_OBJECT_TABLE[kind][type]?.[0] ?? null;
}

/** False for a vehicle shown moving outside a road (a parked-only zone). */
export function stateAllowed(
  type: SceneObjectType,
  zone: PlacementZoneId,
  state: SceneObjectState,
): boolean {
  if (state !== "moving") return true;
  if (type === "plant") return false;
  if (type === "car" || type === "motorbike" || type === "bicycle")
    return MOVING_VEHICLE_ZONES.includes(zone);
  return true;
}

// ---------------------------------------------------------------- zone evidence

/**
 * - `verified`: the zone is confirmed in the project data.
 * - `plausible`: it is recorded but not confirmed (inferred / unknown evidence), or it is the
 *   space itself (a garage bay of an unmeasured garage).
 * - `absent`: nothing in the data says the zone exists; the prompt must never create it.
 */
export type ZoneStatus = "verified" | "plausible" | "absent";

const factStatus = (space: SpaceInstance | null, key: string): ZoneStatus => {
  const fact = space && Object.hasOwn(space.facts, key) ? space.facts[key] : undefined;
  if (!fact || fact.value === false || fact.value === null) return "absent";
  return isConfirmed(fact.evidence) ? "verified" : "plausible";
};

const confirmedNumber = (space: SpaceInstance, key: string): number | null => {
  const fact = Object.hasOwn(space.facts, key) ? space.facts[key] : undefined;
  return fact && isConfirmed(fact.evidence) && typeof fact.value === "number" && fact.value > 0
    ? fact.value
    : null;
};

/** Confirmed plan size of a space (metres), or `null` when either side is unmeasured. */
export function confirmedFootprint(space: SpaceInstance | null): { w: number; d: number } | null {
  if (!space) return null;
  const w = confirmedNumber(space, "widthM");
  const d = confirmedNumber(space, "depthM");
  return w && d ? { w, d } : null;
}

/** The evidence for a zone of a target. Only zones a vehicle needs are checked. */
export function placementZoneStatus(
  dna: Pick<ProjectDNA, "site" | "context">,
  projectType: ProjectType,
  target: SceneTarget,
  zone: PlacementZoneId,
): ZoneStatus {
  switch (zone) {
    case "garage_bay": {
      if (target.kind !== "garage") return "absent";
      const fact = factStatus(target.space, "garage_bay");
      if (fact === "verified" || confirmedFootprint(target.space)) return "verified";
      return "plausible";
    }
    case "driveway":
    case "hardscape":
      return factStatus(target.space, zone);
    case "existing_road":
    case "sidewalk": {
      const front = resolveSiteAdjacency(dna, projectType).front;
      if (front.kind !== "street") return "absent";
      return isConfirmed(front.evidence) ? "verified" : "plausible";
    }
    default:
      return "verified";
  }
}
