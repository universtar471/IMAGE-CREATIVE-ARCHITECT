import { isConfirmed } from "../facts/evidence";
import { resolveSiteAdjacency } from "../site/adjacency";
import { resolveVisibility } from "../site/visibility";
import type { DetailFacade, DetailRecord } from "../schemas/extensions";
import type { ProjectDNA } from "../schemas/projectDna";

export type DetailShotMode = "auto" | "manual";

export type DetailShot = {
  detailId: string;
  cameraSuggestion: string;
  angleIndex: number;
  shotType: "approach" | "architectural_detail" | "material_closeup";
};

export type DetailShotPlan = {
  shots: DetailShot[];
  shortfall: number;
  warnings: string[];
};

export type DetailShotPlanOptions = {
  count: number;
  mode: DetailShotMode;
  detailIds?: readonly string[];
};

const isVerified = (detail: DetailRecord) => {
  const evidence = detail.evidence;
  const location = detail.verifiedLocation;
  const existence = detail.existence;
  const locationVerified =
    location === true || (location !== false && location !== undefined && isConfirmed(location));
  const existenceVerified =
    existence === true ||
    (existence !== false && existence !== undefined && isConfirmed(existence));
  return isConfirmed(evidence) || (locationVerified && existenceVerified);
};

export function isVerifiedArchitecturalDetail(detail: DetailRecord): boolean {
  return isVerified(detail);
}

export function detailFacade(detail: DetailRecord): DetailFacade | null {
  return detail.facade ?? detail.location?.facade ?? null;
}

function detailShotType(detail: DetailRecord): DetailShot["shotType"] {
  return detail.materialIds.length ? "material_closeup" : "architectural_detail";
}

function cameraCandidates(dna: ProjectDNA, detail: DetailRecord): string[] {
  const facade = detailFacade(detail);
  if (!facade) return [];
  const adjacency = resolveSiteAdjacency(dna);
  return dna.cameras
    .filter((camera) => resolveVisibility(adjacency, camera).visibleFacades.includes(facade))
    .map((camera) => camera.id);
}

/** Plan only verified details and cameras whose visibility includes the detail facade. */
export function planDetailShots(
  dna: ProjectDNA,
  options: DetailShotPlanOptions,
): DetailShotPlan {
  const count = Math.max(1, Math.min(10, Math.trunc(options.count)));
  const all = (dna.architecturalDetails ?? []).filter(isVerified);
  const wanted = options.mode === "manual" && options.detailIds?.length
    ? new Set(options.detailIds)
    : null;
  const details = all.filter((detail) => !wanted || wanted.has(detail.id));
  const warnings: string[] = [];
  if (!details.length) {
    return { shots: [], shortfall: count, warnings: ["NO_VERIFIED_DETAILS"] };
  }

  const candidates = new Map(details.map((detail) => [detail.id, cameraCandidates(dna, detail)]));
  for (const detail of details) {
    if (!candidates.get(detail.id)?.length) warnings.push(`NO_VISIBLE_CAMERA:${detail.id}`);
  }

  const shots: DetailShot[] = [];
  const usedAngles = new Map<string, Set<string>>();
  for (let round = 0; shots.length < count && round < 10; round++) {
    for (const detail of details) {
      if (shots.length >= count) break;
      const cameras = candidates.get(detail.id) ?? [];
      const used = usedAngles.get(detail.id) ?? new Set<string>();
      const cameraId = cameras.find((id) => !used.has(id));
      if (!cameraId) continue;
      used.add(cameraId);
      usedAngles.set(detail.id, used);
      shots.push({
        detailId: detail.id,
        cameraSuggestion: cameraId,
        angleIndex: used.size - 1,
        shotType: detailShotType(detail),
      });
    }
  }

  const shortfall = count - shots.length;
  if (shortfall) warnings.push(`SHORTFALL:${shortfall}`);
  return { shots, shortfall, warnings: [...new Set(warnings)] };
}
