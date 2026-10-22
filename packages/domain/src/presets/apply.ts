/**
 * Selecting presets and materialising them into a ShotIntent (ADR-039).
 *
 * `setShotPresets` first removes what the previous selection contributed, then applies the
 * new one, so toggling a chip is reversible and the Advanced panels (Effects, Scene objects,
 * Visual intent) keep showing and editing the same structured fields. Nothing here touches
 * ProjectDNA.
 */
import type { ProjectDNA } from "../schemas/projectDna";
import type { ShotIntent } from "../validation/shotIntent";
import type { SceneObjectRequest } from "../sceneObjects/schemas";
import { SITE_FRONTAGE_TARGET } from "../sceneObjects/allowed";
import { resolveActiveSpace } from "../spaceCatalog/resolve";
import { contextualPreset, presetOrder, shotPreset, SHOT_PRESETS } from "./catalog";
import type { PresetObject, PresetScope, ShotLighting, ShotPreset } from "./schemas";

/** Whether this shot is an interior one: the active space decides, else the project type. */
export function presetShotIsInterior(
  dna: Pick<ProjectDNA, "spaceCatalog">,
  projectType: ShotIntent["projectType"],
): boolean {
  const zone = resolveActiveSpace(dna as ProjectDNA)?.preset?.zone;
  return zone !== undefined ? zone === "interior" : projectType === "interior";
}

const inScope = (scope: PresetScope, interior: boolean) =>
  scope === "any" || (scope === "interior") === interior;

/** Presets offered for a shot, in catalog order. */
export function presetsForShot(interior: boolean): ShotPreset[] {
  return SHOT_PRESETS.filter((p) => inScope(p.scope, interior)).map((p) =>
    contextualPreset(p, interior),
  );
}

/** Known ids only, deduplicated, one per exclusive key (the last one wins), catalog order. */
export function normalizePresetIds(ids: readonly string[]): string[] {
  const byKey = new Map<string, string>();
  const free = new Set<string>();
  for (const id of ids) {
    const preset = shotPreset(id);
    if (!preset) continue;
    if (preset.exclusive) byKey.set(preset.exclusive, id);
    else free.add(id);
  }
  return [...free, ...byKey.values()].sort((a, b) => presetOrder(a) - presetOrder(b));
}

/** Click on a chip: remove it when selected, else add it and replace its exclusive peer. */
export function togglePreset(selection: readonly string[], id: string): string[] {
  if (!shotPreset(id)) return normalizePresetIds(selection);
  if (selection.includes(id)) return normalizePresetIds(selection.filter((s) => s !== id));
  return normalizePresetIds([...selection, id]);
}

export type PresetApplyResult = {
  shotIntent: ShotIntent;
  /** Selected presets that could not be applied to this shot (wrong scope, no target space). */
  skipped: string[];
};

const sameObject = (a: SceneObjectRequest, b: SceneObjectRequest) =>
  a.presetId === b.presetId &&
  a.quantity === b.quantity &&
  a.state === b.state &&
  a.targetSpaceId === b.targetSpaceId &&
  a.visibility === b.visibility &&
  a.autoPlacement === b.autoPlacement &&
  a.placementZoneId === undefined &&
  b.placementZoneId === undefined;

function objectRequest(object: PresetObject, targetSpaceId: string): SceneObjectRequest {
  return {
    presetId: object.presetId,
    quantity: object.quantity,
    targetSpaceId,
    autoPlacement: true,
    state: object.state,
    ...(object.visibility ? { visibility: object.visibility } : {}),
    sourceReferenceIds: [],
  };
}

/** Where preset objects go: the street frontage outdoors, the active space indoors. */
function objectTarget(dna: ProjectDNA, interior: boolean): string | null {
  if (!interior) return SITE_FRONTAGE_TARGET;
  return dna.spaceCatalog?.activeSpaceId ?? null;
}

/** Remove one matching request per contributed object (the user's own requests stay). */
function withoutObjects(
  requests: readonly SceneObjectRequest[],
  contributed: readonly SceneObjectRequest[],
): SceneObjectRequest[] {
  const left = [...requests];
  for (const c of contributed) {
    const index = left.findIndex((r) => sameObject(r, c));
    if (index >= 0) left.splice(index, 1);
  }
  return left;
}

