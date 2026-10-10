/** Stable Interior DNA pick-lists. IDs are persisted; labels and prompts may be presented. */
export type InteriorOption<Id extends string = string> = {
  id: Id;
  vi: string;
  en: string;
  prompt: string;
};

export const BUILDING_USES = [
  { id: "apartment", vi: "Căn hộ", en: "Apartment", prompt: "apartment" },
  { id: "studio", vi: "Studio", en: "Studio", prompt: "studio apartment" },
  {
    id: "duplex_penthouse",
    vi: "Duplex / Penthouse",
    en: "Duplex / Penthouse",
    prompt: "duplex penthouse",
  },
  { id: "townhouse", vi: "Nhà phố", en: "Townhouse", prompt: "townhouse" },
  {
    id: "single_storey_house",
    vi: "Nhà cấp 4",
    en: "Single-storey house",
    prompt: "single-storey house",
  },
  { id: "villa", vi: "Biệt thự", en: "Villa", prompt: "villa" },
  {
    id: "hotel_room_suite",
    vi: "Phòng / suite khách sạn",
    en: "Hotel room / suite",
    prompt: "hotel suite",
  },
  { id: "office", vi: "Văn phòng", en: "Office", prompt: "office" },
  {
    id: "cafe_restaurant",
    vi: "Café / nhà hàng",
    en: "Café / restaurant",
    prompt: "café restaurant",
  },
  {
    id: "retail_showroom",
    vi: "Cửa hàng / showroom",
    en: "Retail / showroom",
    prompt: "retail showroom",
  },
  { id: "spa", vi: "Spa", en: "Spa", prompt: "spa" },
  { id: "resort", vi: "Resort", en: "Resort", prompt: "resort" },
  { id: "other", vi: "Khác", en: "Other", prompt: "interior" },
] as const satisfies readonly InteriorOption[];

export const ROOMS = [
  { id: "living_room", vi: "Phòng khách", en: "Living room", prompt: "living room" },
  { id: "kitchen", vi: "Bếp", en: "Kitchen", prompt: "kitchen" },
  { id: "dining_room", vi: "Phòng ăn", en: "Dining room", prompt: "dining room" },
  {
    id: "living_kitchen",
    vi: "Khách + bếp",
    en: "Living + kitchen",
    prompt: "open-plan living and kitchen",
  },
  {
    id: "master_bedroom",
    vi: "Phòng ngủ master",
    en: "Master bedroom",
    prompt: "master bedroom",
  },
  { id: "bedroom", vi: "Phòng ngủ", en: "Bedroom", prompt: "bedroom" },
  {
    id: "kids_room",
    vi: "Phòng trẻ em",
    en: "Children's room",
    prompt: "children's bedroom",
  },
  { id: "bathroom", vi: "Phòng tắm / WC", en: "Bathroom / WC", prompt: "bathroom" },
  {
    id: "walk_in_closet",
    vi: "Phòng thay đồ",
    en: "Walk-in closet",
    prompt: "walk-in closet",
  },
  { id: "home_office", vi: "Phòng làm việc", en: "Home office", prompt: "home office" },
  {
    id: "prayer_room",
    vi: "Phòng thờ",
    en: "Prayer room",
    prompt: "Vietnamese family altar room",
  },
  { id: "lobby", vi: "Sảnh", en: "Lobby", prompt: "lobby" },
  { id: "reception", vi: "Lễ tân", en: "Reception", prompt: "reception area" },
  { id: "meeting_room", vi: "Phòng họp", en: "Meeting room", prompt: "meeting room" },
  {
    id: "open_office",
    vi: "Khu làm việc chung",
    en: "Open office",
    prompt: "open-plan office",
  },
  {
    id: "cafe_dining",
    vi: "Khu khách café / nhà hàng",
    en: "Café / restaurant dining",
    prompt: "café dining area",
  },
  { id: "bar_counter", vi: "Quầy bar", en: "Bar counter", prompt: "bar counter" },
  { id: "retail_floor", vi: "Khu bán hàng", en: "Retail floor", prompt: "retail floor" },
  {
    id: "spa_treatment",
    vi: "Phòng trị liệu",
    en: "Spa treatment room",
    prompt: "spa treatment room",
  },
  { id: "other", vi: "Khác", en: "Other", prompt: "interior room" },
] as const satisfies readonly InteriorOption[];

