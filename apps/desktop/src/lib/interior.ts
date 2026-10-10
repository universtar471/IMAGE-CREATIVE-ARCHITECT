import type { InteriorOption } from "@arch/domain";

export {
  BUILDING_USES,
  FURNITURE,
  INTERIOR_CATALOG,
  INTERIOR_STYLES,
  MATERIAL_PRESETS,
  PALETTES,
  ROOMS,
  InteriorDNASchema,
  applyStyleDefaults,
  defaultInteriorDNA,
  furnitureForRoom,
  interiorPromptLines,
  presetSurfaces,
  proposeInteriorFromLegacy,
  roomsForUse,
  styleDefaults,
} from "@arch/domain";

export type {
  BuildingUseId,
  FurnitureId,
  InteriorDNA,
  InteriorStyleId,
  InteriorSurfaces,
  MaterialPresetId,
  RoomId,
} from "@arch/domain";

export const catalogLabel = <Id extends string>(
  list: readonly InteriorOption<Id>[],
  id: Id | undefined,
  locale: "vi" | "en",
) => list.find((item) => item.id === id)?.[locale] ?? id ?? "-";
