/**
 * Scene object catalog and car library (ADR-036 P2d, SRS §7.2). Read-only reference data.
 *
 * Named cars are only "simulated after the model": image models may not reproduce badges or
 * period details exactly, so the UI labels them "mô phỏng theo mẫu xe" and warns before
 * commercial publishing that involves a trademark. Each prompt description pins the exact
 * variant (coupe vs roadster, 289 vs 427 body) so two variants are never mixed.
 */
import {
  SceneObjectPresetSchema,
  type ObjectColorId,
  type SceneObjectPreset,
  type SceneObjectType,
} from "./schemas";

/** The label every named car carries in the UI (SRS §7.2). */
export const SIMULATED_MODEL_LABEL_VI = "mô phỏng theo mẫu xe";
export const SIMULATED_MODEL_LABEL_EN = "simulated after the model";

type PresetInput = Omit<
  SceneObjectPreset,
  "simulatedModel" | "trademarkWarning" | "colorable" | "promptPluralEn"
> &
  Partial<Pick<SceneObjectPreset, "simulatedModel" | "trademarkWarning" | "colorable">> & {
    promptPluralEn?: string;
  };

const preset = (input: PresetInput): SceneObjectPreset =>
  SceneObjectPresetSchema.parse({ promptPluralEn: `${input.promptEn}s`, ...input });

/** A named (branded) car: simulated, trademark warning, colour chosen by the user. */
const namedCar = (input: Omit<PresetInput, "type">): SceneObjectPreset =>
  preset({ ...input, type: "car", simulatedModel: true, trademarkWarning: true, colorable: true });

const genericCar = (input: Omit<PresetInput, "type">): SceneObjectPreset =>
  preset({ ...input, type: "car", simulatedModel: true, colorable: true });

