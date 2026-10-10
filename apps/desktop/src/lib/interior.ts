/**
 * TODO(interior-domain): temporary UI stand-ins for API_CONTRACTS.md §18.
 * Replace this module's exports with @arch/domain once wt/interior-domain lands.
 */
import type { ProjectDNA } from "@arch/domain";

export type CatalogOption<T extends string> = {
  id: T;
  vi: string;
  en: string;
  prompt?: string;
  swatch?: string;
};

const option = <T extends string>(
  id: T,
  vi: string,
  en: string,
  extra: Pick<CatalogOption<T>, "prompt" | "swatch"> = {},
): CatalogOption<T> => ({ id, vi, en, ...extra });

export const BUILDING_USES = [
  option("apartment", "Căn hộ", "Apartment"),
  option("studio", "Studio", "Studio"),
  option("duplex_penthouse", "Duplex / Penthouse", "Duplex / Penthouse"),
  option("townhouse", "Nhà phố", "Townhouse"),
  option("single_storey_house", "Nhà cấp 4", "Single-storey house"),
  option("villa", "Biệt thự", "Villa"),
  option("hotel_room_suite", "Phòng / suite khách sạn", "Hotel room / suite"),
  option("office", "Văn phòng", "Office"),
  option("cafe_restaurant", "Café / nhà hàng", "Café / restaurant"),
  option("retail_showroom", "Cửa hàng / showroom", "Retail / showroom"),
  option("spa", "Spa", "Spa"),
  option("resort", "Resort", "Resort"),
  option("other", "Khác", "Other"),
] as const;
export type BuildingUseId = (typeof BUILDING_USES)[number]["id"];

export const ROOMS = [
  option("living_room", "Phòng khách", "Living room"),
  option("kitchen", "Bếp", "Kitchen"),
  option("dining_room", "Phòng ăn", "Dining room"),
  option("living_kitchen", "Khách + bếp", "Living + kitchen"),
  option("master_bedroom", "Phòng ngủ master", "Master bedroom"),
  option("bedroom", "Phòng ngủ", "Bedroom"),
  option("kids_room", "Phòng trẻ em", "Kids' room"),
  option("bathroom", "Phòng tắm / WC", "Bathroom / WC"),
  option("walk_in_closet", "Phòng thay đồ", "Walk-in closet"),
  option("home_office", "Phòng làm việc", "Home office"),
  option("prayer_room", "Phòng thờ", "Prayer room"),
  option("lobby", "Sảnh", "Lobby"),
  option("reception", "Lễ tân", "Reception"),
  option("meeting_room", "Phòng họp", "Meeting room"),
  option("open_office", "Khu làm việc chung", "Open office"),
  option("cafe_dining", "Khu khách café / nhà hàng", "Café / restaurant seating"),
  option("bar_counter", "Quầy bar", "Bar counter"),
  option("retail_floor", "Khu bán hàng", "Retail floor"),
  option("spa_treatment", "Phòng trị liệu", "Spa treatment room"),
  option("other", "Khác", "Other"),
] as const;
export type RoomId = (typeof ROOMS)[number]["id"];

export const INTERIOR_STYLES = [
  option("modern", "Hiện đại", "Modern"),
  option("minimalist", "Tối giản", "Minimalist"),
  option("japandi", "Japandi", "Japandi"),
  option("wabi_sabi", "Wabi-sabi", "Wabi-sabi"),
  option("scandinavian", "Bắc Âu", "Scandinavian"),
  option("indochine", "Đông Dương", "Indochine"),
  option("contemporary", "Đương đại", "Contemporary"),
  option("luxury", "Sang trọng", "Luxury"),
  option("industrial", "Công nghiệp", "Industrial"),
  option("tropical", "Nhiệt đới", "Tropical"),
  option("modern_classic", "Tân cổ điển hiện đại", "Modern Classic"),
  option("neo_classic", "Tân cổ điển", "Neo Classic"),
  option("mediterranean", "Địa Trung Hải", "Mediterranean"),
  option("organic_modern", "Hữu cơ hiện đại", "Organic Modern"),
  option("mid_century_modern", "Mid-century Modern", "Mid-century Modern"),
] as const;
export type InteriorStyleId = (typeof INTERIOR_STYLES)[number]["id"];

