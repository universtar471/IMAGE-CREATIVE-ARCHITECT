/**
 * Pure batch builders for Phase 3 (ADR-016, ADR-018). The UI compiles every batch item here
 * from persisted data (ADR-008) and sends the result to `batch_create`.
 */
import { anchorViews } from "../camera/cameras";
import {
  compilePrompt,
  compileWithOverrides,
  sortReferences,
  type PromptCompileInput,
  type PromptReference,
} from "../prompt/compiler";
import type { CameraDNA } from "../schemas/future";
import type { MoodDNA } from "../schemas/future";
import type { MoodPreset } from "../knowledge/pack";
import type { ProjectDNA } from "../schemas/projectDna";
import type { GenerationParams, ModelCapabilities } from "../schemas/generation";
import type { BatchItem, CameraAnchorDTO } from "../schemas/jobs";
import type { ReferenceCandidate } from "./helpers";

/** The asset fields the builders need (an `AssetDTO` satisfies it). */
export type BatchAsset = ReferenceCandidate & { originalName?: string | null };

export type BatchBuildInput = Omit<PromptCompileInput, "references" | "cameraId"> & {
  /** The project's assets (references are looked up here for role and label). */
  assets: readonly BatchAsset[];
  /** The approved master; null = none (items then carry no master reference). */
  masterAssetId: string | null;
  model: ModelCapabilities;
  /** Base params from the batch dialog; each camera's aspect ratio overrides when offered. */
  params: GenerationParams;
  /** Production only: other references chosen in the dialog (beyond master + anchor). */
  extraReferenceIds?: readonly string[];
};

/** Upper bound of `BatchCreateRequest.items` (ADR-018). */
export const MAX_BATCH_ITEMS = 50;

export type MoodVariationBuildInput = Omit<
  BatchBuildInput,
  "masterAssetId" | "extraReferenceIds"
> & {
  sourceAssetId: string;
  presets: readonly MoodPreset[];
  masterAssetId?: string | null;
};

type VariationPreset = MoodPreset & {
  values: MoodPreset["values"] & {
    lighting?: Partial<NonNullable<ProjectDNA["lighting"]>>;
    weather?: Partial<NonNullable<ProjectDNA["weather"]>>;
    mood?: Partial<NonNullable<ProjectDNA["mood"]>>;
  };
};

export class MoodVariationReferenceLimitError extends Error {
  constructor(
    readonly max: number,
    modelLabel: string,
  ) {
    super(
      `Mood variations need the source image as a reference, but ${modelLabel} accepts at most ${max} reference images.`,
    );
    this.name = "MoodVariationReferenceLimitError";
  }
}

/** Build one variation item per mood preset, preserving the source as reference #1. */
export function buildMoodVariationItems(input: MoodVariationBuildInput): BatchItem[] {
  const source = input.assets.find((asset) => asset.id === input.sourceAssetId);
  if (!source) throw new Error(`Mood variation source asset not found: ${input.sourceAssetId}`);
  const cap = input.model.imageToImage ? input.model.maxReferenceImages : 0;
  if (cap < 1) throw new MoodVariationReferenceLimitError(cap, input.model.label);
  const master = input.masterAssetId
    ? input.assets.find((asset) => asset.id === input.masterAssetId)
    : undefined;
  const sourceReference: PromptReference = {
    ...toReference(source),
    role: master?.id === source.id ? "master_architecture" : source.role,
  };
  return input.presets.map((preset) => {
    const prompt = compileWithOverrides(
      { project: input.project, dna: input.dna, pack: input.pack, references: [sourceReference] },
      {
        lighting: (preset.values as VariationPreset["values"]).lighting,
        weather: (preset.values as VariationPreset["values"]).weather,
        mood:
          (preset.values as VariationPreset["values"]).mood ?? (preset.values as Partial<MoodDNA>),
      },
    );
    prompt.preservationInstructions +=
      "\nKeep the architecture, camera and composition; change only light, weather and atmosphere.";
    return {
      cameraId: null,
      label: preset.label,
      prompt,
      referenceAssetIds: [source.id],
      params: input.params,
    };
  });
}

/** Adopt a mood preset without mutating the original DNA; locked mood is unchanged. */
export function adoptMoodPreset(dna: ProjectDNA, preset: MoodPreset): ProjectDNA {
  const next = structuredClone(dna);
  const values = preset.values as VariationPreset["values"];
  if (values.lighting && !next.locks.lighting)
    next.lighting = {
      schemaVersion: 1,
      artificialLighting: [],
      ...(next.lighting ?? {}),
      ...values.lighting,
    };
  if (values.weather && !next.locks.weather)
    next.weather = { schemaVersion: 1, notes: "", ...(next.weather ?? {}), ...values.weather };
  if (values.mood && !next.locks.mood)
    next.mood = {
      schemaVersion: 1,
      notes: "",
      ...(next.mood ?? {}),
      ...values.mood,
      presetId: preset.id,
      preset: preset.label,
    };
  else if (!next.locks.mood && !values.lighting && !values.weather)
    next.mood = {
      schemaVersion: 1,
      notes: "",
      ...(next.mood ?? {}),
      ...preset.values,
      presetId: preset.id,
      preset: preset.label,
    };
  return next;
}

