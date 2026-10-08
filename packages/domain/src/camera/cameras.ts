/**
 * Pure helpers for the Camera module (Phase 3, ADR-016). Cameras live in the DNA; the UI
 * creates them with these helpers and autosaves them with the rest of the DNA.
 */
import { newCameraId } from "../ids";
import type { ReadinessItem } from "../invariants/dna";
import type { CameraPreset } from "../knowledge/pack";
import type { CameraDNA } from "../schemas/future";
import type { CameraAnchorDTO } from "../schemas/jobs";
import type { ProjectDNA } from "../schemas/projectDna";

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * `base` if no existing camera uses it (case-insensitive, trimmed), otherwise the first free
 * `base 2`, `base 3`, … An empty base becomes "Camera".
 */
export function uniqueCameraName(base: string, existingNames: readonly string[]): string {
  const stem = base.trim() || "Camera";
  const taken = new Set(existingNames.map(normalizeName));
  if (!taken.has(normalizeName(stem))) return stem;
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}`;
    if (!taken.has(normalizeName(candidate))) return candidate;
  }
}

/**
 * A new camera from a knowledge-pack preset: fresh id, unique name (the preset label),
 * the preset's viewpoint values, and `isAnchorView` from `anchorRecommended`.
 */
export function cameraFromPreset(
  preset: CameraPreset,
  existingNames: readonly string[] = [],
  id: string = newCameraId(),
): CameraDNA {
  return stripUndefinedFields({
    schemaVersion: 1,
    id,
    name: uniqueCameraName(preset.label, existingNames),
    viewType: preset.viewType,
    presetId: preset.id,
    isAnchorView: preset.anchorRecommended,
    azimuthDeg: preset.azimuthDeg,
    elevationDeg: preset.elevationDeg,
    heightM: preset.heightM,
    distanceM: preset.distanceM,
    lensMm: preset.lensMm,
    aspectRatio: preset.aspectRatio,
    composition: preset.composition,
    notes: "",
  });
}

/** An empty `custom` camera named "Camera N" (first free number). */
export function blankCamera(
  existingNames: readonly string[] = [],
  id: string = newCameraId(),
): CameraDNA {
  return {
    schemaVersion: 1,
    id,
    name: uniqueCameraName(`Camera ${existingNames.length + 1}`, existingNames),
    viewType: "custom",
    isAnchorView: false,
    notes: "",
  };
}

/**
 * A copy with a fresh id and a unique "<name> copy" name. The copy is not an anchor view:
 * anchors belong to one camera id, and a copied flag would silently add a required anchor.
 */
export function duplicateCamera(
  camera: CameraDNA,
  existingNames: readonly string[] = [],
  id: string = newCameraId(),
): CameraDNA {
  return {
    ...structuredClone(camera),
    id,
    name: uniqueCameraName(`${camera.name} copy`, existingNames),
    isAnchorView: false,
  };
}

export function findCamera(
  dna: Pick<ProjectDNA, "cameras">,
  cameraId: string | null | undefined,
): CameraDNA | undefined {
  return cameraId ? dna.cameras.find((c) => c.id === cameraId) : undefined;
}

/** Cameras flagged as anchor views, in DNA order. */
export function anchorViews(dna: Pick<ProjectDNA, "cameras">): CameraDNA[] {
  return dna.cameras.filter((c) => c.isAnchorView);
}

/** True when the camera carries enough viewpoint data for a meaningful camera prompt. */
export function cameraHasViewpoint(camera: CameraDNA): boolean {
  return (
    camera.viewType !== "custom" ||
    camera.azimuthDeg !== undefined ||
    camera.elevationDeg !== undefined ||
    !!camera.composition?.trim() ||
    !!camera.notes.trim()
  );
}

export type CameraReadinessState = {
  /** Whether the project's master is approved; omit to skip that item. */
  masterApproved?: boolean;
  /** Current anchors (`camera_anchor_list`); omit to skip the anchors item. */
  anchors?: readonly Pick<CameraAnchorDTO, "cameraId">[];
};

/**
 * What the camera workflow still needs, for the UI to explain disabled actions
 * ("Generate anchors", "Render cameras"). Items with missing data name the cameras in
 * `detail`. The anchor items mirror the backend status derivation (ADR-016).
 */
export function cameraReadiness(
  dna: Pick<ProjectDNA, "cameras">,
  state: CameraReadinessState = {},
): ReadinessItem[] {
  const views = anchorViews(dna);
  const vague = dna.cameras.filter((c) => !cameraHasViewpoint(c));
  const items: ReadinessItem[] = [
    { key: "cameras.any", label: "At least one camera", done: dna.cameras.length > 0 },
    {
      key: "cameras.viewpoint",
      label: "Every camera describes its viewpoint (view type, angle or composition)",
      done: vague.length === 0,
      ...(vague.length ? { detail: names(vague) } : {}),
    },
    { key: "cameras.anchorView", label: "At least one anchor view", done: views.length > 0 },
  ];
  if (state.masterApproved !== undefined) {
    items.push({
      key: "master.approved",
      label: "Master image approved",
      done: state.masterApproved,
    });
  }
  if (state.anchors) {
    const anchored = new Set(state.anchors.map((a) => a.cameraId));
    const missing = views.filter((c) => !anchored.has(c.id));
    items.push({
      key: "anchors.complete",
      label: "Every anchor view has an approved anchor",
      done: views.length > 0 && missing.length === 0,
      ...(missing.length ? { detail: names(missing) } : {}),
    });
  }
  return items;
}

const names = (cameras: readonly CameraDNA[]) => cameras.map((c) => c.name).join(", ");

function stripUndefinedFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