export const PALETTES = [
  option("warm_neutral", "Be ấm", "Warm neutral", { swatch: "#d7c4a8" }),
  option("cool_neutral", "Xám lạnh", "Cool neutral", { swatch: "#bac1c5" }),
  option("earth", "Màu đất", "Earth", { swatch: "#a86f4c" }),
  option("monochrome", "Đen trắng", "Monochrome", { swatch: "#353535" }),
  option("green_natural", "Xanh rêu tự nhiên", "Natural green", { swatch: "#78836a" }),
  option("blue_coastal", "Xanh biển – cát", "Coastal blue", { swatch: "#7a9baa" }),
] as const;
export type PaletteId = (typeof PALETTES)[number]["id"];

export const PALETTE_SWATCHES: Record<PaletteId, readonly string[]> = {
  warm_neutral: ["#f3eadc", "#d7c4a8", "#a67c52", "#6c5746"],
  cool_neutral: ["#f3f4f2", "#bac1c5", "#889197", "#d8cfbd"],
  earth: ["#d8956f", "#9f6a4c", "#777052", "#e8d9c5"],
  monochrome: ["#f1f1ef", "#a9aaac", "#515255", "#171719"],
  green_natural: ["#d9d7bd", "#98a381", "#5f6b52", "#a77c51"],
  blue_coastal: ["#e7dfce", "#9bb6bd", "#577b8c", "#c7ad84"],
};

export const MATERIAL_PRESETS = [
  option("modern_clean", "Hiện đại tinh gọn", "Modern clean"),
  option("minimal_light", "Tối giản sáng", "Minimal light"),
  option("japandi_natural", "Japandi tự nhiên", "Japandi natural"),
  option("wabi_earth", "Wabi màu đất", "Wabi earth"),
  option("scandi_light", "Bắc Âu sáng", "Scandinavian light"),
  option("indochine_heritage", "Đông Dương di sản", "Indochine heritage"),
  option("luxury_stone", "Đá sang trọng", "Luxury stone"),
  option("industrial_raw", "Công nghiệp thô", "Industrial raw"),
  option("tropical_craft", "Thủ công nhiệt đới", "Tropical craft"),
  option("classic_detail", "Chi tiết cổ điển", "Classic detail"),
  option("mediterranean_warm", "Địa Trung Hải ấm", "Mediterranean warm"),
  option("organic_soft", "Hữu cơ mềm mại", "Organic soft"),
  option("midcentury_wood", "Gỗ Mid-century", "Mid-century wood"),
] as const;
export type MaterialPresetId = (typeof MATERIAL_PRESETS)[number]["id"];

