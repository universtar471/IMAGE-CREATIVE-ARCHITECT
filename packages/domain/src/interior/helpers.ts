import type { ProjectDNA } from "../schemas/projectDna";
import {
  BUILDING_USES,
  CABINETRY_MATERIALS,
  CAMERA_PRESETS,
  CEILING_MATERIALS,
  COUNTERTOP_MATERIALS,
  FLOOR_MATERIALS,
  FURNITURE,
  INTERIOR_STYLES,
  MATERIAL_PRESETS,
  METAL_FINISHES,
  PALETTES,
  ROOMS,
  ROOM_IDS_BY_USE,
  TEXTILE_MATERIALS,
  WALL_MATERIALS,
  type BuildingUseId,
  type FurnitureId,
  type InteriorOption,
  type InteriorStyleId,
  type InteriorSurfaces,
  type MaterialPresetId,
  type RoomId,
} from "./catalog";
import { InteriorDNASchema, type InteriorDNA } from "./schemas";

const FURNITURE_BY_ROOM: Readonly<Partial<Record<RoomId, readonly FurnitureId[]>>> = {
  living_room: ["sofa", "armchair", "coffee_table", "media_console", "rug"],
  kitchen: ["island", "bar_stools"],
  dining_room: ["dining_table", "dining_chairs", "rug"],
  living_kitchen: [
    "sofa",
    "armchair",
    "coffee_table",
    "media_console",
    "rug",
    "dining_table",
    "dining_chairs",
    "island",
    "bar_stools",
  ],
  master_bedroom: ["bed", "bedside_tables", "wardrobe", "dressing_table", "rug"],
  bedroom: ["bed", "bedside_tables", "wardrobe", "desk"],
  kids_room: ["bed", "bedside_tables", "wardrobe", "desk", "bookshelf"],
  bathroom: ["vanity", "bathtub", "walk_in_shower"],
  walk_in_closet: ["wardrobe", "dressing_table"],
  home_office: ["desk", "bookshelf"],
  prayer_room: ["altar_cabinet"],
  lobby: ["reception_desk", "lounge_seating"],
  reception: ["reception_desk", "lounge_seating"],
  meeting_room: ["meeting_table"],
  open_office: ["desk", "bookshelf", "meeting_table"],
  cafe_dining: ["dining_table", "dining_chairs", "bar_stools"],
  bar_counter: ["bar_stools"],
  retail_floor: ["display_shelving", "reception_desk"],
  spa_treatment: ["treatment_bed", "lounge_seating"],
};

export function roomsForUse(id: BuildingUseId): readonly RoomId[] {
  return [...ROOM_IDS_BY_USE[id]];
}

export function furnitureForRoom(id: RoomId): readonly FurnitureId[] {
  return [...(FURNITURE_BY_ROOM[id] ?? [])];
}

export function styleDefaults(styleId: InteriorStyleId): {
  paletteId: (typeof INTERIOR_STYLES)[number]["paletteId"];
  materialPresetId: (typeof INTERIOR_STYLES)[number]["materialPresetId"];
} {
  const style = INTERIOR_STYLES.find(({ id }) => id === styleId)!;
  return { paletteId: style.paletteId, materialPresetId: style.materialPresetId };
}

export function presetSurfaces(presetId: MaterialPresetId): InteriorSurfaces {
  const surfaces = MATERIAL_PRESETS.find(({ id }) => id === presetId)!.surfaces;
  return cloneSurfaces(surfaces);
}

export function applyStyleDefaults(interior: InteriorDNA, styleId: InteriorStyleId): InteriorDNA {
  const defaults = styleDefaults(styleId);
  const surfaces = presetSurfaces(defaults.materialPresetId);
  return {
    ...interior,
    styleId,
    paletteId: defaults.paletteId,
    materialPresetId: defaults.materialPresetId,
    surfaces: {
      floor: interior.surfaces.floor.length ? [...interior.surfaces.floor] : surfaces.floor,
      wall: interior.surfaces.wall.length ? [...interior.surfaces.wall] : surfaces.wall,
      ceiling: interior.surfaces.ceiling.length ? [...interior.surfaces.ceiling] : surfaces.ceiling,
      cabinetry: interior.surfaces.cabinetry.length
        ? [...interior.surfaces.cabinetry]
        : surfaces.cabinetry,
      countertop: interior.surfaces.countertop.length
        ? [...interior.surfaces.countertop]
        : surfaces.countertop,
      textile: interior.surfaces.textile.length ? [...interior.surfaces.textile] : surfaces.textile,
      metal: interior.surfaces.metal.length ? [...interior.surfaces.metal] : surfaces.metal,
    },
  };
}

