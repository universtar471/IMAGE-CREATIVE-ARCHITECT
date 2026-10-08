/**
 * Pure batch builders for Phase 3 (ADR-016, ADR-018). The UI compiles every batch item here
 * from persisted data (ADR-008) and sends the result to `batch_create`.
 */
import { anchorViews } from "../camera/cameras";
import {
  compilePrompt,
  sortReferences,
  type PromptCompileInput,
  type PromptReference,
} from "../prompt/compiler";
import type { CameraDNA } from "../schemas/future";
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
 * One `production` item per selected camera (DNA order; unknown ids skipped). References per
 * item: the master, then that camera's approved anchor, then the selected extras in compiler
 * order, capped at `maxReferenceImages`. Master and anchor are never dropped for extras; with
 * a cap of 1 only the master is sent.
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
