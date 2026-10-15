import { sceneObjectPreset } from "../../sceneObjects/catalog";
import type { SceneObjectRequest } from "../../sceneObjects/schemas";

const quantityText = (quantity: number) => (quantity === 1 ? "ONE" : String(quantity));

/** The shot-owned scene-object prompt section. Empty selections produce no section. */
export function sceneObjectsSection(
  requests: readonly SceneObjectRequest[] | undefined,
): string | null {
  if (!requests?.length) return null;
  const lines = requests.map((request) => {
    const preset = sceneObjectPreset(request.presetId);
    const description = preset?.promptEn ?? request.presetId;
    const state = request.state === "moving" ? "moving" : "parked";
    const zone = request.placementZoneId
      ? ` on the ${request.placementZoneId.replace(/[_-]+/g, " ")}`
      : " in the selected space";
    const clearance = request.placementZoneId
      ? `, if the ${request.placementZoneId.replace(/[_-]+/g, " ")} has adequate clearance`
      : "";
    return `Add ${quantityText(request.quantity)} ${state} ${description}${zone}${clearance}. Preserve the original space, access routes and architecture; never create a new driveway, garage or road.`;
  });
  return ["SCENE OBJECTS:", ...lines].join("\n");
}