export function defaultInteriorDNA(
  use: BuildingUseId = "apartment",
  room: RoomId = "living_room",
  style: InteriorStyleId = "japandi",
): InteriorDNA {
  const validRoom = roomsForUse(use).includes(room) ? room : "other";
  const empty = InteriorDNASchema.parse({
    schemaVersion: 1,
    buildingUseId: use,
    roomId: validRoom,
    styleId: style,
  });
  return applyStyleDefaults(empty, style);
}

export function proposeInteriorFromLegacy(dna: ProjectDNA): {
  proposal: InteriorDNA;
  matched: string[];
} {
  const matched: string[] = [];
  const buildingUse = findOption(BUILDING_USES, dna.building.buildingType);
  const legacyRoom = findOption(ROOMS, dna.building.buildingType);
  if (buildingUse || legacyRoom) matched.push("building.buildingType");
  const style = findOption(INTERIOR_STYLES, dna.building.architecturalStyle);
  if (style) matched.push("building.architecturalStyle");

  let proposal = defaultInteriorDNA(
    buildingUse?.id ?? "apartment",
    inferRoom(legacyRoom?.id, buildingUse?.id),
    style?.id ?? "japandi",
  );
  const paletteIndex = dna.building.colorPalette.findIndex((value) => findOption(PALETTES, value));
  if (paletteIndex >= 0) {
    proposal = {
      ...proposal,
      paletteId: findOption(PALETTES, dna.building.colorPalette[paletteIndex])!.id,
    };
    matched.push(`building.colorPalette.${paletteIndex}`);
  }
  const surfaces = cloneSurfaces(proposal.surfaces);
  dna.building.materials.forEach((material, index) => {
    const slot = surfaceSlot(material.zone);
    if (!slot) return;
    const options = SURFACE_OPTIONS[slot] as readonly InteriorOption[];
    const option =
      findOption(options, material.materialId) ?? findOption(options, material.description);
    if (!option) return;
    surfaces[slot] = [option.id] as never;
    matched.push(`building.materials.${index}`);
  });
  proposal = { ...proposal, surfaces };
  return { proposal, matched };
}

/** Compiler-ready interior lines in their semantic order (context is supplied elsewhere). */
export function interiorPromptLines(dna: InteriorDNA): string[] {
  const use = BUILDING_USES.find(({ id }) => id === dna.buildingUseId)!;
  const room = ROOMS.find(({ id }) => id === dna.roomId)!;
  const style = INTERIOR_STYLES.find(({ id }) => id === dna.styleId)!;
  const lines = [
    `Interior space: ${use.prompt} ${room.prompt}.`,
    `Interior style: ${style.prompt}.`,
  ];

  const materialParts: string[] = [];
  const palette = PALETTES.find(({ id }) => id === dna.paletteId);
  if (palette) materialParts.push(palette.prompt);
  addSurfacePrompt(materialParts, "floor", dna.surfaces.floor, FLOOR_MATERIALS);
  addSurfacePrompt(materialParts, "walls", dna.surfaces.wall, WALL_MATERIALS);
  addSurfacePrompt(materialParts, "ceiling", dna.surfaces.ceiling, CEILING_MATERIALS);
  addSurfacePrompt(materialParts, "cabinetry", dna.surfaces.cabinetry, CABINETRY_MATERIALS);
  addSurfacePrompt(materialParts, "countertop", dna.surfaces.countertop, COUNTERTOP_MATERIALS);
  addSurfacePrompt(materialParts, "textiles", dna.surfaces.textile, TEXTILE_MATERIALS);
  addSurfacePrompt(materialParts, "metal", dna.surfaces.metal, METAL_FINISHES);
  if (materialParts.length) lines.push(`Materials and colors: ${materialParts.join("; ")}.`);

  const furnishing = dna.furnitureIds.map((id) => FURNITURE.find((item) => item.id === id)!.prompt);
  const density = {
    minimal: "minimal furnishing density",
    balanced: "balanced furnishing density",
    layered: "layered furnishing density",
  }[dna.furnishingDensity];
  lines.push(`Furnishing: ${furnishing.length ? `${furnishing.join(", ")}; ` : ""}${density}.`);

  const lighting = interiorLightingParts(dna);
  if (lighting.length) lines.push(`Interior lighting: ${lighting.join(", ")}.`);
  const camera = CAMERA_PRESETS.find(({ id }) => id === dna.cameraPresetId) ?? CAMERA_PRESETS[0]!;
  lines.push(`Camera: ${camera.prompt}.`);
  return lines;
}

