/**
 * SCENE OBJECTS section (ADR-036 P2d, SRS §7.2, §12.2 item 7).
 *
 * One line per object request of the shot, then the preservation lines. A zone that is
 * recorded but not confirmed is worded "only if … has adequate clearance"; a request the
 * validator refuses for an explicit placement is never compiled, so the
 * prompt cannot create a driveway, garage or road. No requests: no section (the prompt is
 * byte-identical to a shot without objects). Preset auto-placement instead asks the model
 * to choose a suitable existing surface from the source image and user prompt.
 */
import type { ProjectType } from "../../schemas/enums";
import type { ProjectDNA } from "../../schemas/projectDna";
import { isObjectAllowed, SCENE_OBJECT_TABLE, stateAllowed } from "../../sceneObjects/allowed";
import { OBJECT_COLOR_EN, sceneObjectPreset } from "../../sceneObjects/catalog";
import { resolveObjectRequests, type ResolvedObjectRequest } from "../../sceneObjects/placement";
import type { PlacementZoneId, SceneObjectRequest } from "../../sceneObjects/schemas";

export const SCENE_OBJECTS_HEADING = "SCENE OBJECTS:";

const NUMBER_WORDS = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"];
const quantityWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

const ZONE_EN: Readonly<Record<PlacementZoneId, string>> = {
  floor: "floor",
  ground: "ground",
  garden: "garden",
  pool_deck: "pool deck",
  garage_bay: "parking bay",
  driveway: "driveway",
  hardscape: "paved hardscape",
  existing_road: "existing street",
  sidewalk: "existing sidewalk",
};

/** Requests the validator accepts (possibly with a WARN), in request order. */
function compilable(r: ResolvedObjectRequest): boolean {
  if (!r.type || !r.target || !r.zone) return false;
  if (!isObjectAllowed(r.target.kind, r.type)) return false;
  if (r.request.autoPlacement && !r.request.placementZoneId) return true;
  if (!SCENE_OBJECT_TABLE[r.target.kind][r.type]!.includes(r.zone)) return false;
  if (!stateAllowed(r.type, r.zone, r.request.state)) return false;
  return r.zoneStatus !== "absent";
}

function where(r: ResolvedObjectRequest): string {
  if (r.request.autoPlacement && !r.request.placementZoneId)
    return r.type === "car" || r.type === "motorbike" || r.type === "bicycle"
      ? "on a suitable existing street or parking surface visible in the source image"
      : "on a suitable existing walkable surface visible in the source image";
  const zone = ZONE_EN[r.zone!];
  const target = r.target!;
  const verified = r.zoneStatus === "verified" ? "verified " : "";
  if (target.kind === "frontage" && !target.space)
    return `on the ${verified}${zone} in front of the building`;
  const space = target.preset?.labelEn ?? "selected space";
  if (r.zoneStatus === null) return `in the ${space}`;
  return `on the ${verified}${zone} of the ${space}`;
}

function objectLine(r: ResolvedObjectRequest): string {
  const { request } = r;
  const preset = sceneObjectPreset(request.presetId)!;
  const many = request.quantity > 1;
  const description = many ? preset.promptPluralEn : preset.promptEn;
  const vehicle = r.zoneStatus !== null;
  const state = vehicle ? (request.state === "moving" ? "moving " : "parked ") : "";
  const color = request.appearanceOverrides?.color;
  const paint =
    color && preset.colorable
      ? ` in ${OBJECT_COLOR_EN[color]}${preset.type === "bicycle" ? "" : " paint"}`
      : "";
  const pose =
    preset.type === "person"
      ? request.state === "moving"
        ? ", walking naturally"
        : ", standing or seated naturally"
      : preset.type === "pet"
        ? request.state === "moving"
          ? ", moving naturally"
          : ", resting"
        : "";
  const visibility = request.visibility ? `, in the ${request.visibility}` : "";
  const clearance =
    !r.request.autoPlacement && r.zoneStatus === "plausible"
      ? `, only if the ${ZONE_EN[r.zone!]} is present in the approved references and has adequate clearance`
      : "";
  return `Add ${quantityWord(request.quantity)} ${state}${description}${paint} ${where(r)}${pose}${visibility}${clearance}.`;
}

/** The SCENE OBJECTS lines of a shot (empty without compilable requests). */
export function sceneObjectsLines(
  dna: Pick<ProjectDNA, "spaceCatalog" | "site" | "context">,
  projectType: ProjectType,
  requests: readonly SceneObjectRequest[] | undefined,
): string[] {
  const resolved = resolveObjectRequests(dna, projectType, requests).filter(compilable);
  if (!resolved.length) return [];
  const lines = resolved.map(objectLine);
  if (resolved.some((r) => r.request.autoPlacement))
    lines.push(
      "Choose a physically plausible position from the source image and the user's prompt; follow any requested location, maintain realistic scale, keep entrances and the main facade clear, and do not invent roads or parking areas.",
    );
  const vehicles = resolved.filter((r) => r.zoneStatus !== null);
  if (vehicles.length) {
    if (vehicles.some((r) => r.request.state === "static"))
      lines.push("Keep parked vehicles static, with no motion blur or light trails.");
    lines.push(
      "Keep every vehicle physically grounded, to scale and clear of doors and access routes; no new garage, driveway, parking pad or widened road, and no altered building.",
    );
  }
  lines.push(
    "Preserve the original space, architecture and camera; added objects stay to scale and never hide locked or key architectural elements.",
  );
  return lines;
}

export function sceneObjectsSection(
  dna: Pick<ProjectDNA, "spaceCatalog" | "site" | "context">,
  projectType: ProjectType,
  requests: readonly SceneObjectRequest[] | undefined,
): string | null {
  const lines = sceneObjectsLines(dna, projectType, requests);
  return lines.length ? [SCENE_OBJECTS_HEADING, ...lines].join("\n") : null;
}
