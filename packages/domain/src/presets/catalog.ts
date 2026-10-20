/**
 * Shot preset catalog (ADR-039). All wording is the app's own; labels and structured data are
 * reused from the existing catalogs (effects, scene objects, visual intents, times of day,
 * grade looks) and each preset records that `source`.
 *
 * Bump `PRESET_CATALOG_VERSION` whenever a compiled sentence changes: it is part of the
 * prompt's configHash, so old snapshots stay explainable.
 */
import { EFFECT_CATALOG } from "../effects/catalog";
import type { EffectId, EffectIntensity } from "../effects/schemas";
import { GRADE_LOOK_CATALOG } from "../grade/catalog";
import type { GradeLookId, TimeOfDay } from "../schemas/future";
import type { VisualIntentView } from "../camera/intent";
import type { PresetGroup, PresetObject, PresetScope, ShotPreset, ShotWeather } from "./schemas";

export const PRESET_CATALOG_VERSION = "ps-1.0.0";

const GEOMETRY_KEEP =
  "Keep the building geometry, camera viewpoint, openings, floor count and proportions of the source image exactly.";
const SKY_ONLY_KEEP = "Change only the sky, light and ground surfaces; never alter the building.";

// ---------------------------------------------------------------- render modes

const RENDER: ShotPreset[] = [
  {
    id: "render.viewport_to_photo",
    group: "render",
    exclusive: "render",
    scope: "any",
    labelVi: "Viewport → ảnh thật",
    labelEn: "Viewport to photo",
    hintVi: "Biến ảnh chụp 3D/SketchUp thành ảnh chụp hoàn thiện",
    hintEn: "Turn a 3D or SketchUp view into a finished photograph",
    patch: {},
    promptEn:
      "Render the provided 3D view as a finished architectural photograph: real materials with natural texture and subtle wear, physically plausible light and shadow, a believable sky and mature planting.",
    keepEn: GEOMETRY_KEEP,
    source: "authored",
  },
  {
    id: "render.sketch_to_photo",
    group: "render",
    exclusive: "render",
    scope: "any",
    labelVi: "Phác thảo → ảnh thật",
    labelEn: "Sketch to photo",
    hintVi: "Diễn giải nét vẽ tay hoặc nét CAD thành công trình đã xây",
    hintEn: "Interpret a hand or CAD line drawing as a built project",
    patch: {},
    promptEn:
      "Interpret the line drawing as a completed, built project photographed in natural conditions; choose plausible materials from the project description where the drawing shows none.",
    keepEn: GEOMETRY_KEEP,
    source: "authored",
  },
  {
    id: "render.add_realism",
    group: "render",
    exclusive: "render",
    scope: "any",
    labelVi: "Tăng độ thật",
    labelEn: "Add realism",
    hintVi: "Nâng ảnh render sẵn có lên chất lượng ảnh chụp",
    hintEn: "Push an existing render towards photographic quality",
    patch: {},
    promptEn:
      "Increase photographic realism: natural material imperfections, soft contact shadows, accurate reflections in glass and water, gentle depth and realistic micro-contrast.",
    keepEn: "Do not change the design, layout, colors, materials or camera.",
    source: "authored",
  },
  {
    id: "render.clean_up",
    group: "render",
    exclusive: "render",
    scope: "any",
    labelVi: "Dọn ảnh",
    labelEn: "Clean up",
    hintVi: "Bỏ rác, dây điện lộn xộn, vết bẩn; gọn cây cỏ",
    hintEn: "Remove clutter, messy wires and stains; tidy planting",
    patch: {},
    promptEn:
      "Clean the scene: remove litter, construction debris, tangled loose wires, stains and temporary signs, and tidy the planting edges.",
    keepEn:
      "Keep every permanent element: the building, neighbouring buildings, poles, trees and street furniture stay in place.",
    source: "authored",
  },
  {
    id: "render.white_model",
    group: "render",
    exclusive: "render",
    scope: "any",
    labelVi: "Mô hình trắng",
    labelEn: "White model",
    hintVi: "Ảnh mô hình khối trắng, ánh sáng dịu để trình bày ý tưởng",
    hintEn: "Clean white massing model in soft light for concept presentation",
    patch: {},
    promptEn:
      "Present the design as a clean physical architectural model: matte white material for the building, light grey ground and context, soft diffuse daylight and gentle ambient occlusion.",
    keepEn: GEOMETRY_KEEP,
    source: "authored",
  },
];

