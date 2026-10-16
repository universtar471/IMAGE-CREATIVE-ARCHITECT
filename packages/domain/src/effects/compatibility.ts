/**
 * EffectsCompatibilityMatrix (ADR-036 P2c, SRS §6.1–6.2).
 *
 * `effectsCompatibility(dna, shotIntent)` says, for every effect, whether the shot can carry
 * it: `available`, `conditional` (allowed, but the source is only plausible, so the prompt
 * words it "only where present") or `blocked` (the source is missing or contradicts the
 * shot). It reads, without editing:
 * - the space zone (Space Catalog; else the project type): a closed interior has no sky;
 * - the site: a road exists in front (or on a street corner side);
 * - the camera: a detail view may leave the sky out of frame, a top-down view weakens glare control;
 * - the weather and lighting: light trails need dusk or night, a sunstar needs a light source;
 * - the scene objects (P2d schema): light trails need a moving vehicle.
 *
 * Only data the user set or confirmed can block; a guess makes an effect `conditional`.
 * Pure and deterministic.
 */
import { isConfirmed } from "../facts/evidence";
import type { ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import type { CameraDNA } from "../schemas/future";
import type { SpaceInstance } from "../schemas/extensions";
import { resolveSiteAdjacency } from "../site/adjacency";
import { resolveActiveSpace } from "../spaceCatalog/resolve";
import { sceneSpaceKind } from "../sceneObjects/allowed";
import { sceneObjectPreset } from "../sceneObjects/catalog";
import type { SceneObjectRequest } from "../sceneObjects/schemas";
import { EFFECT_CATALOG } from "./catalog";
import type { EffectChoice, EffectId, ShotEffectsInput } from "./schemas";
import { MAX_SECONDARY_EFFECTS } from "./schemas";

export type EffectStatus = "available" | "conditional" | "blocked";

export const EFFECT_REASONS = [
  "available",
  // blocked
  "no_road",
  "no_moving_vehicle",
  "vehicles_parked",
  "needs_dark",
  "people_static",
  "no_sky",
  "no_water",
  "no_light_source",
  "sun_hidden",
  "needs_sunlight",
  "no_opening",
  // conditional
  "road_unverified",
  "time_unknown",
  "needs_dusk",
  "needs_moving_people",
  "sky_out_of_frame",
  "sky_partial",
  "water_unverified",
  "sun_through_window",
  "opening_unverified",
  "depends_on_glass",
  "camera_angle",
] as const;
export type EffectReason = (typeof EFFECT_REASONS)[number];

export type EffectBlockCode = "EFFECT_SOURCE_MISSING" | "EFFECT_MOTION_CONFLICT";

export type EffectCompatibility = {
  effectId: EffectId;
  status: EffectStatus;
  reason: EffectReason;
  /** i18n key of the plain reason (`effects.reasons.<reason>` in the desktop dictionaries). */
  reasonKey: `effects.reasons.${EffectReason}`;
  /** The conflict code a blocked effect raises in the validator. */
  code?: EffectBlockCode;
};

/** The parts of a shot intent the matrix reads. */
export type EffectShotInput = {
  projectType: ProjectType;
  cameraId?: string | null;
  targetSpaceId?: string | null;
  sceneObjects?: readonly SceneObjectRequest[] | null;
};

type Presence = "verified" | "plausible" | "absent";
type TimeClass = "dark" | "twilight" | "day" | "unknown";

/** What the shot actually contains, derived once from the DNA and the shot intent. */
export type EffectScene = {
  /** The rendered space is enclosed (an interior zone, or an interior project without catalog). */
  enclosed: boolean;
  semiOutdoor: boolean;
  road: Presence;
  water: Presence;
  time: TimeClass;
  overcast: boolean;
  artificialLights: boolean;
  /** An interior opening that lets daylight in. */
  opening: Presence;
  camera: CameraDNA | null;
  movingVehicles: number;
  parkedVehicles: number;
  movingPeople: number;
  stillPeople: number;
};

// ---------------------------------------------------------------- scene facts

const WATER_WORDS = new Set([
  "water",
  "waterfront",
  "pool",
  "pond",
  "lake",
  "river",
  "sea",
  "ocean",
  "fountain",
  "canal",
  "stream",
  "waterfall",
  "hồ",
  "sông",
  "biển",
  "suối",
  "kênh",
  "ao",
  "thác",
]);
const WATER_FACT = /pool|water|pond|lake|river|sea|fountain/i;
const OVERCAST = /overcast|cloudy|rain|storm|fog|mist|drizzle|u ám|nhiều mây|mưa|sương/i;
const DARK_PRESET = /night|dusk|blue[\s_-]?hour|evening|đêm|tối/i;
const TWILIGHT_PRESET = /dawn|sunrise|sunset|golden/i;
const DAY_PRESET = /day|noon|morning|afternoon|sunny|ngày|trưa|sáng/i;

const TIME_CLASS: Readonly<Record<string, TimeClass>> = {
  night: "dark",
  blue_hour: "dark",
  evening: "dark",
  dawn: "twilight",
  golden_hour: "twilight",
  morning: "day",
  midday: "day",
  afternoon: "day",
};

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u);