export const SURFACE_CATALOG = {
  floor: [
    option("oak", "Gỗ sồi", "Oak", { swatch: "#b88a58" }),
    option("walnut", "Gỗ óc chó", "Walnut", { swatch: "#65452f" }),
    option("terrazzo", "Terrazzo", "Terrazzo", { swatch: "#c8bda9" }),
    option("porcelain_tile", "Gạch porcelain", "Porcelain tile", { swatch: "#c7c5bf" }),
    option("cement_tile", "Gạch bông", "Cement tile", { swatch: "#8f9894" }),
    option("microcement", "Microcement", "Microcement", { swatch: "#aaa49b" }),
    option("natural_stone", "Đá tự nhiên", "Natural stone", { swatch: "#aaa18e" }),
    option("polished_concrete", "Bê tông mài", "Polished concrete", { swatch: "#898986" }),
  ],
  wall: [
    option("paint", "Sơn", "Paint", { swatch: "#e8e3d8" }),
    option("limewash", "Sơn vôi", "Limewash", { swatch: "#d8cfbe" }),
    option("plaster", "Vữa trát", "Plaster", { swatch: "#cbbba3" }),
    option("microcement", "Microcement", "Microcement", { swatch: "#aaa49b" }),
    option("exposed_brick", "Gạch trần", "Exposed brick", { swatch: "#9b5f49" }),
    option("wood_panel", "Ốp gỗ", "Wood panel", { swatch: "#8f6745" }),
    option("wallpaper", "Giấy dán tường", "Wallpaper", { swatch: "#c6bda9" }),
    option("stone_cladding", "Ốp đá", "Stone cladding", { swatch: "#9b9487" }),
  ],
  ceiling: [
    option("painted_gypsum", "Thạch cao sơn", "Painted gypsum", { swatch: "#eeeae1" }),
    option("wood_slats", "Nan gỗ", "Wood slats", { swatch: "#9d754f" }),
    option("exposed_concrete", "Bê tông trần", "Exposed concrete", { swatch: "#969491" }),
    option("cove_ceiling", "Trần hắt khe", "Cove ceiling", { swatch: "#e0ddd4" }),
    option("exposed_beams", "Dầm lộ", "Exposed beams", { swatch: "#75563c" }),
  ],
  cabinetry: [
    option("oak_veneer", "Veneer sồi", "Oak veneer", { swatch: "#b48a60" }),
    option("walnut_veneer", "Veneer óc chó", "Walnut veneer", { swatch: "#67472f" }),
    option("painted_mdf", "MDF sơn", "Painted MDF", { swatch: "#d3d0c8" }),
    option("solid_teak", "Gỗ teak đặc", "Solid teak", { swatch: "#9a6d3f" }),
    option("rattan_cane", "Mây đan", "Rattan cane", { swatch: "#c5a36d" }),
    option("lacquer", "Sơn mài", "Lacquer", { swatch: "#45413d" }),
  ],
  countertop: [
    option("marble", "Đá marble", "Marble", { swatch: "#dedbd2" }),
    option("quartz", "Đá quartz", "Quartz", { swatch: "#d2d0c8" }),
    option("granite", "Đá granite", "Granite", { swatch: "#77736e" }),
    option("travertine", "Đá travertine", "Travertine", { swatch: "#c2ad8d" }),
    option("terrazzo", "Terrazzo", "Terrazzo", { swatch: "#c8bda9" }),
    option("solid_wood", "Gỗ đặc", "Solid wood", { swatch: "#8e633e" }),
  ],
  textile: [
    option("linen", "Vải linen", "Linen", { swatch: "#d2c4ae" }),
    option("cotton", "Vải cotton", "Cotton", { swatch: "#e1ded4" }),
    option("wool", "Len", "Wool", { swatch: "#aaa294" }),
    option("velvet", "Nhung", "Velvet", { swatch: "#6c665c" }),
    option("leather", "Da", "Leather", { swatch: "#875c3c" }),
    option("boucle", "Vải bouclé", "Bouclé", { swatch: "#d8d0c1" }),
  ],
  metal: [
    option("matte_black", "Đen mờ", "Matte black", { swatch: "#292a2b" }),
    option("brushed_brass", "Đồng xước", "Brushed brass", { swatch: "#b08d57" }),
    option("bronze", "Đồng bronze", "Bronze", { swatch: "#806044" }),
    option("stainless_steel", "Thép không gỉ", "Stainless steel", { swatch: "#adb2b3" }),
    option("chrome", "Chrome", "Chrome", { swatch: "#d2d6d6" }),
  ],
} as const;

export type SurfaceSlot = keyof typeof SURFACE_CATALOG;
export type FloorMaterialId = (typeof SURFACE_CATALOG.floor)[number]["id"];
export type WallMaterialId = (typeof SURFACE_CATALOG.wall)[number]["id"];
export type CeilingMaterialId = (typeof SURFACE_CATALOG.ceiling)[number]["id"];
export type CabinetryMaterialId = (typeof SURFACE_CATALOG.cabinetry)[number]["id"];
export type CountertopMaterialId = (typeof SURFACE_CATALOG.countertop)[number]["id"];
export type TextileMaterialId = (typeof SURFACE_CATALOG.textile)[number]["id"];
export type MetalFinishId = (typeof SURFACE_CATALOG.metal)[number]["id"];

export type InteriorSurfaces = {
  floor: FloorMaterialId[];
  wall: WallMaterialId[];
  ceiling: CeilingMaterialId[];
  cabinetry: CabinetryMaterialId[];
  countertop: CountertopMaterialId[];
  textile: TextileMaterialId[];
  metal: MetalFinishId[];
};

export const FURNITURE = [
  option("sofa", "Sofa", "Sofa"),
  option("armchair", "Ghế bành", "Armchair"),
  option("coffee_table", "Bàn trà", "Coffee table"),
  option("media_console", "Kệ TV", "Media console"),
  option("rug", "Thảm", "Rug"),
  option("dining_table", "Bàn ăn", "Dining table"),
  option("dining_chairs", "Ghế ăn", "Dining chairs"),
  option("island", "Đảo bếp", "Kitchen island"),
  option("bar_stools", "Ghế bar", "Bar stools"),
  option("bed", "Giường", "Bed"),
  option("bedside_tables", "Tab đầu giường", "Bedside tables"),
  option("wardrobe", "Tủ quần áo", "Wardrobe"),
  option("dressing_table", "Bàn trang điểm", "Dressing table"),
  option("desk", "Bàn làm việc", "Desk"),
  option("bookshelf", "Kệ sách", "Bookshelf"),
  option("vanity", "Tủ lavabo", "Vanity"),
  option("bathtub", "Bồn tắm", "Bathtub"),
  option("walk_in_shower", "Buồng tắm", "Walk-in shower"),
  option("altar_cabinet", "Tủ thờ", "Altar cabinet"),
  option("reception_desk", "Quầy lễ tân", "Reception desk"),
  option("lounge_seating", "Ghế lounge", "Lounge seating"),
  option("display_shelving", "Kệ trưng bày", "Display shelving"),
  option("treatment_bed", "Giường trị liệu", "Treatment bed"),
  option("meeting_table", "Bàn họp", "Meeting table"),
] as const;
export type FurnitureId = (typeof FURNITURE)[number]["id"];