type Contribution = {
  presets: ShotPreset[];
  objects: SceneObjectRequest[];
  skipped: string[];
};

function contribution(ids: readonly string[], dna: ProjectDNA, interior: boolean): Contribution {
  const target = objectTarget(dna, interior);
  const presets: ShotPreset[] = [];
  const objects: SceneObjectRequest[] = [];
  const skipped: string[] = [];
  for (const id of normalizePresetIds(ids)) {
    const preset = contextualPreset(shotPreset(id)!, interior);
    const needsTarget = !!preset.patch.objects?.length;
    if (!inScope(preset.scope, interior) || (needsTarget && !target)) {
      skipped.push(id);
      continue;
    }
    presets.push(preset);
    for (const object of preset.patch.objects ?? []) objects.push(objectRequest(object, target!));
  }
  return { presets, objects, skipped };
}

/**
 * The shot with `nextIds` selected. Fields owned only by presets (`lighting`, `gradeLookId`)
 * are rebuilt; shared fields (view, primary effect, objects) lose the previous selection's
 * contribution and get the new one, so choices made in the Advanced panels survive.
 */
export function setShotPresets(
  shot: ShotIntent,
  nextIds: readonly string[],
  dna: ProjectDNA,
): PresetApplyResult {
  const interior = presetShotIsInterior(dna, shot.projectType);
  const previous = contribution(shot.presetIds ?? [], dna, interior);
  const next = contribution(nextIds, dna, interior);

  // ---- undo the previous selection
  let visualIntent = shot.visualIntent;
  let effects = shot.effects;
  for (const p of previous.presets) {
    if (p.patch.view && visualIntent?.view === p.patch.view) visualIntent = undefined;
    if (p.patch.effect && effects?.primary?.id === p.patch.effect.id)
      effects = effects.secondary.length ? { ...effects, primary: undefined } : undefined;
  }
  let sceneObjects = withoutObjects(shot.sceneObjects ?? [], previous.objects);

  // ---- apply the next one
  const lighting: ShotLighting = {};
  let gradeLookId: ShotIntent["gradeLookId"];
  for (const p of next.presets) {
    const patch = p.patch;
    if (patch.timeOfDay) lighting.timeOfDay = patch.timeOfDay;
    if (patch.weather) lighting.weather = patch.weather;
    if (patch.view)
      visualIntent = {
        ...(visualIntent ?? shot.visualIntent ?? {}),
        view: patch.view,
        purpose: visualIntent?.purpose ?? shot.visualIntent?.purpose ?? "landscape",
      };
    if (patch.effect)
      effects = { primary: { ...patch.effect }, secondary: effects?.secondary ?? [] };
    if (patch.gradeLookId) gradeLookId = patch.gradeLookId;
  }
  sceneObjects = [...sceneObjects, ...next.objects];

  const presetIds = normalizePresetIds(nextIds);
  const result: ShotIntent = { ...shot };
  assign(result, "presetIds", presetIds.length ? presetIds : undefined);
  assign(result, "lighting", Object.keys(lighting).length ? lighting : undefined);
  assign(result, "gradeLookId", gradeLookId);
  assign(result, "visualIntent", visualIntent);
  assign(result, "effects", effects);
  assign(result, "sceneObjects", sceneObjects.length ? sceneObjects : undefined);
  return { shotIntent: result, skipped: next.skipped };
}

function assign<K extends keyof ShotIntent>(shot: ShotIntent, key: K, value: ShotIntent[K]) {
  if (value === undefined) delete shot[key];
  else shot[key] = value;
}

/** The compiled presets of a shot: known, in scope and in catalog order. */
export function compiledPresets(shot: ShotIntent | undefined, dna: ProjectDNA): ShotPreset[] {
  if (!shot?.presetIds?.length) return [];
  return contribution(shot.presetIds, dna, presetShotIsInterior(dna, shot.projectType)).presets;
}
