export const REGION_ACTIONS = ["person", "animal", "tree", "decor", "effect", "material"] as const;
export type RegionAction = (typeof REGION_ACTIONS)[number] | "edit";
export function regionActionInstruction(action: RegionAction): string {
  const subjects = {
    person: "one naturally posed person",
    animal: "one small animal",
    tree: "a tree appropriate to the setting",
    decor: "decor appropriate to the room",
  };
  if (action === "effect")
    return "Add a subtle atmospheric effect inside the selected region only. Preserve the scene geometry and all pixels outside the region.";
  if (action === "edit" || action === "material") return "";
  return `Add ${subjects[action]} inside the selected region only. Match the image perspective, scale, lighting and shadows. Preserve everything outside the region.`;
}