export type InteriorDNA = {
  schemaVersion: 1;
  buildingUseId: BuildingUseId;
  roomId: RoomId;
  styleId: InteriorStyleId;
  paletteId?: PaletteId;
  materialPresetId?: MaterialPresetId;
  surfaces: InteriorSurfaces;
  daylightDirection?: "front" | "left" | "right" | "rear" | "diffuse" | "none";
  daylightAmount?: "low" | "medium" | "high";
  timeOfDay?: "morning" | "midday" | "afternoon" | "golden_hour" | "evening" | "night";
  artificialScenes: ("ambient" | "task" | "accent" | "cove" | "pendant" | "downlight")[];
  colorTemperatureK?: 2700 | 3000 | 3500 | 4000;
  furnitureIds: FurnitureId[];
  furnishingDensity: "minimal" | "balanced" | "layered";
  cameraPresetId?: "wide_entrance" | "corner" | "one_point" | "detail";
  areaM2?: number;
  ceilingHeightM?: number;
};

export type ProjectDNAWithInterior = ProjectDNA & { interior?: InteriorDNA };

const ALL_ROOMS = ROOMS.map((room) => room.id);
const RESIDENTIAL: RoomId[] = [
  "living_room",
  "kitchen",
  "dining_room",
  "living_kitchen",
  "master_bedroom",
  "bedroom",
  "kids_room",
  "bathroom",
  "walk_in_closet",
  "home_office",
  "prayer_room",
];
const ROOM_MAP: Record<BuildingUseId, readonly RoomId[]> = {
  apartment: RESIDENTIAL,
  studio: ["living_kitchen", "bedroom", "bathroom", "walk_in_closet", "home_office"],
  duplex_penthouse: RESIDENTIAL,
  townhouse: [...RESIDENTIAL, "lobby"],
  single_storey_house: RESIDENTIAL,
  villa: [...RESIDENTIAL, "lobby"],
  hotel_room_suite: [
    "master_bedroom",
    "bedroom",
    "bathroom",
    "living_room",
    "lobby",
    "reception",
    "cafe_dining",
    "bar_counter",
    "spa_treatment",
  ],
  office: ["lobby", "reception", "meeting_room", "open_office", "home_office"],
  cafe_restaurant: ["cafe_dining", "bar_counter", "kitchen"],
  retail_showroom: ["retail_floor", "reception"],
  spa: ["spa_treatment", "reception", "lobby"],
  resort: [
    "master_bedroom",
    "bedroom",
    "bathroom",
    "living_room",
    "lobby",
    "reception",
    "cafe_dining",
    "bar_counter",
    "spa_treatment",
  ],
  other: ALL_ROOMS,
};

export function roomsForUse(id: BuildingUseId): RoomId[] {
  return [...ROOM_MAP[id], ...(ROOM_MAP[id].includes("other") ? [] : (["other"] as RoomId[]))];
}

const STYLE_DEFAULTS: Record<
  InteriorStyleId,
  { paletteId: PaletteId; materialPresetId: MaterialPresetId }
> = {
  modern: { paletteId: "cool_neutral", materialPresetId: "modern_clean" },
  minimalist: { paletteId: "warm_neutral", materialPresetId: "minimal_light" },
  japandi: { paletteId: "warm_neutral", materialPresetId: "japandi_natural" },
  wabi_sabi: { paletteId: "earth", materialPresetId: "wabi_earth" },
  scandinavian: { paletteId: "cool_neutral", materialPresetId: "scandi_light" },
  indochine: { paletteId: "earth", materialPresetId: "indochine_heritage" },
  contemporary: { paletteId: "cool_neutral", materialPresetId: "modern_clean" },
  luxury: { paletteId: "warm_neutral", materialPresetId: "luxury_stone" },
  industrial: { paletteId: "monochrome", materialPresetId: "industrial_raw" },
  tropical: { paletteId: "green_natural", materialPresetId: "tropical_craft" },
  modern_classic: { paletteId: "warm_neutral", materialPresetId: "classic_detail" },
  neo_classic: { paletteId: "warm_neutral", materialPresetId: "classic_detail" },
  mediterranean: { paletteId: "blue_coastal", materialPresetId: "mediterranean_warm" },
  organic_modern: { paletteId: "warm_neutral", materialPresetId: "organic_soft" },
  mid_century_modern: { paletteId: "earth", materialPresetId: "midcentury_wood" },
};