/**
 * The camera's aspect ratio when the model offers it, otherwise `params` unchanged
 * (a model with an empty list decides itself, so it keeps the dialog's value).
 */
export function paramsForCamera(
  params: GenerationParams,
  camera: Pick<CameraDNA, "aspectRatio">,
  model: Pick<ModelCapabilities, "aspectRatios">,
): GenerationParams {
  return camera.aspectRatio && model.aspectRatios.includes(camera.aspectRatio)
    ? { ...params, aspectRatio: camera.aspectRatio }
    : { ...params };
}

/**
 * One `anchor` item per anchor-view camera (DNA order), each with the master as its only
 * reference (none when the model has no image-to-image or no master is given).
 */
export function buildAnchorBatchItems(input: BatchBuildInput): BatchItem[] {
  const master = findMaster(input);
  return anchorViews(input.dna).map((camera) =>
    buildItem(input, camera, master ? [master] : [], `${camera.name} — anchor`),
  );
}

/**
 * Thrown by `buildProductionBatchItems` when the model cannot carry a camera's required
 * references (the master and, when approved, that camera's anchor). The batch must not be
 * queued; the UI shows `message` and asks for another model.
 */
export class BatchReferenceLimitError extends Error {
  constructor(
    readonly cameraId: string,
    readonly cameraName: string,
    /** Required references (master + anchor when present). */
    readonly required: number,
    /** References the model accepts (0 without image-to-image). */
    readonly max: number,
    modelLabel: string,
  ) {
    const needs = required > 1 ? "the master and its approved anchor" : "the master reference";
    super(
      max === 0
        ? `${cameraName} needs ${needs}, but ${modelLabel} does not accept reference images. Choose another model.`
        : `${cameraName} needs ${needs} (${required} images), but ${modelLabel} accepts at most ${max}. Choose another model.`,
    );
    this.name = "BatchReferenceLimitError";
  }
}

/**
 * One `production` item per selected camera (DNA order; unknown ids skipped). References per
 * item: the master, then that camera's approved anchor, then the selected extras in compiler
 * order, capped at `maxReferenceImages`. Master and anchor are required: when the model cannot
 * take them all this throws `BatchReferenceLimitError` instead of dropping one. Extras that do
 * not fit under the cap are trimmed (lowest compiler priority first).
 */
export function buildProductionBatchItems(
  input: BatchBuildInput,
  cameraIds: readonly string[],
  anchors: readonly Pick<CameraAnchorDTO, "cameraId" | "assetId">[],
): BatchItem[] {
  const wanted = new Set(cameraIds);
  const master = findMaster(input);
  const byId = new Map(input.assets.map((a) => [a.id, a]));
  return input.dna.cameras
    .filter((camera) => wanted.has(camera.id))
    .map((camera) => {
      const fixed: PromptReference[] = master ? [master] : [];
      const anchorId = anchors.find((a) => a.cameraId === camera.id)?.assetId;
      const anchorAsset = anchorId ? byId.get(anchorId) : undefined;
      if (anchorAsset && anchorAsset.id !== master?.assetId) {
        fixed.push({ ...toReference(anchorAsset), isAnchor: true });
      }
      const cap = input.model.imageToImage ? input.model.maxReferenceImages : 0;
      if (fixed.length > cap) {
        throw new BatchReferenceLimitError(
          camera.id,
          camera.name,
          fixed.length,
          cap,
          input.model.label,
        );
      }
      const used = new Set(fixed.map((r) => r.assetId));
      const extras = sortReferences(
        dedupe(input.extraReferenceIds ?? [])
          .map((id) => byId.get(id))
          .filter(
            (a): a is BatchAsset => !!a && !used.has(a.id) && a.role !== "master_architecture",
          )
          .map(toReference),
      );
      return buildItem(input, camera, [...fixed, ...extras], `${camera.name} — production`);
    });
}

function buildItem(
  input: BatchBuildInput,
  camera: CameraDNA,
  candidates: readonly PromptReference[],
  label: string,
): BatchItem {
  // Candidates arrive in priority order (master, anchor, extras); cap before numbering.
  const cap = input.model.imageToImage ? input.model.maxReferenceImages : 0;
  const references = sortReferences(candidates.slice(0, cap));
  return {
    cameraId: camera.id,
    label,
    prompt: compilePrompt({
      project: input.project,
      dna: input.dna,
      pack: input.pack,
      references,
      cameraId: camera.id,
    }),
    referenceAssetIds: references.map((r) => r.assetId),
    params: paramsForCamera(input.params, camera, input.model),
  };
}

function findMaster(input: BatchBuildInput): PromptReference | null {
  if (!input.masterAssetId) return null;
  const asset = input.assets.find((a) => a.id === input.masterAssetId);
  // The master is the master even if its role was not refreshed in this asset list.
  return asset ? { ...toReference(asset), role: "master_architecture" } : null;
}

function toReference(asset: BatchAsset): PromptReference {
  return { assetId: asset.id, role: asset.role, label: asset.originalName ?? null };
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