function contextMentionsWater(dna: ProjectDNA): boolean {
  const c = dna.context;
  const texts = [
    c.macroContext ?? "",
    c.atmosphereNotes,
    ...c.distantBackground,
    ...(["front", "rear", "left", "right"] as const).flatMap((d) => [
      c[d].spaceType ?? "",
      c[d].notes,
      ...c[d].elements,
    ]),
  ];
  return texts.some((t) => words(t).some((w) => WATER_WORDS.has(w)));
}

function factPresence(space: SpaceInstance | null, pattern: RegExp): Presence {
  let best: Presence = "absent";
  for (const [key, fact] of Object.entries(space?.facts ?? {})) {
    if (!pattern.test(key) || fact.value === false || fact.value === null) continue;
    if (isConfirmed(fact.evidence)) return "verified";
    best = "plausible";
  }
  return best;
}

function timeClass(dna: ProjectDNA, enclosed: boolean): TimeClass {
  const time = (enclosed ? dna.interior?.timeOfDay : undefined) ?? dna.lighting?.timeOfDay;
  if (time && TIME_CLASS[time]) return TIME_CLASS[time]!;
  const hint = [time, dna.lighting?.presetId].filter(Boolean).join(" ");
  if (!hint) return "unknown";
  if (DARK_PRESET.test(hint)) return "dark";
  if (TWILIGHT_PRESET.test(hint)) return "twilight";
  if (DAY_PRESET.test(hint)) return "day";
  return "unknown";
}

function countObjects(requests: readonly SceneObjectRequest[] | null | undefined) {
  const counts = { movingVehicles: 0, parkedVehicles: 0, movingPeople: 0, stillPeople: 0 };
  for (const r of requests ?? []) {
    const type = sceneObjectPreset(r.presetId)?.type;
    // Only motorised vehicles carry headlights and tail lights.
    if (type === "car" || type === "motorbike") {
      if (r.state === "moving") counts.movingVehicles += r.quantity;
      else counts.parkedVehicles += r.quantity;
    } else if (type === "person") {
      if (r.state === "moving") counts.movingPeople += r.quantity;
      else counts.stillPeople += r.quantity;
    }
  }
  return counts;
}

/** The facts of the shot the matrix decides on (exposed for the UI and tests). */
export function effectScene(dna: ProjectDNA, shot: EffectShotInput): EffectScene {
  const active = resolveActiveSpace(dna, { targetSpaceId: shot.targetSpaceId });
  const zone = active?.preset?.zone;
  const enclosed = zone ? zone === "interior" : shot.projectType === "interior";
  const semiOutdoor = zone === "semi_outdoor";
  const space = active?.space ?? null;

  let road: Presence = "absent";
  if (!enclosed && shot.projectType !== "interior") {
    const adjacency = resolveSiteAdjacency(dna, shot.projectType);
    const streets = (["front", "left", "right", "rear"] as const)
      .map((s) => adjacency[s])
      .filter((b) => b.kind === "street");
    if (streets.some((b) => isConfirmed(b.evidence))) road = "verified";
    else if (streets.length) road = "plausible";
  }

  let water: Presence =
    active?.preset && sceneSpaceKind(active.preset) === "pool"
      ? "verified"
      : factPresence(space, WATER_FACT);
  if (water === "absent" && !enclosed && contextMentionsWater(dna)) water = "plausible";

  let opening: Presence = "absent";
  if (enclosed) {
    const direction = dna.interior?.daylightDirection;
    const fact = factPresence(space, /window|skylight|opening|door/i);
    if (fact === "verified") opening = "verified";
    else if (direction && direction !== "none" && direction !== "diffuse") opening = "verified";
    else if (direction === "none" && fact === "absent") opening = "absent";
    else opening = "plausible";
  }

  const weather = dna.weather;
  const overcast = [weather?.presetId, weather?.preset, weather?.sky]
    .filter(Boolean)
    .some((t) => OVERCAST.test(t!));
  const artificialLights =
    (dna.lighting?.artificialLighting ?? []).some((l) => l.enabled !== false) ||
    (enclosed && (dna.interior?.artificialScenes.length ?? 0) > 0);
  const camera = shot.cameraId ? (dna.cameras.find((c) => c.id === shot.cameraId) ?? null) : null;

  return {
    enclosed,
    semiOutdoor,
    road,
    water,
    time: timeClass(dna, enclosed),
    overcast,
    artificialLights,
    opening,
    camera,
    ...countObjects(shot.sceneObjects),
  };
}