const ps = (
  floor: FloorMaterialId,
  wall: WallMaterialId,
  ceiling: CeilingMaterialId,
  cabinetry: CabinetryMaterialId,
  countertop: CountertopMaterialId,
  textile: TextileMaterialId,
  metal: MetalFinishId,
): InteriorSurfaces => ({
  floor: [floor],
  wall: [wall],
  ceiling: [ceiling],
  cabinetry: [cabinetry],
  countertop: [countertop],
  textile: [textile],
  metal: [metal],
});

const PRESET_SURFACES: Record<MaterialPresetId, InteriorSurfaces> = {
  modern_clean: ps(
    "porcelain_tile",
    "paint",
    "painted_gypsum",
    "painted_mdf",
    "quartz",
    "linen",
    "matte_black",
  ),
  minimal_light: ps(
    "oak",
    "paint",
    "painted_gypsum",
    "oak_veneer",
    "quartz",
    "linen",
    "matte_black",
  ),
  japandi_natural: ps(
    "oak",
    "limewash",
    "wood_slats",
    "oak_veneer",
    "solid_wood",
    "linen",
    "matte_black",
  ),
  wabi_earth: ps(
    "microcement",
    "plaster",
    "exposed_beams",
    "solid_teak",
    "travertine",
    "linen",
    "bronze",
  ),
  scandi_light: ps(
    "oak",
    "paint",
    "painted_gypsum",
    "oak_veneer",
    "terrazzo",
    "wool",
    "matte_black",
  ),
  indochine_heritage: ps(
    "cement_tile",
    "paint",
    "wood_slats",
    "solid_teak",
    "marble",
    "velvet",
    "brushed_brass",
  ),
  luxury_stone: ps(
    "natural_stone",
    "stone_cladding",
    "cove_ceiling",
    "lacquer",
    "marble",
    "velvet",
    "brushed_brass",
  ),
  industrial_raw: ps(
    "polished_concrete",
    "exposed_brick",
    "exposed_concrete",
    "painted_mdf",
    "granite",
    "leather",
    "matte_black",
  ),
  tropical_craft: ps(
    "terrazzo",
    "limewash",
    "wood_slats",
    "rattan_cane",
    "solid_wood",
    "linen",
    "bronze",
  ),
  classic_detail: ps(
    "oak",
    "wallpaper",
    "cove_ceiling",
    "painted_mdf",
    "marble",
    "velvet",
    "brushed_brass",
  ),
  mediterranean_warm: ps(
    "natural_stone",
    "plaster",
    "exposed_beams",
    "solid_teak",
    "travertine",
    "linen",
    "bronze",
  ),
  organic_soft: ps(
    "oak",
    "limewash",
    "painted_gypsum",
    "oak_veneer",
    "travertine",
    "boucle",
    "brushed_brass",
  ),
  midcentury_wood: ps(
    "walnut",
    "wood_panel",
    "painted_gypsum",
    "walnut_veneer",
    "solid_wood",
    "leather",
    "brushed_brass",
  ),
};

export const styleDefaults = (styleId: InteriorStyleId) => ({ ...STYLE_DEFAULTS[styleId] });
export const presetSurfaces = (presetId: MaterialPresetId): InteriorSurfaces =>
  structuredClone(PRESET_SURFACES[presetId]);

export function applyStyleDefaults(interior: InteriorDNA, styleId: InteriorStyleId): InteriorDNA {
  const defaults = styleDefaults(styleId);
  const preset = presetSurfaces(defaults.materialPresetId);
  return {
    ...interior,
    styleId,
    ...defaults,
    surfaces: Object.fromEntries(
      (Object.keys(interior.surfaces) as SurfaceSlot[]).map((slot) => [
        slot,
        interior.surfaces[slot].length ? interior.surfaces[slot] : preset[slot],
      ]),
    ) as InteriorSurfaces,
  };
}