// ---------------------------------------------------------------- time of day

const TIME_TEXT: Record<TimeOfDay, { vi: string; en: string; hintVi: string; prompt: string }> = {
  dawn: {
    vi: "Bình minh",
    en: "Dawn",
    hintVi: "Ánh sáng dịu, lạnh, chân trời ửng ấm",
    prompt:
      "Early dawn light: soft, cool ambient light with a faint warm glow on the horizon and very low contrast.",
  },
  morning: {
    vi: "Buổi sáng",
    en: "Morning",
    hintVi: "Nắng sớm trong, bóng đổ rõ",
    prompt:
      "Clear morning light: fresh, slightly warm sun at a low-to-medium angle with crisp, clean shadows.",
  },
  midday: {
    vi: "Giữa trưa",
    en: "Midday",
    hintVi: "Nắng cao, bóng ngắn, màu trung tính",
    prompt: "Bright midday light: high sun, short well-defined shadows and neutral color.",
  },
  afternoon: {
    vi: "Chiều",
    en: "Afternoon",
    hintVi: "Nắng ấm xiên, bóng dài làm rõ chiều sâu mặt tiền",
    prompt:
      "Late afternoon light: warm sun at a medium-low angle and longer shadows that model the depth of the facade.",
  },
  golden_hour: {
    vi: "Giờ vàng",
    en: "Golden hour",
    hintVi: "Nắng thấp, ấm, bóng dài mềm, trời cam nhạt",
    prompt:
      "Golden hour: low warm sun, long soft shadows, warm highlights across the facade and a pale orange sky.",
  },
  blue_hour: {
    vi: "Giờ xanh",
    en: "Blue hour",
    hintVi: "Trời xanh thẫm sau hoàng hôn, đèn trong nhà ấm",
    prompt:
      "Blue hour: deep blue sky just after sunset, warm interior light glowing through the windows, exposure balanced between sky and building.",
  },
  night: {
    vi: "Ban đêm",
    en: "Night",
    hintVi: "Trời tối, chỉ có đèn sẵn có của công trình",
    prompt:
      "Night scene: dark sky with no sun, the building lit only by plausible existing interior and exterior fixtures, warm pools of light.",
  },
};

const TIME_ORDER: readonly TimeOfDay[] = [
  "dawn",
  "morning",
  "midday",
  "afternoon",
  "golden_hour",
  "blue_hour",
  "night",
];

const TIME: ShotPreset[] = TIME_ORDER.map((time) => {
  const text = TIME_TEXT[time];
  return {
    id: `time.${time}`,
    group: "time_light",
    exclusive: "time",
    scope: "any",
    labelVi: text.vi,
    labelEn: text.en,
    hintVi: text.hintVi,
    hintEn: text.prompt,
    patch: { timeOfDay: time },
    promptEn: text.prompt,
    ...(time === "night" || time === "blue_hour"
      ? { keepEn: "Do not add light fixtures the design does not plausibly have." }
      : {}),
    source: "time_of_day",
  };
});

// ---------------------------------------------------------------- weather

const WEATHER_TEXT: Record<
  ShotWeather,
  { vi: string; en: string; hintVi: string; prompt: string }