function interiorLightingParts(dna: InteriorDNA): string[] {
  const parts: string[] = [];
  if (dna.timeOfDay) parts.push(dna.timeOfDay.replaceAll("_", " "));
  if (dna.daylightDirection === "none") {
    parts.push("no daylight");
  } else if (dna.daylightDirection || dna.daylightAmount) {
    const direction =
      dna.daylightDirection === "diffuse"
        ? "diffuse"
        : dna.daylightDirection
          ? `from the ${dna.daylightDirection}`
          : "";
    parts.push(
      dna.daylightDirection === "diffuse"
        ? [dna.daylightAmount, "diffuse daylight"].filter(Boolean).join(" ")
        : [dna.daylightAmount, "daylight", direction].filter(Boolean).join(" "),
    );
  }
  if (dna.artificialScenes.length)
    parts.push(dna.artificialScenes.map((scene) => `${scene} lighting`).join(" and "));
  if (dna.colorTemperatureK) {
    const warmth =
      dna.colorTemperatureK <= 3000
        ? "warm"
        : dna.colorTemperatureK === 3500
          ? "neutral-warm"
          : "neutral";
    parts.push(`${warmth} ${dna.colorTemperatureK} K`);
  }
  return parts;
}

const SURFACE_OPTIONS = {
  floor: FLOOR_MATERIALS,
  wall: WALL_MATERIALS,
  ceiling: CEILING_MATERIALS,
  cabinetry: CABINETRY_MATERIALS,
  countertop: COUNTERTOP_MATERIALS,
  textile: TEXTILE_MATERIALS,
  metal: METAL_FINISHES,
} as const;

type SurfaceSlot = keyof InteriorSurfaces;

function surfaceSlot(zone: string): SurfaceSlot | undefined {
  const key = normalize(zone);
  const aliases: Record<string, SurfaceSlot> = {
    floor: "floor",
    flooring: "floor",
    san: "floor",
    wall: "wall",
    walls: "wall",
    tuong: "wall",
    ceiling: "ceiling",
    tran: "ceiling",
    cabinetry: "cabinetry",
    cabinet: "cabinetry",
    tu: "cabinetry",
    countertop: "countertop",
    counter: "countertop",
    matban: "countertop",
    textile: "textile",
    textiles: "textile",
    vai: "textile",
    metal: "metal",
    kimloai: "metal",
  };
  return aliases[key.replaceAll(" ", "")];
}

function inferRoom(room: RoomId | undefined, use?: BuildingUseId): RoomId {
  if (room && (!use || roomsForUse(use).includes(room))) return room;
  return use && !roomsForUse(use).includes("living_room") ? "other" : "living_room";
}

function findOption<T extends InteriorOption>(
  options: readonly T[],
  value?: string,
): T | undefined {
  if (!value) return undefined;
  const wanted = normalize(value);
  return options.find(({ id, vi, en }) => [id, vi, en].some((item) => normalize(item) === wanted));
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .trim()
    .toLowerCase();
}

function cloneSurfaces(surfaces: Readonly<InteriorSurfaces>): InteriorSurfaces {
  return {
    floor: [...surfaces.floor],
    wall: [...surfaces.wall],
    ceiling: [...surfaces.ceiling],
    cabinetry: [...surfaces.cabinetry],
    countertop: [...surfaces.countertop],
    textile: [...surfaces.textile],
    metal: [...surfaces.metal],
  };
}

function addSurfacePrompt<T extends string>(
  target: string[],
  label: string,
  ids: readonly T[],
  options: readonly (InteriorOption<T> & { swatch: string })[],
) {
  if (!ids.length) return;
  const prompts = ids.map((id) => options.find((option) => option.id === id)!.prompt);
  const [primary, ...accents] = prompts;
  const accentPrompts = accents.map((prompt) => prompt.replace(/\s+flooring$/i, ""));
  target.push(
    `${label}: ${primary}${accentPrompts.length ? ` with ${accentPrompts.join(", ")} accents` : ""}`,
  );
}
