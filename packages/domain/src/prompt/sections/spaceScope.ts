/**
 * `SPACE SCOPE` section (ADR-034 P1a, SRS §4.4 / §12.2). Owned by the Space Catalog: it
 * describes only the active space, and is absent when the DNA has no active space, so a DNA
 * without `spaceCatalog` compiles exactly as before.
 */
import type { ProjectDNA } from "../../schemas/projectDna";
import { resolveActiveSpace, spaceScopeLines } from "../../spaceCatalog/resolve";
import type { SpaceZone } from "../../spaceCatalog/schemas";

export function spaceScopeSection(dna: ProjectDNA): string | null {
  const lines = spaceScopeLines(dna);
  return lines.length ? lines.join(" ") : null;
}

/**
 * True when the interior DNA furnishing may be compiled: always without an active catalog
 * space, otherwise only for an interior one. A garden never gets bedroom furniture (AC-02).
 */
export function allowsInteriorFurnishing(dna: ProjectDNA): boolean {
  const zone: SpaceZone | undefined = resolveActiveSpace(dna)?.preset?.zone;
  return zone === undefined || zone === "interior";
}
