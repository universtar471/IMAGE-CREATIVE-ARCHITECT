/**
 * ObjectPlacementValidator (ADR-036 P2d, SRS §7.2). Registered in the single validator
 * (`validateShot`); it never edits the DNA and never creates a driveway, garage or road.
 *
 * - OBJECT_NOT_ALLOWED_IN_SPACE (BLOCK): the object type does not belong in the target space
 *   (a classic car in a bedroom, AC-06), or the target or preset is unknown.
 * - OBJECT_NO_PLACEMENT_ZONE: the object has nowhere real to stand.
 *   - BLOCK: the chosen zone is not a zone of that space for the type, the zone is absent
 *     from the project data (no driveway / garage / street on record), a vehicle is moving
 *     outside a road, or a measured garage is too small for the requested vehicles.
 *   - WARN: the zone is recorded but not confirmed; the prompt then adds "if adequate
 *     clearance". A verified garage with a 300 SL raises nothing (AC-07).
 */
import type { ProjectType } from "../schemas/enums";
import type { ProjectDNA } from "../schemas/projectDna";
import {
  confirmedFootprint,
  defaultZone,
  isObjectAllowed,
  placementZoneStatus,
  resolveSceneTarget,
  SCENE_OBJECT_TABLE,
  stateAllowed,
  type SceneTarget,
  type ZoneStatus,
} from "./allowed";
import { sceneObjectPreset } from "./catalog";
import {
  isVehicleType,
  type PlacementZoneId,
  type SceneObjectRequest,
  type SceneObjectType,
} from "./schemas";

export type ObjectPlacementIssue = {
  code: "OBJECT_NOT_ALLOWED_IN_SPACE" | "OBJECT_NO_PLACEMENT_ZONE";
  severity: "BLOCK" | "WARN";
  path: string;
  params: Record<string, string | number>;
};

/** Plan footprint of one parked object (metres): a parking bay, not the bare body. */
const FOOTPRINT_M: Partial<Record<SceneObjectType, readonly [number, number]>> = {
  car: [2.5, 5.0],
  motorbike: [1.0, 2.0],
  bicycle: [0.7, 1.8],
};

/** How many objects of a type fit in a measured rectangle (either orientation). */
export function parkingCapacity(type: SceneObjectType, w: number, d: number): number {
  const size = FOOTPRINT_M[type];
  if (!size) return Number.POSITIVE_INFINITY;
  const [a, b] = size;
  const fit = (x: number, y: number) => Math.floor(x / a + 1e-9) * Math.floor(y / b + 1e-9);
  return Math.max(fit(w, d), fit(d, w));
}

export type ResolvedObjectRequest = {
  request: SceneObjectRequest;
  index: number;
  target: SceneTarget | null;
  type: SceneObjectType | null;
  zone: PlacementZoneId | null;
  /** Evidence of the zone; `null` when the type does not need a checked zone. */
  zoneStatus: ZoneStatus | null;
};

/** Resolves every request against the DNA (shared by the validator, compiler and UI). */
export function resolveObjectRequests(
  dna: Pick<ProjectDNA, "spaceCatalog" | "site" | "context">,
  projectType: ProjectType,
  requests: readonly SceneObjectRequest[] | undefined,
): ResolvedObjectRequest[] {
  return (requests ?? []).map((request, index) => {
    const target = resolveSceneTarget(dna, projectType, request.targetSpaceId);
    const type = sceneObjectPreset(request.presetId)?.type ?? null;
    const zone =
      request.placementZoneId ?? (target && type ? defaultZone(target.kind, type) : null);
    const zoneStatus =
      target && type && zone && isVehicleType(type)
        ? placementZoneStatus(dna, projectType, target, zone)
        : null;
    return { request, index, target, type, zone, zoneStatus };
  });
}

export function validateObjectPlacement(
  dna: Pick<ProjectDNA, "spaceCatalog" | "site" | "context">,
  shot: { projectType: ProjectType; sceneObjects?: readonly SceneObjectRequest[] | null },
): ObjectPlacementIssue[] {
  const resolved = resolveObjectRequests(dna, shot.projectType, shot.sceneObjects ?? undefined);
  const issues: ObjectPlacementIssue[] = [];
  const blocked = (r: ResolvedObjectRequest, reason: string, field = "") =>
    issues.push({
      code: "OBJECT_NOT_ALLOWED_IN_SPACE",
      severity: "BLOCK",
      path: `sceneObjects[${r.index}]${field}`,
      params: {
        presetId: r.request.presetId,
        targetSpaceId: r.request.targetSpaceId,
        reason,
        ...(r.target ? { kind: r.target.kind } : {}),
      },
    });
  const noZone = (r: ResolvedObjectRequest, severity: "BLOCK" | "WARN", reason: string) =>
    issues.push({
      code: "OBJECT_NO_PLACEMENT_ZONE",
      severity,
      path: `sceneObjects[${r.index}].placementZoneId`,
      params: {
        presetId: r.request.presetId,
        targetSpaceId: r.request.targetSpaceId,
        zone: r.zone ?? "none",
        reason,
      },
    });

  const placed: ResolvedObjectRequest[] = [];
  for (const r of resolved) {
    if (!r.type) {
      blocked(r, "unknown_preset", ".presetId");
      continue;
    }
    if (!r.target) {
      blocked(r, "unknown_target", ".targetSpaceId");
      continue;
    }
    if (!isObjectAllowed(r.target.kind, r.type)) {
      blocked(r, "type_not_allowed");
      continue;
    }
    // Preset objects use the image and prompt to find a suitable existing surface.
    // Explicit placement requests still receive the measured-zone checks below.
    if (r.request.autoPlacement && !r.request.placementZoneId) continue;
    if (!r.zone || !SCENE_OBJECT_TABLE[r.target.kind][r.type]!.includes(r.zone)) {
      noZone(r, "BLOCK", "zone_not_in_space");
      continue;
    }
    if (!stateAllowed(r.type, r.zone, r.request.state)) {
      noZone(r, "BLOCK", "moving_outside_road");
      continue;
    }
    if (r.zoneStatus === "absent") noZone(r, "BLOCK", "zone_absent");
    else if (r.zoneStatus === "plausible") noZone(r, "WARN", "zone_unverified");
    if (r.zoneStatus && r.zoneStatus !== "absent") placed.push(r);
  }

  // Physical fit: vehicles sharing one measured zone must fit in it together.
  const groups = new Map<string, ResolvedObjectRequest[]>();
  for (const r of placed) {
    const key = `${r.request.targetSpaceId}|${r.zone}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const group of groups.values()) {
    const footprint = confirmedFootprint(group[0]!.target!.space);
    if (!footprint) continue;
    let load = 0;
    for (const r of group) {
      const capacity = parkingCapacity(r.type!, footprint.w, footprint.d);
      load += capacity === 0 ? Number.POSITIVE_INFINITY : r.request.quantity / capacity;
      if (load > 1 + 1e-9) {
        noZone(r, "BLOCK", "too_small");
        issues[issues.length - 1]!.params.capacity = capacity;
        break;
      }
    }
  }
  return issues;
}

/** Named export of the rule set, as registered in the shared validator. */
export const ObjectPlacementValidator = validateObjectPlacement;