export const PALETTES = [
  {
    id: "warm_neutral",
    vi: "Be ấm",
    en: "Warm neutral",
    prompt: "warm beige, ivory and natural wood",
    swatches: ["#D8C3A5", "#F3EBDD", "#A77B55", "#EEE4D2"],
  },
  {
    id: "cool_neutral",
    vi: "Xám lạnh",
    en: "Cool neutral",
    prompt: "soft gray, white and pale wood",
    swatches: ["#C9CDD0", "#F5F5F2", "#D8C7AA", "#8D9498"],
  },
  {
    id: "earth",
    vi: "Màu đất",
    en: "Earth",
    prompt: "terracotta, earthy brown and olive",
    swatches: ["#B76543", "#795548", "#77734E", "#D6B98C"],
  },
  {
    id: "monochrome",
    vi: "Đen trắng",
    en: "Monochrome",
    prompt: "black, white and charcoal",
    swatches: ["#171717", "#F4F4F1", "#4A4A48", "#A9A9A6"],
  },
  {
    id: "green_natural",
    vi: "Xanh rêu tự nhiên",
    en: "Natural green",
    prompt: "sage green, natural wood and cream",
    swatches: ["#89947A", "#A77B55", "#F2E8D5", "#5E674F"],
  },
  {
    id: "blue_coastal",
    vi: "Xanh biển – cát",
    en: "Coastal blue",
    prompt: "muted blue and sand white",
    swatches: ["#6E8797", "#E9DFC9", "#F6F2E8", "#A9C0C8"],
  },
] as const satisfies readonly (InteriorOption & { swatches: readonly string[] })[];

