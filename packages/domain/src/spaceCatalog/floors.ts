/**
 * The optional floor step of the space wizard (SRS §4.2: building type → floor / area →
 * group → space → variant). `SpaceInstance.floorId` is a stable id, never a display label:
 * `basement`, `floor_1` … `floor_N` and `roof`. The level count follows
 * `building.floors` when it is set; a stored id outside the list is kept as an extra option.
 */
export const BASEMENT_FLOOR_ID = "basement";
export const ROOF_FLOOR_ID = "roof";

/** Levels offered when the building's floor count is not set. */
export const DEFAULT_FLOOR_COUNT = 5;
const MAX_FLOOR_COUNT = 200;

export type SpaceFloorOption =
  | { id: string; kind: "basement" | "roof" }
  | { id: string; kind: "level"; level: number }
  | { id: string; kind: "other" };

export const floorIdForLevel = (level: number) => `floor_${level}`;

export function spaceFloorOptions(
  floorCount?: number | null,
  currentFloorId?: string | null,
): SpaceFloorOption[] {
  const count =
    floorCount !== undefined &&
    floorCount !== null &&
    Number.isInteger(floorCount) &&
    floorCount > 0
      ? Math.min(floorCount, MAX_FLOOR_COUNT)
      : DEFAULT_FLOOR_COUNT;
  const options: SpaceFloorOption[] = [
    { id: BASEMENT_FLOOR_ID, kind: "basement" },
    ...Array.from({ length: count }, (_, i) => ({
      id: floorIdForLevel(i + 1),
      kind: "level" as const,
      level: i + 1,
    })),
    { id: ROOF_FLOOR_ID, kind: "roof" },
  ];
  if (currentFloorId && !options.some((o) => o.id === currentFloorId))
    options.push({ id: currentFloorId, kind: "other" });
  return options;
}