export function defaultInteriorDNA(
  use: BuildingUseId = "apartment",
  room: RoomId = "living_room",
  style: InteriorStyleId = "japandi",
): InteriorDNA {
  const validRoom = roomsForUse(use).includes(room) ? room : "other";
  return applyStyleDefaults(
    {
      schemaVersion: 1,
      buildingUseId: use,
      roomId: validRoom,
      styleId: style,
      surfaces: {
        floor: [],
        wall: [],
        ceiling: [],
        cabinetry: [],
        countertop: [],
        textile: [],
        metal: [],
      },
      artificialScenes: [],
      furnitureIds: [],
      furnishingDensity: "balanced",
    },
    style,
  );
}

const FURNITURE_BY_ROOM: Partial<Record<RoomId, readonly FurnitureId[]>> = {
  living_room: ["sofa", "armchair", "coffee_table", "media_console", "rug"],
  kitchen: ["island", "bar_stools"],
  dining_room: ["dining_table", "dining_chairs"],
  living_kitchen: [
    "sofa",
    "coffee_table",
    "rug",
    "island",
    "bar_stools",
    "dining_table",
    "dining_chairs",
  ],
  master_bedroom: ["bed", "bedside_tables", "wardrobe", "dressing_table", "rug"],
  bedroom: ["bed", "bedside_tables", "wardrobe"],
  kids_room: ["bed", "wardrobe", "desk", "bookshelf"],
  bathroom: ["vanity", "bathtub", "walk_in_shower"],
  walk_in_closet: ["wardrobe", "dressing_table"],
  home_office: ["desk", "bookshelf", "armchair"],
  prayer_room: ["altar_cabinet"],
  lobby: ["lounge_seating", "reception_desk", "rug"],
  reception: ["reception_desk", "lounge_seating"],
  meeting_room: ["meeting_table", "armchair"],
  open_office: ["desk", "bookshelf", "meeting_table"],
  cafe_dining: ["dining_table", "dining_chairs", "lounge_seating"],
  bar_counter: ["bar_stools", "display_shelving"],
  retail_floor: ["display_shelving", "reception_desk"],
  spa_treatment: ["treatment_bed", "vanity", "lounge_seating"],
};

export function furnitureForRoom(roomId: RoomId): FurnitureId[] {
  return [...(FURNITURE_BY_ROOM[roomId] ?? [])];
}

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
const matchOption = <T extends string>(
  value: string | undefined,
  list: readonly CatalogOption<T>[],
) =>
  value
    ? list.find((item) =>
        [item.id, item.vi, item.en].some((candidate) => fold(candidate) === fold(value)),
      )?.id
    : undefined;

export function proposeInteriorFromLegacy(dna: ProjectDNA): {
  proposal: InteriorDNA;
  matched: string[];
} {
  const matched: string[] = [];
  const use = matchOption(dna.building.buildingType, BUILDING_USES);
  const style = matchOption(dna.building.architecturalStyle, INTERIOR_STYLES);
  if (use) matched.push("building.buildingType");
  if (style) matched.push("building.architecturalStyle");
  let proposal = defaultInteriorDNA(use, undefined, style);
  const descriptions = dna.building.materials.flatMap((material) => [
    material.zone,
    material.description,
  ]);
  const surfaces = { ...proposal.surfaces };
  for (const slot of Object.keys(SURFACE_CATALOG) as SurfaceSlot[]) {
    const found = descriptions
      .map((description) => matchOption(description, SURFACE_CATALOG[slot]))
      .filter((id): id is never => !!id);
    if (found.length) {
      (surfaces[slot] as string[]) = [...new Set(found)];
      matched.push(`building.materials → ${slot}`);
    }
  }
  proposal = { ...proposal, surfaces };
  return { proposal, matched };
}

export const INTERIOR_CATALOG = {
  buildingUses: BUILDING_USES,
  rooms: ROOMS,
  styles: INTERIOR_STYLES,
  palettes: PALETTES,
  materialPresets: MATERIAL_PRESETS,
  surfaces: SURFACE_CATALOG,
  furniture: FURNITURE,
} as const;

export const catalogLabel = <T extends string>(
  list: readonly CatalogOption<T>[],
  id: T | undefined,
  locale: "vi" | "en",
) => list.find((item) => item.id === id)?.[locale] ?? id ?? "—";

/** TODO(interior-domain): prompt compilation is owned by the incoming domain module. */
export function interiorPromptLines(_dna: ProjectDNAWithInterior): string[] {
  return [];
}
