import type { SpacePreset } from "../spaceCatalog/schemas";
import type { SpaceInstance } from "../schemas/extensions";
import { SceneObjectPresetSchema, type SceneObjectPreset, type SceneObjectType } from "./schemas";

export const TRADEMARK_WARNING =
  "Mô phỏng theo mẫu xe; cần kiểm tra quyền sử dụng thương hiệu khi xuất bản thương mại.";

const car = (id: string, labelVi: string, labelEn: string, promptEn: string): SceneObjectPreset =>
  SceneObjectPresetSchema.parse({
    id,
    type: "car",
    labelVi,
    labelEn,
    promptEn,
    trademarkWarning: TRADEMARK_WARNING,
  });

export const SCENE_OBJECT_PRESETS: readonly SceneObjectPreset[] = [
  { id: "person", type: "person", labelVi: "Người", labelEn: "Person", promptEn: "person" },
  {
    id: "pet",
    type: "pet",
    labelVi: "Thú cưng",
    labelEn: "Pet",
    promptEn: "domestic pet",
  },
  { id: "plant", type: "plant", labelVi: "Cây", labelEn: "Plant", promptEn: "potted plant" },
  {
    id: "motorbike",
    type: "motorbike",
    labelVi: "Xe máy",
    labelEn: "Motorbike",
    promptEn: "motorbike",
  },
  {
    id: "bicycle",
    type: "bicycle",
    labelVi: "Xe đạp",
    labelEn: "Bicycle",
    promptEn: "bicycle",
  },
  car(
    "car.mercedes_300sl.gullwing",
    "Mercedes-Benz 300 SL Gullwing coupe",
    "Mercedes-Benz 300 SL Gullwing coupe",
    "1950s Mercedes-Benz 300 SL Gullwing coupe, low body with distinctive gullwing doors; never a roadster",
  ),
  car(
    "car.shelby_cobra.1964_289",
    "Shelby/AC Cobra 289 (1964)",
    "Shelby/AC Cobra 289 (1964)",
    "1964 Shelby/AC Cobra 289 roadster with the period 289 body; never the later 427 body",
  ),
  car(
    "car.jaguar_e_type.series1_coupe",
    "Jaguar E-Type Series 1 coupe",
    "Jaguar E-Type Series 1 coupe",
    "Jaguar E-Type Series 1 coupe, Series 1 proportions and enclosed roof",
  ),
  car(
    "car.jaguar_e_type.series1_roadster",
    "Jaguar E-Type Series 1 roadster",
    "Jaguar E-Type Series 1 roadster",
    "Jaguar E-Type Series 1 roadster, Series 1 proportions and open cabin; never a coupe",
  ),
  car(
    "car.modern_luxury_sedan",
    "Sedan hạng sang hiện đại",
    "Modern luxury sedan",
    "modern luxury sedan",
  ),
  car("car.suv", "SUV", "SUV", "modern SUV"),
  car("car.ev", "Xe điện", "Electric vehicle", "modern electric vehicle"),
  car(
    "car.vietnamese_city_car",
    "Xe đô thị Việt Nam",
    "Vietnamese city car",
    "compact Vietnamese city car",
  ),
];
export const OBJECT_CATALOG = SCENE_OBJECT_PRESETS;

export const CAR_PRESETS = SCENE_OBJECT_PRESETS.filter((p) => p.type === "car");

const byId = new Map(SCENE_OBJECT_PRESETS.map((preset) => [preset.id, preset]));
export const sceneObjectPreset = (id: string) => byId.get(id);

export type AllowedObjectResult = {
  allowed: readonly SceneObjectType[];
  reasonVi: string;
  reasonEn: string;
  requiresPlacementZone: boolean;
  hardscapeOnly?: boolean;
};

const PEOPLE_PETS_PLANTS: readonly SceneObjectType[] = ["person", "pet", "plant"];
const VEHICLES: readonly SceneObjectType[] = ["car", "motorbike", "bicycle"];

const idText = (space: SpacePreset | null, instance: SpaceInstance) =>
  `${space?.id ?? ""} ${instance.presetId} ${space?.labelEn ?? ""}`.toLowerCase();

/** SRS §7.1 table, expressed from the catalog's zone/category and stable preset id. */
export function allowedObjectsForSpace(
  space: SpacePreset | null,
  instance: SpaceInstance,
): AllowedObjectResult {
  const text = idText(space, instance);
  const isGarage = /garage|gara|driveway/.test(text);
  const isPool = /pool|bể bơi/.test(text);
  const isFacade = /facade|façade|front|mặt tiền|san_truoc|yard|garden/.test(text);
  const isLobby = /lobby|sanh|reception|quay/.test(text);

  if (isPool || (instance.presetId.includes("pool") && space?.zone === "exterior"))
    return {
      allowed: ["person"],
      reasonVi: "Hồ bơi resort chỉ cho phép người.",
      reasonEn: "A resort pool allows people only.",
      requiresPlacementZone: false,
    };
  if (isGarage || /garage|driveway/.test(instance.presetId))
    return {
      allowed: ["car", "motorbike", "person"],
      reasonVi: "Gara hoặc driveway cho phép xe và người khi đủ khoảng trống.",
      reasonEn: "A garage or driveway allows vehicles and people when there is enough room.",
      requiresPlacementZone: true,
    };
  if (isFacade && instance.presetId.startsWith("townhouse."))
    return {
      allowed: ["person", "car", "motorbike"],
      reasonVi: "Mặt tiền nhà phố chỉ cho xe trên con đường hiện hữu, không tạo driveway mới.",
      reasonEn:
        "A townhouse facade allows vehicles only on the existing road; never create a driveway.",
      requiresPlacementZone: true,
    };
  if (instance.presetId.startsWith("villa.") && space?.zone === "exterior")
    return {
      allowed: ["car", "person", "pet", "plant"],
      reasonVi: "Sân biệt thự chỉ cho xe đỗ trên hardscape.",
      reasonEn: "A villa yard allows parked cars on hardscape only.",
      requiresPlacementZone: true,
      hardscapeOnly: true,
    };
  if (
    isLobby &&
    (instance.presetId.startsWith("hotel.") || instance.presetId.startsWith("resort."))
  )
    return {
      allowed: ["person", "plant"],
      reasonVi: "Sảnh khách sạn cho phép người và cây.",
      reasonEn: "A hotel lobby allows people and plants.",
      requiresPlacementZone: false,
    };
  if (space?.zone === "interior" && (space.category === "sleeping" || space.category === "living"))
    return {
      allowed: PEOPLE_PETS_PLANTS,
      reasonVi: "Phòng khách và phòng ngủ chỉ cho người, thú cưng và cây.",
      reasonEn: "Bedrooms and living rooms allow people, pets and plants only.",
      requiresPlacementZone: false,
    };
  if (space?.zone === "interior")
    return {
      allowed: ["person", "plant"],
      reasonVi: "Không gian nội thất này chỉ cho người và cây.",
      reasonEn: "This interior space allows people and plants only.",
      requiresPlacementZone: false,
    };
  return {
    allowed: ["person", "pet", "plant"],
    reasonVi: "Không gian ngoài trời này cho người, thú cưng và cây.",
    reasonEn: "This outdoor space allows people, pets and plants.",
    requiresPlacementZone: false,
  };
}

export const allowedObjectTypesForSpace = allowedObjectsForSpace;

export { VEHICLES };
