/** Contact Sheet grouping (pure): a batch's generations, grouped per camera in DNA order. */
import type { BatchDTO, CameraDNA, GenerationDTO, JobDTO } from "@arch/domain";

export type ContactEntry = { generation: GenerationDTO; job: JobDTO | null };
export type ContactGroup = {
  cameraId: string | null;
  camera: CameraDNA | null;
  /** Oldest first, so a retry appears after the attempt it replaces. */
  entries: ContactEntry[];
};

export function groupContactSheet(
  batch: Pick<BatchDTO, "id">,
  generations: readonly GenerationDTO[],
  jobs: readonly JobDTO[],
  cameras: readonly CameraDNA[],
): ContactGroup[] {
  const mine = generations
    .filter((g) => g.batchId === batch.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const groups = new Map<string | null, ContactGroup>();
  for (const g of mine) {
    const key = g.cameraId;
    let group = groups.get(key);
    if (!group) {
      group = { cameraId: key, camera: cameras.find((c) => c.id === key) ?? null, entries: [] };
      groups.set(key, group);
    }
    group.entries.push({ generation: g, job: jobs.find((j) => j.generationId === g.id) ?? null });
  }
  const rank = (gr: ContactGroup) => {
    const i = cameras.findIndex((c) => c.id === gr.cameraId);
    return i < 0 ? cameras.length : i;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}
