import { newUlid } from "../ids";
import type { ProjectDNA } from "../schemas/projectDna";

export function newSceneObjectId(): string {
  return `OBJ_${newUlid()}`;
}

export function sceneObjectLines(dna: ProjectDNA): string[] {
  const objects = dna.scene?.objects ?? [];
  const pinned = new Set(dna.locks.objectIds);
  return objects
    .filter((object) => pinned.has(object.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(
      (object) =>
        `Preserve pinned scene object "${object.name}" (${object.category}): keep it exactly in place and unchanged.`,
    );
}