// ---------------------------------------------------------------- rules

type Verdict = { status: EffectStatus; reason: EffectReason; code?: EffectBlockCode };

const ok: Verdict = { status: "available", reason: "available" };
const missing = (reason: EffectReason): Verdict => ({
  status: "blocked",
  reason,
  code: "EFFECT_SOURCE_MISSING",
});
const motion = (reason: EffectReason): Verdict => ({
  status: "blocked",
  reason,
  code: "EFFECT_MOTION_CONFLICT",
});
const maybe = (reason: EffectReason): Verdict => ({ status: "conditional", reason });

const isDetailCamera = (c: CameraDNA | null) =>
  c?.viewType === "detail" || c?.viewType === "interior_detail";

/** A point light the effect can sit on: lamps, or the sun in an open sky. */
function lightSource(s: EffectScene): Verdict {
  if (s.artificialLights) return ok;
  if (s.time === "dark") return missing("no_light_source");
  if (s.enclosed) {
    if (s.opening === "absent") return missing("no_light_source");
    if (s.time === "unknown") return maybe("time_unknown");
    return maybe("sun_through_window");
  }
  if (s.overcast) return missing("sun_hidden");
  if (s.time === "unknown") return maybe("time_unknown");
  return ok;
}

const RULES: Readonly<Record<EffectId, (s: EffectScene) => Verdict>> = {
  vehicle_light_trails(s) {
    if (s.road === "absent") return missing("no_road");
    if (!s.movingVehicles)
      return s.parkedVehicles ? motion("vehicles_parked") : missing("no_moving_vehicle");
    if (s.time === "day") return missing("needs_dark");
    if (s.road === "plausible") return maybe("road_unverified");
    if (s.time === "unknown") return maybe("time_unknown");
    if (s.time === "twilight") return maybe("needs_dusk");
    return ok;
  },
  people_motion_blur(s) {
    if (s.movingPeople) return ok;
    if (s.stillPeople) return motion("people_static");
    return maybe("needs_moving_people");
  },
  soft_clouds(s) {
    if (s.enclosed) return missing("no_sky");
    if (isDetailCamera(s.camera)) return maybe("sky_out_of_frame");
    if (s.semiOutdoor) return maybe("sky_partial");
    return ok;
  },
  silky_water(s) {
    if (s.water === "absent") return missing("no_water");
    if (s.water === "plausible") return maybe("water_unverified");
    return ok;
  },
  sunstar: lightSource,
  lens_flare: lightSource,
  god_rays(s) {
    if (s.time === "dark") return missing("needs_sunlight");
    if (s.enclosed) {
      if (s.opening === "absent") return missing("no_opening");
      if (s.opening === "plausible") return maybe("opening_unverified");
    }
    if (s.time === "unknown") return maybe("time_unknown");
    return ok;
  },
  reflection_control(s) {
    if (s.enclosed) return maybe("depends_on_glass");
    const c = s.camera;
    if (c && (c.viewType === "aerial" || (c.elevationDeg ?? 0) >= 60)) return maybe("camera_angle");
    return ok;
  },
};

/** The matrix for every effect, in catalog order. */
export function effectsCompatibility(
  dna: ProjectDNA,
  shot: EffectShotInput,
): EffectCompatibility[] {
  const scene = effectScene(dna, shot);
  return EFFECT_CATALOG.map(({ id }) => {
    const v = RULES[id](scene);
    return {
      effectId: id,
      status: v.status,
      reason: v.reason,
      reasonKey: `effects.reasons.${v.reason}` as const,
      ...(v.code ? { code: v.code } : {}),
    };
  });
}

// ---------------------------------------------------------------- combinations

/** Pairs that cannot share one shot: light trails need the dark, light rays need the sun. */
const INCOMPATIBLE: ReadonlyArray<readonly [EffectId, EffectId]> = [
  ["vehicle_light_trails", "god_rays"],
];

export function effectsCompatibleTogether(a: EffectId, b: EffectId): boolean {
  if (a === b) return false;
  return !INCOMPATIBLE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

/**
 * The effects a selection really turns on: the primary, then the secondaries that are
 * compatible with it and with each other (first wins), unique, at most
 * `MAX_SECONDARY_EFFECTS`. No primary: nothing.
 */
export function selectedEffects(effects: ShotEffectsInput | null | undefined): EffectChoice[] {
  const primary = effects?.primary;
  if (!primary) return [];
  const chosen: EffectChoice[] = [primary];
  for (const choice of effects.secondary ?? []) {
    if (chosen.length > MAX_SECONDARY_EFFECTS) break;
    if (chosen.every((c) => effectsCompatibleTogether(c.id, choice.id))) chosen.push(choice);
  }
  return chosen;
}