export const SCENE_OBJECT_PRESETS: readonly SceneObjectPreset[] = [
  preset({
    id: "person.adult",
    type: "person",
    labelVi: "Người lớn",
    labelEn: "Adult",
    promptEn: "adult person in everyday clothing",
    promptPluralEn: "adults in everyday clothing",
  }),
  preset({
    id: "person.family",
    type: "person",
    labelVi: "Gia đình",
    labelEn: "Family group",
    promptEn: "small family group",
  }),
  preset({
    id: "pet.dog",
    type: "pet",
    labelVi: "Chó",
    labelEn: "Dog",
    promptEn: "medium-sized dog",
  }),
  preset({ id: "pet.cat", type: "pet", labelVi: "Mèo", labelEn: "Cat", promptEn: "domestic cat" }),
  preset({
    id: "plant.potted",
    type: "plant",
    labelVi: "Chậu cây",
    labelEn: "Potted plant",
    promptEn: "potted plant",
  }),
  preset({
    id: "plant.large_potted",
    type: "plant",
    labelVi: "Chậu cây lớn",
    labelEn: "Large potted plant",
    promptEn: "large potted indoor tree",
    promptPluralEn: "large potted indoor trees",
  }),
  namedCar({
    id: "car.mercedes_300sl.gullwing",
    labelVi: "Mercedes-Benz 300 SL Gullwing (coupe)",
    labelEn: "Mercedes-Benz 300 SL Gullwing (coupe)",
    promptEn:
      "1950s Mercedes-Benz 300 SL Gullwing coupe (low body, upward-opening gullwing doors, fixed roof; not the roadster)",
    promptPluralEn:
      "1950s Mercedes-Benz 300 SL Gullwing coupes (low body, upward-opening gullwing doors, fixed roof; not the roadster)",
  }),
  namedCar({
    id: "car.mercedes_300sl.roadster",
    labelVi: "Mercedes-Benz 300 SL Roadster",
    labelEn: "Mercedes-Benz 300 SL Roadster",
    promptEn:
      "late-1950s Mercedes-Benz 300 SL Roadster (open top, conventional front-hinged doors; not the Gullwing coupe)",
    promptPluralEn:
      "late-1950s Mercedes-Benz 300 SL Roadsters (open top, conventional front-hinged doors; not the Gullwing coupe)",
  }),
  namedCar({
    id: "car.shelby_cobra.1964_289",
    labelVi: "Shelby/AC Cobra 289 (đời 1964)",
    labelEn: "Shelby/AC Cobra 289 (1964)",
    promptEn:
      "1964 Shelby/AC Cobra 289 roadster (slim early 289 body with narrow fenders; not the later, wider Cobra 427 body)",
    promptPluralEn:
      "1964 Shelby/AC Cobra 289 roadsters (slim early 289 body with narrow fenders; not the later, wider Cobra 427 body)",
  }),
  namedCar({
    id: "car.jaguar_e_type.series1_coupe",
    labelVi: "Jaguar E-Type Series 1 (coupe)",
    labelEn: "Jaguar E-Type Series 1 (coupe)",
    promptEn:
      "1960s Jaguar E-Type Series 1 fixed-head coupe (long bonnet, covered headlamps, fastback roof; not the roadster)",
    promptPluralEn:
      "1960s Jaguar E-Type Series 1 fixed-head coupes (long bonnet, covered headlamps, fastback roof; not the roadster)",
  }),
  namedCar({
    id: "car.jaguar_e_type.series1_roadster",
    labelVi: "Jaguar E-Type Series 1 (roadster)",
    labelEn: "Jaguar E-Type Series 1 (roadster)",
    promptEn:
      "1960s Jaguar E-Type Series 1 roadster (long bonnet, covered headlamps, open two-seat cabin; not the coupe)",
    promptPluralEn:
      "1960s Jaguar E-Type Series 1 roadsters (long bonnet, covered headlamps, open two-seat cabin; not the coupe)",
  }),
  genericCar({
    id: "car.generic.modern_luxury_sedan",
    labelVi: "Sedan hạng sang hiện đại",
    labelEn: "Modern luxury sedan",
    promptEn: "modern luxury sedan without visible brand badges",
    promptPluralEn: "modern luxury sedans without visible brand badges",
  }),
  genericCar({
    id: "car.generic.suv",
    labelVi: "SUV hiện đại",
    labelEn: "Modern SUV",
    promptEn: "modern SUV without visible brand badges",
    promptPluralEn: "modern SUVs without visible brand badges",
  }),
  genericCar({
    id: "car.generic.ev",
    labelVi: "Ô tô điện hiện đại",
    labelEn: "Modern electric car",
    promptEn: "modern electric car without visible brand badges",
    promptPluralEn: "modern electric cars without visible brand badges",
  }),
  genericCar({
    id: "car.generic.vn_city_car",
    labelVi: "Xe đô thị cỡ nhỏ (Việt Nam)",
    labelEn: "Vietnamese city car",
    promptEn: "compact city car typical of Vietnamese streets, without visible brand badges",
    promptPluralEn: "compact city cars typical of Vietnamese streets, without visible brand badges",
  }),
  preset({
    id: "motorbike.scooter",
    type: "motorbike",
    labelVi: "Xe máy tay ga",
    labelEn: "Scooter",
    promptEn: "motor scooter typical of Vietnamese streets",
    promptPluralEn: "motor scooters typical of Vietnamese streets",
    colorable: true,
  }),
  preset({
    id: "motorbike.underbone",
    type: "motorbike",
    labelVi: "Xe máy số",
    labelEn: "Underbone motorbike",
    promptEn: "underbone motorbike typical of Vietnamese streets",
    promptPluralEn: "underbone motorbikes typical of Vietnamese streets",
    colorable: true,
  }),
  preset({
    id: "bicycle.city",
    type: "bicycle",
    labelVi: "Xe đạp phố",
    labelEn: "City bicycle",
    promptEn: "city bicycle",
    colorable: true,
  }),
];

/** Presets in catalog order; ids are stable and stored in shot snapshots. */
export const OBJECT_CATALOG = SCENE_OBJECT_PRESETS;
export const CAR_PRESETS = SCENE_OBJECT_PRESETS.filter((p) => p.type === "car");

const BY_ID = new Map(SCENE_OBJECT_PRESETS.map((p) => [p.id, p]));
export const sceneObjectPreset = (id: string): SceneObjectPreset | undefined => BY_ID.get(id);

export const presetsOfType = (type: SceneObjectType) =>
  SCENE_OBJECT_PRESETS.filter((p) => p.type === type);

/** English colour wording used in the prompt. */
export const OBJECT_COLOR_EN: Readonly<Record<ObjectColorId, string>> = {
  white: "white",
  silver: "silver",
  grey: "grey",
  black: "black",
  red: "red",
  blue: "blue",
  cream: "cream",
  racing_green: "dark racing green",
};