> = {
  clear: {
    vi: "Trời quang",
    en: "Clear sky",
    hintVi: "Trời trong, vài vệt mây mỏng",
    prompt: "Clear sky with a few thin high clouds and crisp air.",
  },
  partly_cloudy: {
    vi: "Mây rải rác",
    en: "Partly cloudy",
    hintVi: "Mây trắng xốp xen nắng",
    prompt: "Partly cloudy sky with soft white clouds and patches of sun.",
  },
  overcast: {
    vi: "Trời âm u",
    en: "Overcast",
    hintVi: "Ánh sáng đều, không bóng gắt",
    prompt: "Overcast sky giving soft, even daylight without hard shadows and with muted contrast.",
  },
  light_rain: {
    vi: "Mưa nhẹ",
    en: "Light rain",
    hintVi: "Mưa bụi, mặt đất ẩm, phản chiếu nhẹ",
    prompt:
      "Light rain: fine raindrops, damp surfaces, a grey sky and soft reflections on the ground.",
  },
  after_rain: {
    vi: "Sau mưa",
    en: "After rain",
    hintVi: "Mặt đường ướt phản chiếu, vũng nước nhỏ",
    prompt:
      "Just after rain: wet paving with clear reflections, a few small puddles and a clearing sky.",
  },
  morning_mist: {
    vi: "Sương sớm",
    en: "Morning mist",
    hintVi: "Sương mỏng làm mềm hậu cảnh",
    prompt: "Light morning mist softening the background while the building stays clear and sharp.",
  },
};

const WEATHER: ShotPreset[] = (Object.keys(WEATHER_TEXT) as ShotWeather[]).map((weather) => {
  const text = WEATHER_TEXT[weather];
  return {
    id: `weather.${weather}`,
    group: "weather",
    exclusive: "weather",
    scope: "any",
    labelVi: text.vi,
    labelEn: text.en,
    hintVi: text.hintVi,
    hintEn: text.prompt,
    patch: { weather },
    promptEn: text.prompt,
    keepEn: SKY_ONLY_KEEP,
    source: "authored",
  };
});

// ---------------------------------------------------------------- camera views

const VIEW_TEXT: Record<
  VisualIntentView,
  { vi: string; en: string; hintVi: string; hintEn: string; scope: PresetScope }
> = {
  front: {
    vi: "Chính diện",
    en: "Front",
    hintVi: "Nhìn thẳng mặt tiền",
    hintEn: "Straight-on front facade",
    scope: "any",
  },
  street_oblique: {
    vi: "Xiên từ phố",
    en: "Street oblique",
    hintVi: "Góc xiên mặt tiền từ lòng đường",
    hintEn: "Oblique front view from the street",
    scope: "exterior",
  },
  pedestrian: {
    vi: "Tầm mắt người",
    en: "Eye level",
    hintVi: "Góc người đi bộ",
    hintEn: "Pedestrian eye height",
    scope: "any",
  },
  overview: {
    vi: "Toàn cảnh",
    en: "Overview",
    hintVi: "Thấy rõ công trình và bối cảnh",
    hintEn: "Building and its surroundings fully readable",
    scope: "any",
  },
  approach: {
    vi: "Lối tiếp cận",
    en: "Approach",
    hintVi: "Dẫn mắt theo lối vào",
    hintEn: "Leading along the entry sequence",
    scope: "any",
  },
  detail: {
    vi: "Cận chi tiết",
    en: "Detail",
    hintVi: "Tập trung một chi tiết kiến trúc",
    hintEn: "Focused architectural detail",
    scope: "any",
  },
  aerial: {
    vi: "Flycam",
    en: "Aerial",
    hintVi: "Nhìn cao xuống công trình và khu đất",
    hintEn: "High view over the building and site",
    scope: "exterior",
  },
};

const CAMERA: ShotPreset[] = (Object.keys(VIEW_TEXT) as VisualIntentView[]).map((view) => {
  const text = VIEW_TEXT[view];
  return {
    id: `camera.${view}`,
    group: "camera",
    exclusive: "view",
    scope: text.scope,
    labelVi: text.vi,
    labelEn: text.en,
    hintVi: text.hintVi,
    hintEn: text.hintEn,
    patch: { view },
    source: "visual_intent",
  };
});

// ---------------------------------------------------------------- people, cars, objects

const objectPreset = (
  id: string,
  scope: PresetScope,
  labelVi: string,
  labelEn: string,
  hintVi: string,
  objects: PresetObject[],
): ShotPreset => ({
  id,
  group: "people_cars",
  scope,
  labelVi,
  labelEn,
  hintVi,
  hintEn: labelEn,
  patch: { objects },
  source: "scene_object_catalog",
});

