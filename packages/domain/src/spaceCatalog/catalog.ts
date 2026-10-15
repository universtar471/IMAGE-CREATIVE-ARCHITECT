/**
 * The bundled Space Catalog. Knowledge packs are injected by the desktop app, but the
 * catalog is read by pure domain code (the prompt compiler and the conflict validator), so
 * the generated JSON is imported here at build time. It is static data: no I/O at run time.
 */
import catalogData from "../../../../knowledge/space-catalog/catalog.json";
import { SpaceCatalogRegistry } from "./registry";
import type { SpacePreset } from "./schemas";

export const SPACE_CATALOG = new SpaceCatalogRegistry(catalogData);

/** Presets of a building archetype, in catalog order; empty for an unknown archetype. */
export function spacesFor(archetype: string): SpacePreset[] {
  return SPACE_CATALOG.spacesFor(archetype);
}
