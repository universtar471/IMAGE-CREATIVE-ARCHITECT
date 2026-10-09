/**
 * Display text for Knowledge Pack content (labels, descriptions, preset names, style names).
 * Packs are data and their English text is the fallback, so a new pack shows up untranslated
 * rather than breaking. Keys are the pack's stable ids; style suggestions are keyed by their
 * English value, which is also what gets stored in the DNA (prompts stay English).
 */
import type { CameraPreset, ContextPreset, KnowledgePack, ProjectType } from "@arch/domain";
import { knowledge } from "../lib/knowledge";
import { currentLocale, type Locale } from "./index";

type PackText = { label: string; description?: string };

const PACKS_VI: Readonly<Record<string, PackText>> = {
  "custom/default": {
    label: "Chung",
    description: "Gói dự phòng dùng khi chưa có gói riêng.",
  },
  "interior/default": {
    label: "Không gian nội thất",
    description: "Một phòng hoặc không gian mở trong nhà.",
  },
  "interior/living_room": { label: "Phòng khách", description: "Phòng khách nhà ở." },
  "prefab_modular/default": {
    label: "Nhà lắp ghép / module",
    description: "Module sản xuất tại xưởng (container hoặc khung thép), lắp ráp tại công trường.",
  },
  "single_storey_house/default": {
    label: "Nhà cấp 4",
    description: "Nhà một tầng độc lập, thường ở ven đô hoặc nông thôn.",
  },
  "townhouse/default": {
    label: "Nhà phố tiêu chuẩn",
    description: "Nhà ống / nhà phố trên lô đất hẹp và sâu, chỉ có một mặt tiền.",
  },
  "townhouse/narrow_lot": {
    label: "Lô rất hẹp (4 m trở xuống)",
    description: "Nhà phố siêu hẹp, mặt tiền chỉ một gian.",
  },
  "urban_villa/default": {
    label: "Biệt thự đô thị",
    description: "Biệt thự trên lô đất đô thị gọn, trong khu dân cư mới, liền kề một phần.",
  },
  "villa/default": {
    label: "Biệt thự đơn lập",
    description: "Biệt thự độc lập trên khu đất rộng có sân vườn.",
  },
  "villa/tropical": {
    label: "Biệt thự nhiệt đới",
    description: "Biệt thự nhiệt đới thoáng, mái đua sâu, vật liệu tự nhiên và cây xanh dày.",
  },
};

/** Context presets, keyed `<projectType>/<subtype>/<presetId>` (labels differ per pack). */
const CONTEXT_PRESETS_VI: Readonly<Record<string, string>> = {
  "interior/default/city_view": "Cửa sổ nhìn ra phố",
  "interior/default/garden_view": "Nhìn ra vườn",
  "interior/living_room/city_view": "Cửa sổ nhìn ra phố",
  "prefab_modular/default/garden": "Lô đất có vườn",
  "prefab_modular/default/nature": "Nghỉ dưỡng giữa thiên nhiên",
  "single_storey_house/default/garden": "Lô đất có vườn",
  "single_storey_house/default/suburban": "Phố ven đô",
  "single_storey_house/default/rural": "Nông thôn / làng quê",
  "townhouse/default/alley": "Hẻm nhỏ",
  "townhouse/default/street": "Mặt tiền đường nhỏ",
  "townhouse/default/urban_frontage": "Mặt tiền đường lớn",
  "townhouse/narrow_lot/alley": "Hẻm nhỏ",
  "urban_villa/default/residential_street": "Đường khu dân cư",
  "urban_villa/default/new_urban_area": "Khu đô thị mới",
  "villa/default/garden": "Sân vườn cảnh quan",
  "villa/default/resort": "Khung cảnh resort",
  "villa/default/lake": "Ven hồ",
  "villa/default/hill": "Sườn đồi",
  "villa/tropical/garden_pool": "Vườn + hồ bơi phía sau",
  "villa/tropical/resort": "Resort biển",
};

/** Camera presets share ids and labels across packs. */
const CAMERA_PRESETS_VI: Readonly<Record<string, string>> = {
  front: "Mặt đứng chính",
  front_left_corner: "Góc trước bên trái",
  front_right_corner: "Góc trước bên phải",
  aerial_three_quarter: "Chim bay ba phần tư",
  facade_detail: "Chi tiết mặt tiền",
  street_level: "Tầm mắt người đi bộ",
  rear_garden: "Nhìn từ vườn sau",
  rear_landscape: "Cảnh quan phía sau",
  rear_pool: "Nhìn ra hồ bơi và vườn",
  entrance_wide: "Toàn cảnh từ lối vào",
  opposite_corner: "Từ góc đối diện",
  window_wall: "Hướng về cửa sổ",
  material_detail: "Chi tiết vật liệu",
  sofa_to_windows: "Từ sofa nhìn ra cửa sổ",
  tv_wall: "Hướng về tường điểm nhấn",
};

/** Architectural styles, keyed by the English value stored in the DNA. */
const STYLES_VI: Readonly<Record<string, string>> = {
  Modern: "Hiện đại",
  Contemporary: "Đương đại",
  Minimalist: "Tối giản",
  Japandi: "Japandi",
  Indochine: "Đông Dương (Indochine)",
  "Wabi-sabi": "Wabi-sabi",
  Scandinavian: "Bắc Âu (Scandinavian)",
  "Industrial modern": "Công nghiệp hiện đại",
  "Modern tropical": "Nhiệt đới hiện đại",
  "Contemporary farmhouse": "Nhà vườn đương đại",
  "Neo-classical": "Tân cổ điển",
  Mediterranean: "Địa Trung Hải",
  "Tropical minimalist": "Nhiệt đới tối giản",
  "Bali style": "Phong cách Bali",
};

const packKey = (p: Pick<KnowledgePack, "projectType" | "subtype">) =>
  `${p.projectType}/${p.subtype}`;

export function packLabel(pack: KnowledgePack, locale: Locale = currentLocale()): string {
  return (locale === "vi" && PACKS_VI[packKey(pack)]?.label) || pack.label;
}

export function packDescription(pack: KnowledgePack, locale: Locale = currentLocale()): string {
  return (locale === "vi" && PACKS_VI[packKey(pack)]?.description) || pack.description;
}

export function contextPresetLabel(
  pack: KnowledgePack,
  preset: ContextPreset,
  locale: Locale = currentLocale(),
): string {
  return (locale === "vi" && CONTEXT_PRESETS_VI[`${packKey(pack)}/${preset.id}`]) || preset.label;
}

export function cameraPresetLabel(preset: CameraPreset, locale: Locale = currentLocale()): string {
  return (locale === "vi" && CAMERA_PRESETS_VI[preset.id]) || preset.label;
}

/** A style suggestion as shown to the user; the stored value stays the English one. */
export function styleLabel(style: string, locale: Locale = currentLocale()): string {
  return (locale === "vi" && STYLES_VI[style]) || style;
}

/** A project's subtype for display: its pack label when a pack matches, else the raw id. */
export function subtypeLabel(
  projectType: ProjectType,
  subtype: string,
  locale: Locale = currentLocale(),
): string {
  const { pack, match } = knowledge.resolve(projectType, subtype);
  return pack && match === "exact" ? packLabel(pack, locale) : subtype.replace(/_/g, " ");
}