export const FLOOR_MATERIALS = [
  { id: "oak", vi: "Gỗ sồi", en: "Oak", prompt: "natural oak flooring", swatch: "#B88A5A" },
  { id: "walnut", vi: "Gỗ óc chó", en: "Walnut", prompt: "walnut flooring", swatch: "#6B4226" },
  {
    id: "terrazzo",
    vi: "Đá terrazzo",
    en: "Terrazzo",
    prompt: "terrazzo flooring",
    swatch: "#C9BDAA",
  },
  {
    id: "porcelain_tile",
    vi: "Gạch porcelain",
    en: "Porcelain tile",
    prompt: "porcelain tile flooring",
    swatch: "#D8D5CD",
  },
  {
    id: "cement_tile",
    vi: "Gạch bông",
    en: "Cement tile",
    prompt: "patterned cement tile flooring",
    swatch: "#8F9A91",
  },
  {
    id: "microcement",
    vi: "Vi xi măng",
    en: "Microcement",
    prompt: "seamless microcement flooring",
    swatch: "#A7A39A",
  },
  {
    id: "natural_stone",
    vi: "Đá tự nhiên",
    en: "Natural stone",
    prompt: "natural stone flooring",
    swatch: "#B9AD9B",
  },
  {
    id: "polished_concrete",
    vi: "Bê tông mài",
    en: "Polished concrete",
    prompt: "polished concrete flooring",
    swatch: "#8B8B86",
  },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const WALL_MATERIALS = [
  { id: "paint", vi: "Sơn", en: "Paint", prompt: "painted walls", swatch: "#E7E3DA" },
  {
    id: "limewash",
    vi: "Sơn vôi",
    en: "Limewash",
    prompt: "soft limewash walls",
    swatch: "#D8CEBC",
  },
  {
    id: "plaster",
    vi: "Vữa trát",
    en: "Plaster",
    prompt: "textured plaster walls",
    swatch: "#C8B9A3",
  },
  {
    id: "microcement",
    vi: "Vi xi măng",
    en: "Microcement",
    prompt: "microcement walls",
    swatch: "#A7A39A",
  },
  {
    id: "exposed_brick",
    vi: "Gạch trần",
    en: "Exposed brick",
    prompt: "exposed brick walls",
    swatch: "#995E47",
  },
  {
    id: "wood_panel",
    vi: "Ốp gỗ",
    en: "Wood panel",
    prompt: "wood-panelled walls",
    swatch: "#8A6243",
  },
  {
    id: "wallpaper",
    vi: "Giấy dán tường",
    en: "Wallpaper",
    prompt: "refined wallpaper",
    swatch: "#BEB5A6",
  },
  {
    id: "stone_cladding",
    vi: "Ốp đá",
    en: "Stone cladding",
    prompt: "natural stone wall cladding",
    swatch: "#B2A590",
  },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const CEILING_MATERIALS = [
  {
    id: "painted_gypsum",
    vi: "Thạch cao sơn",
    en: "Painted gypsum",
    prompt: "painted gypsum ceiling",
    swatch: "#F0EEE8",
  },
  {
    id: "wood_slats",
    vi: "Nan gỗ",
    en: "Wood slats",
    prompt: "wood-slat ceiling",
    swatch: "#A47750",
  },
  {
    id: "exposed_concrete",
    vi: "Bê tông trần",
    en: "Exposed concrete",
    prompt: "exposed concrete ceiling",
    swatch: "#92918C",
  },
  {
    id: "cove_ceiling",
    vi: "Trần giật cấp",
    en: "Cove ceiling",
    prompt: "layered cove ceiling",
    swatch: "#E5E0D6",
  },
  {
    id: "exposed_beams",
    vi: "Dầm lộ",
    en: "Exposed beams",
    prompt: "exposed ceiling beams",
    swatch: "#7A5A40",
  },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const CABINETRY_MATERIALS = [
  {
    id: "oak_veneer",
    vi: "Veneer sồi",
    en: "Oak veneer",
    prompt: "oak veneer cabinetry",
    swatch: "#B38658",
  },
  {
    id: "walnut_veneer",
    vi: "Veneer óc chó",
    en: "Walnut veneer",
    prompt: "walnut veneer cabinetry",
    swatch: "#68432D",
  },
  {
    id: "painted_mdf",
    vi: "MDF sơn",
    en: "Painted MDF",
    prompt: "painted MDF cabinetry",
    swatch: "#D7D5CF",
  },
  {
    id: "solid_teak",
    vi: "Gỗ teak đặc",
    en: "Solid teak",
    prompt: "solid teak cabinetry",
    swatch: "#9B6B3E",
  },
  {
    id: "rattan_cane",
    vi: "Mây đan",
    en: "Rattan cane",
    prompt: "woven rattan cane cabinetry",
    swatch: "#C49A64",
  },
  { id: "lacquer", vi: "Sơn mài", en: "Lacquer", prompt: "lacquered cabinetry", swatch: "#403D39" },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const COUNTERTOP_MATERIALS = [
  {
    id: "marble",
    vi: "Đá cẩm thạch",
    en: "Marble",
    prompt: "marble countertop",
    swatch: "#E2DED5",
  },
  {
    id: "quartz",
    vi: "Đá thạch anh",
    en: "Quartz",
    prompt: "quartz countertop",
    swatch: "#D5D2CA",
  },
  {
    id: "granite",
    vi: "Đá granite",
    en: "Granite",
    prompt: "granite countertop",
    swatch: "#77736D",
  },
  {
    id: "travertine",
    vi: "Đá travertine",
    en: "Travertine",
    prompt: "travertine countertop",
    swatch: "#C9B38F",
  },
  {
    id: "terrazzo",
    vi: "Đá terrazzo",
    en: "Terrazzo",
    prompt: "terrazzo countertop",
    swatch: "#C5B9A6",
  },
  {
    id: "solid_wood",
    vi: "Gỗ đặc",
    en: "Solid wood",
    prompt: "solid wood countertop",
    swatch: "#8D613E",
  },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const TEXTILE_MATERIALS = [
  { id: "linen", vi: "Vải lanh", en: "Linen", prompt: "natural linen textiles", swatch: "#D8CBB8" },
  {
    id: "cotton",
    vi: "Vải cotton",
    en: "Cotton",
    prompt: "soft cotton textiles",
    swatch: "#E5DED0",
  },
  { id: "wool", vi: "Len", en: "Wool", prompt: "woven wool textiles", swatch: "#B7AA96" },
  { id: "velvet", vi: "Nhung", en: "Velvet", prompt: "rich velvet textiles", swatch: "#665249" },
  {
    id: "leather",
    vi: "Da",
    en: "Leather",
    prompt: "natural leather upholstery",
    swatch: "#8B5B3C",
  },
  {
    id: "boucle",
    vi: "Vải bouclé",
    en: "Bouclé",
    prompt: "textured bouclé upholstery",
    swatch: "#D1C7B6",
  },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const METAL_FINISHES = [
  {
    id: "matte_black",
    vi: "Đen mờ",
    en: "Matte black",
    prompt: "matte black metal",
    swatch: "#292927",
  },
  {
    id: "brushed_brass",
    vi: "Đồng thau xước",
    en: "Brushed brass",
    prompt: "brushed brass metal",
    swatch: "#B08D57",
  },
  { id: "bronze", vi: "Đồng cổ", en: "Bronze", prompt: "aged bronze metal", swatch: "#7B5A3A" },
  {
    id: "stainless_steel",
    vi: "Thép không gỉ",
    en: "Stainless steel",
    prompt: "stainless steel",
    swatch: "#B7BDC0",
  },
  { id: "chrome", vi: "Crôm", en: "Chrome", prompt: "polished chrome", swatch: "#D4D9DB" },
] as const satisfies readonly (InteriorOption & { swatch: string })[];

export const FURNITURE = [
  { id: "sofa", vi: "Sofa", en: "Sofa", prompt: "sofa" },
  { id: "armchair", vi: "Ghế bành", en: "Armchair", prompt: "armchair" },
  { id: "coffee_table", vi: "Bàn trà", en: "Coffee table", prompt: "coffee table" },
  { id: "media_console", vi: "Kệ TV", en: "Media console", prompt: "media console" },
  { id: "rug", vi: "Thảm", en: "Rug", prompt: "area rug" },
  { id: "dining_table", vi: "Bàn ăn", en: "Dining table", prompt: "dining table" },
  { id: "dining_chairs", vi: "Ghế ăn", en: "Dining chairs", prompt: "dining chairs" },
  { id: "island", vi: "Đảo bếp", en: "Kitchen island", prompt: "kitchen island" },
  { id: "bar_stools", vi: "Ghế bar", en: "Bar stools", prompt: "bar stools" },
  { id: "bed", vi: "Giường", en: "Bed", prompt: "bed" },
  { id: "bedside_tables", vi: "Táp đầu giường", en: "Bedside tables", prompt: "bedside tables" },
  { id: "wardrobe", vi: "Tủ quần áo", en: "Wardrobe", prompt: "wardrobe" },
  { id: "dressing_table", vi: "Bàn trang điểm", en: "Dressing table", prompt: "dressing table" },
  { id: "desk", vi: "Bàn làm việc", en: "Desk", prompt: "desk" },
  { id: "bookshelf", vi: "Kệ sách", en: "Bookshelf", prompt: "bookshelf" },
  { id: "vanity", vi: "Bàn lavabo", en: "Vanity", prompt: "bathroom vanity" },
  { id: "bathtub", vi: "Bồn tắm", en: "Bathtub", prompt: "bathtub" },
  { id: "walk_in_shower", vi: "Buồng tắm đứng", en: "Walk-in shower", prompt: "walk-in shower" },
  { id: "altar_cabinet", vi: "Tủ thờ", en: "Altar cabinet", prompt: "Vietnamese altar cabinet" },
  { id: "reception_desk", vi: "Quầy lễ tân", en: "Reception desk", prompt: "reception desk" },
  { id: "lounge_seating", vi: "Ghế chờ", en: "Lounge seating", prompt: "lounge seating" },
  {
    id: "display_shelving",
    vi: "Kệ trưng bày",
    en: "Display shelving",
    prompt: "display shelving",
  },
  { id: "treatment_bed", vi: "Giường trị liệu", en: "Treatment bed", prompt: "treatment bed" },
  { id: "meeting_table", vi: "Bàn họp", en: "Meeting table", prompt: "meeting table" },
] as const satisfies readonly InteriorOption[];

export const CAMERA_PRESETS = [
  {
    id: "wide_entrance",
    vi: "Góc rộng từ cửa vào",
    en: "Wide from entrance",
    prompt: "wide view from the entrance showing the whole room",
  },
  {
    id: "corner",
    vi: "Góc phòng",
    en: "Corner view",
    prompt: "two-point perspective from a room corner",
  },
  {
    id: "one_point",
    vi: "Phối cảnh một điểm tụ",
    en: "One-point perspective",
    prompt: "one-point perspective facing the main wall",
  },
  {
    id: "detail",
    vi: "Góc cận cảnh",
    en: "Detail view",
    prompt: "close-up material and furniture detail",
  },
] as const satisfies readonly InteriorOption[];

export type BuildingUseId = (typeof BUILDING_USES)[number]["id"];
export type RoomId = (typeof ROOMS)[number]["id"];
export type PaletteId = (typeof PALETTES)[number]["id"];
export type FloorMaterialId = (typeof FLOOR_MATERIALS)[number]["id"];
export type WallMaterialId = (typeof WALL_MATERIALS)[number]["id"];
export type CeilingMaterialId = (typeof CEILING_MATERIALS)[number]["id"];
export type CabinetryMaterialId = (typeof CABINETRY_MATERIALS)[number]["id"];
export type CountertopMaterialId = (typeof COUNTERTOP_MATERIALS)[number]["id"];
export type TextileMaterialId = (typeof TEXTILE_MATERIALS)[number]["id"];
export type MetalFinishId = (typeof METAL_FINISHES)[number]["id"];
export type FurnitureId = (typeof FURNITURE)[number]["id"];
export type InteriorCameraPresetId = (typeof CAMERA_PRESETS)[number]["id"];

const RESIDENTIAL_ROOMS: readonly RoomId[] = [
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
  "other",
];

/** Canonical room cascade, shared by Zod validation and the public roomsForUse helper. */
export const ROOM_IDS_BY_USE: Readonly<Record<BuildingUseId, readonly RoomId[]>> = {
  apartment: RESIDENTIAL_ROOMS,
  studio: ["living_kitchen", "bedroom", "bathroom", "walk_in_closet", "home_office", "other"],
  duplex_penthouse: RESIDENTIAL_ROOMS,
  townhouse: [...RESIDENTIAL_ROOMS.slice(0, -1), "lobby", "other"],
  single_storey_house: RESIDENTIAL_ROOMS,
  villa: [...RESIDENTIAL_ROOMS.slice(0, -1), "lobby", "other"],
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
    "other",
  ],
  office: ["lobby", "reception", "meeting_room", "open_office", "home_office", "other"],
  cafe_restaurant: ["cafe_dining", "bar_counter", "kitchen", "other"],
  retail_showroom: ["retail_floor", "reception", "other"],
  spa: ["spa_treatment", "reception", "lobby", "other"],
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
    "other",
  ],
  other: ROOMS.map(({ id }) => id),
};

export const INTERIOR_STYLES = [
  {
    id: "modern",
    vi: "Hiện đại",
    en: "Modern",
    prompt: "Modern, clean lines and flat planes",
    paletteId: "cool_neutral",
    materialPresetId: "modern_clean",
  },
  {
    id: "minimalist",
    vi: "Tối giản",
    en: "Minimalist",
    prompt: "Minimalist, few details and generous empty space",
    paletteId: "warm_neutral",
    materialPresetId: "minimal_light",
  },
  {
    id: "japandi",
    vi: "Japandi",
    en: "Japandi",
    prompt: "Japandi, calm minimal forms and natural craftsmanship",
    paletteId: "warm_neutral",
    materialPresetId: "japandi_natural",
  },
  {
    id: "wabi_sabi",
    vi: "Wabi-sabi",
    en: "Wabi-Sabi",
    prompt: "Wabi-Sabi, imperfect natural raw surfaces",
    paletteId: "earth",
    materialPresetId: "wabi_earth",
  },
  {
    id: "scandinavian",
    vi: "Bắc Âu",
    en: "Scandinavian",
    prompt: "Scandinavian, bright and friendly",
    paletteId: "cool_neutral",
    materialPresetId: "scandi_light",
  },
  {
    id: "indochine",
    vi: "Đông Dương",
    en: "Indochine",
    prompt: "Indochine, nostalgic tropical with Asian detailing",
    paletteId: "earth",
    materialPresetId: "indochine_heritage",
  },
  {
    id: "contemporary",
    vi: "Đương đại",
    en: "Contemporary",
    prompt: "Contemporary, refined proportions and restrained contrast",
    paletteId: "cool_neutral",
    materialPresetId: "modern_clean",
  },
  {
    id: "luxury",
    vi: "Sang trọng",
    en: "Luxury",
    prompt: "Luxury, high-end finishes and precise detailing",
    paletteId: "warm_neutral",
    materialPresetId: "luxury_stone",
  },
  {
    id: "industrial",
    vi: "Công nghiệp",
    en: "Industrial",
    prompt: "Industrial, exposed structure and raw finishes",
    paletteId: "monochrome",
    materialPresetId: "industrial_raw",
  },
  {
    id: "tropical",
    vi: "Nhiệt đới",
    en: "Tropical",
    prompt: "Tropical, airy with local natural materials",
    paletteId: "green_natural",
    materialPresetId: "tropical_craft",
  },
  {
    id: "modern_classic",
    vi: "Tân cổ điển hiện đại",
    en: "Modern Classic",
    prompt: "Modern Classic, restrained mouldings and symmetry",
    paletteId: "warm_neutral",
    materialPresetId: "classic_detail",
  },
  {
    id: "neo_classic",
    vi: "Tân cổ điển",
    en: "Neo Classic",
    prompt: "Neo Classic, symmetry and pronounced mouldings",
    paletteId: "warm_neutral",
    materialPresetId: "classic_detail",
  },
  {
    id: "mediterranean",
    vi: "Địa Trung Hải",
    en: "Mediterranean",
    prompt: "Mediterranean, arches, warm plaster and handcraft",
    paletteId: "blue_coastal",
    materialPresetId: "mediterranean_warm",
  },
  {
    id: "organic_modern",
    vi: "Hữu cơ hiện đại",
    en: "Organic Modern",
    prompt: "Organic Modern, soft forms and natural materials",
    paletteId: "warm_neutral",
    materialPresetId: "organic_soft",
  },
  {
    id: "mid_century_modern",
    vi: "Mid-century Modern",
    en: "Mid-century Modern",
    prompt: "Mid-century Modern, low forms and iconic wood furniture",
    paletteId: "earth",
    materialPresetId: "midcentury_wood",
  },
] as const;

export type InteriorStyleId = (typeof INTERIOR_STYLES)[number]["id"];

export type InteriorSurfaces = {
  floor: FloorMaterialId[];
  wall: WallMaterialId[];
  ceiling: CeilingMaterialId[];
  cabinetry: CabinetryMaterialId[];
  countertop: CountertopMaterialId[];
  textile: TextileMaterialId[];
  metal: MetalFinishId[];
};

const preset = <Id extends string>(
  id: Id,
  vi: string,
  en: string,
  prompt: string,
  surfaces: InteriorSurfaces,
) => ({ id, vi, en, prompt, surfaces });

export const MATERIAL_PRESETS = [
  preset("modern_clean", "Hiện đại tinh gọn", "Modern clean", "clean modern material palette", {
    floor: ["porcelain_tile"],
    wall: ["paint"],
    ceiling: ["painted_gypsum"],
    cabinetry: ["painted_mdf"],
    countertop: ["quartz"],
    textile: ["linen"],
    metal: ["matte_black"],
  }),
  preset("minimal_light", "Tối giản sáng", "Minimal light", "light minimalist material palette", {
    floor: ["oak"],
    wall: ["paint"],
    ceiling: ["painted_gypsum"],
    cabinetry: ["oak_veneer"],
    countertop: ["quartz"],
    textile: ["linen"],
    metal: ["brushed_brass"],
  }),
  preset(
    "japandi_natural",
    "Japandi tự nhiên",
    "Japandi natural",
    "natural Japandi material palette",
    {
      floor: ["oak"],
      wall: ["limewash"],
      ceiling: ["wood_slats"],
      cabinetry: ["oak_veneer"],
      countertop: ["solid_wood"],
      textile: ["linen"],
      metal: ["matte_black"],
    },
  ),
  preset("wabi_earth", "Wabi màu đất", "Wabi earth", "earthy Wabi-Sabi material palette", {
    floor: ["natural_stone"],
    wall: ["plaster"],
    ceiling: ["exposed_beams"],
    cabinetry: ["solid_teak"],
    countertop: ["travertine"],
    textile: ["linen"],
    metal: ["bronze"],
  }),
  preset(
    "scandi_light",
    "Bắc Âu sáng",
    "Scandinavian light",
    "light Scandinavian material palette",
    {
      floor: ["oak"],
      wall: ["paint"],
      ceiling: ["painted_gypsum"],
      cabinetry: ["oak_veneer"],
      countertop: ["quartz"],
      textile: ["wool"],
      metal: ["matte_black"],
    },
  ),
  preset(
    "indochine_heritage",
    "Đông Dương truyền thống",
    "Indochine heritage",
    "heritage Indochine material palette",
    {
      floor: ["cement_tile"],
      wall: ["wood_panel"],
      ceiling: ["cove_ceiling"],
      cabinetry: ["rattan_cane"],
      countertop: ["marble"],
      textile: ["velvet"],
      metal: ["bronze"],
    },
  ),
  preset("luxury_stone", "Sang trọng với đá", "Luxury stone", "luxury stone material palette", {
    floor: ["natural_stone"],
    wall: ["stone_cladding"],
    ceiling: ["cove_ceiling"],
    cabinetry: ["lacquer"],
    countertop: ["marble"],
    textile: ["velvet"],
    metal: ["brushed_brass"],
  }),
  preset("industrial_raw", "Công nghiệp thô", "Industrial raw", "raw industrial material palette", {
    floor: ["polished_concrete"],
    wall: ["exposed_brick"],
    ceiling: ["exposed_concrete"],
    cabinetry: ["walnut_veneer"],
    countertop: ["granite"],
    textile: ["leather"],
    metal: ["matte_black"],
  }),
  preset(
    "tropical_craft",
    "Nhiệt đới thủ công",
    "Tropical craft",
    "tropical crafted material palette",
    {
      floor: ["terrazzo"],
      wall: ["limewash"],
      ceiling: ["wood_slats"],
      cabinetry: ["solid_teak"],
      countertop: ["solid_wood"],
      textile: ["cotton"],
      metal: ["bronze"],
    },
  ),
  preset(
    "classic_detail",
    "Cổ điển tinh tế",
    "Classic detail",
    "refined classic material palette",
    {
      floor: ["natural_stone"],
      wall: ["wallpaper"],
      ceiling: ["cove_ceiling"],
      cabinetry: ["painted_mdf"],
      countertop: ["marble"],
      textile: ["velvet"],
      metal: ["brushed_brass"],
    },
  ),
  preset(
    "mediterranean_warm",
    "Địa Trung Hải ấm",
    "Mediterranean warm",
    "warm Mediterranean material palette",
    {
      floor: ["cement_tile"],
      wall: ["plaster"],
      ceiling: ["exposed_beams"],
      cabinetry: ["oak_veneer"],
      countertop: ["travertine"],
      textile: ["linen"],
      metal: ["bronze"],
    },
  ),
  preset("organic_soft", "Hữu cơ mềm mại", "Organic soft", "soft organic material palette", {
    floor: ["oak"],
    wall: ["limewash"],
    ceiling: ["wood_slats"],
    cabinetry: ["oak_veneer"],
    countertop: ["terrazzo"],
    textile: ["boucle"],
    metal: ["bronze"],
  }),
  preset(
    "midcentury_wood",
    "Mid-century gỗ",
    "Mid-century wood",
    "warm mid-century wood material palette",
    {
      floor: ["walnut"],
      wall: ["wood_panel"],
      ceiling: ["painted_gypsum"],
      cabinetry: ["walnut_veneer"],
      countertop: ["solid_wood"],
      textile: ["wool"],
      metal: ["brushed_brass"],
    },
  ),
] as const;

export type MaterialPresetId = (typeof MATERIAL_PRESETS)[number]["id"];

export const INTERIOR_CATALOG = {
  buildingUses: BUILDING_USES,
  rooms: ROOMS,
  styles: INTERIOR_STYLES,
  palettes: PALETTES,
  materialPresets: MATERIAL_PRESETS,
  surfaces: {
    floor: FLOOR_MATERIALS,
    wall: WALL_MATERIALS,
    ceiling: CEILING_MATERIALS,
    cabinetry: CABINETRY_MATERIALS,
    countertop: COUNTERTOP_MATERIALS,
    textile: TEXTILE_MATERIALS,
    metal: METAL_FINISHES,
  },
  furniture: FURNITURE,
  cameraPresets: CAMERA_PRESETS,
} as const;