const PEOPLE_CARS: ShotPreset[] = [
  objectPreset("people.few_adults", "any", "Vài người", "A few people", "Hai người đứng tự nhiên", [
    { presetId: "person.adult", quantity: 2, state: "static", visibility: "midground" },
  ]),
  objectPreset("people.family", "any", "Gia đình", "Family", "Một nhóm gia đình nhỏ", [
    { presetId: "person.family", quantity: 1, state: "static", visibility: "midground" },
  ]),
  objectPreset(
    "people.walking",
    "exterior",
    "Người qua lại",
    "People walking",
    "Ba người đi bộ ở hậu cảnh",
    [{ presetId: "person.adult", quantity: 3, state: "moving", visibility: "background" }],
  ),
  objectPreset(
    "cars.parked_sedan",
    "exterior",
    "Xe sedan đậu",
    "Parked sedan",
    "Một xe sedan đậu trước nhà",
    [{ presetId: "car.generic.modern_luxury_sedan", quantity: 1, state: "static" }],
  ),
  objectPreset("cars.city_car", "exterior", "Xe đô thị", "City car", "Một xe nhỏ đô thị", [
    { presetId: "car.generic.vn_city_car", quantity: 1, state: "static" },
  ]),
  objectPreset("bikes.scooters", "exterior", "Xe máy", "Scooters", "Hai xe tay ga đậu", [
    { presetId: "motorbike.scooter", quantity: 2, state: "static" },
  ]),
  objectPreset("plants.potted", "any", "Chậu cây lớn", "Large plants", "Hai chậu cây lớn", [
    { presetId: "plant.large_potted", quantity: 2, state: "static" },
  ]),
  objectPreset("pets.dog", "any", "Chó cưng", "Dog", "Một chú chó", [
    { presetId: "pet.dog", quantity: 1, state: "static" },
  ]),
];

// ---------------------------------------------------------------- effects

const EFFECT_SCOPE: Partial<Record<EffectId, PresetScope>> = {
  vehicle_light_trails: "exterior",
  soft_clouds: "exterior",
  silky_water: "exterior",
  sunstar: "exterior",
};
const EFFECT_INTENSITY: Partial<Record<EffectId, EffectIntensity>> = {
  vehicle_light_trails: "medium",
};

const EFFECTS: ShotPreset[] = EFFECT_CATALOG.map((effect) => ({
  id: `effect.${effect.id}`,
  group: "effects",
  exclusive: "effect",
  scope: EFFECT_SCOPE[effect.id] ?? "any",
  labelVi: effect.labelVi,
  labelEn: effect.labelEn,
  hintVi: effect.labelVi,
  hintEn: effect.labelEn,
  patch: { effect: { id: effect.id, intensity: EFFECT_INTENSITY[effect.id] ?? "light" } },
  source: "effect_catalog",
}));

// ---------------------------------------------------------------- colour looks (free)

const LOOK_IDS: readonly GradeLookId[] = [
  "bright_magazine",
  "warm_tropical",
  "cool_modern",
  "cinematic_dusk",
  "matte_film",
  "gallery_white",
];

const LOOKS: ShotPreset[] = LOOK_IDS.map((id) => {
  const look = GRADE_LOOK_CATALOG.find((l) => l.id === id)!;
  return {
    id: `look.${id}`,
    group: "color_look",
    exclusive: "look",
    scope: "any",
    labelVi: look.labelVi,
    labelEn: look.labelEn,
    hintVi: look.descriptionVi,
    hintEn: look.descriptionEn,
    patch: { gradeLookId: id },
    source: "grade_look",
  };
});

export const SHOT_PRESETS: readonly ShotPreset[] = [
  ...RENDER,
  ...TIME,
  ...WEATHER,
  ...CAMERA,
  ...PEOPLE_CARS,
  ...EFFECTS,
  ...LOOKS,
];

const BY_ID = new Map(SHOT_PRESETS.map((p) => [p.id, p]));
const ORDER = new Map(SHOT_PRESETS.map((p, i) => [p.id, i]));

export const shotPreset = (id: string): ShotPreset | undefined => BY_ID.get(id);

/** Catalog position, used to keep selections and compiled lines in a stable order. */
export const presetOrder = (id: string): number => ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;

export const presetsOfGroup = (group: PresetGroup): ShotPreset[] =>
  SHOT_PRESETS.filter((p) => p.group === group);
