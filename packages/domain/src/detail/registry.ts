import { DetailRecordSchema, type DetailRecord } from "../schemas/extensions";
import type { ProjectDNA } from "../schemas/projectDna";

/** The only writer for `dna.architecturalDetails` (ADR-036). */
export const ArchitecturalDetailRegistry = {
  list(dna: Pick<ProjectDNA, "architecturalDetails">): DetailRecord[] {
    return [...(dna.architecturalDetails ?? [])];
  },

  add(dna: ProjectDNA, detail: DetailRecord): ProjectDNA {
    const parsed = DetailRecordSchema.parse(detail);
    if (dna.architecturalDetails?.some((item) => item.id === parsed.id))
      throw new Error(`Architectural detail id already exists: ${parsed.id}`);
    return { ...dna, architecturalDetails: [...(dna.architecturalDetails ?? []), parsed] };
  },

  update(dna: ProjectDNA, id: string, patch: Partial<DetailRecord>): ProjectDNA {
    const details = dna.architecturalDetails ?? [];
    const index = details.findIndex((item) => item.id === id);
    if (index < 0) throw new Error(`Architectural detail not found: ${id}`);
    const next = DetailRecordSchema.parse({ ...details[index], ...patch, id });
    return {
      ...dna,
      architecturalDetails: details.map((item, itemIndex) => (itemIndex === index ? next : item)),
    };
  },

  remove(dna: ProjectDNA, id: string): ProjectDNA {
    const details = dna.architecturalDetails ?? [];
    return {
      ...dna,
      architecturalDetails: details.filter((item) => item.id !== id),
    };
  },
};

export const listArchitecturalDetails = ArchitecturalDetailRegistry.list;
export const addArchitecturalDetail = ArchitecturalDetailRegistry.add;
export const updateArchitecturalDetail = ArchitecturalDetailRegistry.update;
export const removeArchitecturalDetail = ArchitecturalDetailRegistry.remove;
