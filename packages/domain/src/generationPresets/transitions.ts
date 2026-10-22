import {
  ALL_PRESERVE,
  initialInteriorGeneration,
  type GenerationGoal,
  type InteriorGenerationState,
  type PreserveKey,
} from "./schema";
import { GENERATION_GOALS } from "./goals";
import { GENERATION_CHANGE_LEVELS } from "./change-level";

export function selectGenerationGoal(
  state: InteriorGenerationState,
  goal: GenerationGoal,
): InteriorGenerationState {
  const preset = GENERATION_GOALS.find((p) => p.id === goal)!;
  const preserve = { ...(preset.defaults.preserve as InteriorGenerationState["preserve"]) };
  return {
    ...state,
    goal,
    changeLevel: preset.defaults.changeLevel as InteriorGenerationState["changeLevel"],
    preserve,
    camera: preserve.camera ? { mode: "original" } : state.camera,
  };
}
export function selectChangeLevel(
  state: InteriorGenerationState,
  level: InteriorGenerationState["changeLevel"],
): InteriorGenerationState {
  const preserve = {
    ...(GENERATION_CHANGE_LEVELS.find((p) => p.id === String(level))!.defaults
      .preserve as InteriorGenerationState["preserve"]),
  };
  return {
    ...state,
    changeLevel: level,
    preserve,
    camera: preserve.camera ? { mode: "original" } : state.camera,
  };
}
export function setGenerationPreserve(
  state: InteriorGenerationState,
  key: PreserveKey,
  value: boolean,
): InteriorGenerationState {
  return {
    ...state,
    changeLevel: state.changeLevel === 0 && !value ? 1 : state.changeLevel,
    preserve: { ...state.preserve, [key]: value },
    ...(key === "camera" && value ? { camera: { mode: "original" as const } } : {}),
  };
}
export function generationInputRequired(state: InteriorGenerationState): boolean {
  return GENERATION_GOALS.find((p) => p.id === state.goal)!.constraints.includes("requires-source");
}
/** Changing the source invalidates its observations, never the user's design choices. */
export function generationWithSource(
  state: InteriorGenerationState,
  assetId: string | null,
): InteriorGenerationState {
  if (assetId === state.input.assetId) return state;
  const next = { ...state };
  delete next.sourceAnalysis;
  return {
    ...next,
    input: { type: assetId ? "render" : "none", assetId },
    camera: { mode: "original" },
    preserve: { ...state.preserve, camera: true },
    reference: state.reference?.assetId === assetId ? null : state.reference,
  };
}
// Explicit compatibility entry point for old projects; no DNA fields are migrated or overwritten.
export function generationFromLegacy(room?: string, instruction = ""): InteriorGenerationState {
  const state = initialInteriorGeneration();
  const aliases: Record<string, InteriorGenerationState["room"]> = {
    master_bedroom: "bedroom",
    office: "home_office",
    living_kitchen: "living_room",
    reception: "lobby",
  };
  const value = aliases[room ?? ""] ?? room;
  state.room = [
    "living_room",
    "bedroom",
    "kitchen",
    "dining_room",
    "bathroom",
    "home_office",
    "kids_room",
    "lobby",
    "other",
  ].includes(value ?? "")
    ? (value as InteriorGenerationState["room"])
    : "other";
  state.instruction = instruction.slice(0, 4000);
  state.preserve = { ...ALL_PRESERVE };
  return state;
}
