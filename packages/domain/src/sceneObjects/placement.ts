import { isConfirmed } from "../facts/evidence";
import { resolveActiveSpace } from "../spaceCatalog/resolve";
import type { ProjectDNA } from "../schemas/projectDna";
import type { ShotIntent } from "../validation/validateShot";
import {
  allowedObjectsForSpace,
  sceneObjectPreset,
  VEHICLES,
  type AllowedObjectResult,
} from "./catalog";

export type ObjectPlacementIssue = {
  code: "OBJECT_NOT_ALLOWED_IN_SPACE" | "OBJECT_NO_PLACEMENT_ZONE";
  severity: "BLOCK" | "WARN";
  path: string;
  params: Record<string, string | number>;
};

const zoneText = (value: string | undefined) => (value ?? "").trim().toLowerCase();
const plausibleZone = (zone: string, allowed: AllowedObjectResult) => {
  if (!zone) return false;
  if (allowed.hardscapeOnly) return /hardscape|paved|terrace|drive|gara|garage/.test(zone);
  return /garage|gara|driveway|drive|road|street|đường|hardscape|paved|parking|bãi/.test(zone);
};

function verifiedZone(
  instance: NonNullable<ReturnType<typeof resolveActiveSpace>>["space"],
  zone: string,
) {
  if (!zone) return false;
  return Object.entries(instance.facts).some(([key, fact]) => {
    if (!isConfirmed(fact.evidence)) return false;
    const keyText = key.toLowerCase();
    return (
      keyText.includes(zone) ||
      zone.includes(keyText) ||
      /garage|gara|driveway|hardscape|road|street/.test(keyText)
    );
  });
}

/** Placement-only rules for P2d. It never mutates DNA or invents a driveway. */
export function validateObjectPlacement(
  dna: ProjectDNA,
  shot: Pick<ShotIntent, "sceneObjects" | "targetSpaceId">,
): ObjectPlacementIssue[] {
  const requests = shot.sceneObjects ?? [];
  if (!requests.length) return [];
  const issues: ObjectPlacementIssue[] = [];
  for (const [index, request] of requests.entries()) {
    const preset = sceneObjectPreset(request.presetId);
    if (!preset) {
      issues.push({
        code: "OBJECT_NOT_ALLOWED_IN_SPACE",
        severity: "BLOCK",
        path: `sceneObjects[${index}].presetId`,
        params: { presetId: request.presetId },
      });
      continue;
    }
    const active = resolveActiveSpace(dna, { targetSpaceId: request.targetSpaceId });
    const allowed = active ? allowedObjectsForSpace(active.preset, active.space) : null;
    if (!active || !allowed || !allowed.allowed.includes(preset.type)) {
      issues.push({
        code: "OBJECT_NOT_ALLOWED_IN_SPACE",
        severity: "BLOCK",
        path: `sceneObjects[${index}]`,
        params: { presetId: request.presetId, targetSpaceId: request.targetSpaceId },
      });
      continue;
    }
    if (!allowed.requiresPlacementZone || !VEHICLES.includes(preset.type)) continue;
    const zone = zoneText(request.placementZoneId);
    if (!plausibleZone(zone, allowed)) {
      issues.push({
        code: "OBJECT_NO_PLACEMENT_ZONE",
        severity: "BLOCK",
        path: `sceneObjects[${index}].placementZoneId`,
        params: { presetId: request.presetId, targetSpaceId: request.targetSpaceId },
      });
    } else if (!verifiedZone(active.space, zone)) {
      issues.push({
        code: "OBJECT_NO_PLACEMENT_ZONE",
        severity: "WARN",
        path: `sceneObjects[${index}].placementZoneId`,
        params: { presetId: request.presetId, targetSpaceId: request.targetSpaceId },
      });
    }
  }
  return issues;
}

/** Named export used by feature modules that register this validator in the shared gate. */
export const ObjectPlacementValidator = validateObjectPlacement;
