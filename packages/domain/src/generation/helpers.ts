/**
 * Pure helpers for the Phase 2 generation flow (docs/API_CONTRACTS.md §9).
 * The UI uses them to derive defaults and to validate before calling `generation_submit`;
 * the mock backend reuses the validation so both enforce the same rules.
 * The Rust backend remains the authority; keep these in sync with its checks.
 */
import { REFERENCE_ROLE_ORDER } from "../prompt/compiler";
import type { AssetRole, AssetStatus } from "../schemas/enums";
import type {
  GenerationParams,
  GenerationSubmitRequest,
  ModelCapabilities,
} from "../schemas/generation";

/** The asset fields the reference helpers need (an `AssetDTO` satisfies it). */
export type ReferenceCandidate = {
  id: string;
  role: AssetRole;
  status: AssetStatus;
};

/**
 * Roles picked automatically. `regular_image` is excluded on purpose: every generated output
 * is a regular image, so auto-including them would feed each result into the next request.
 * The user can still tick regular images by hand.
 */
export const DEFAULT_REFERENCE_ROLES: readonly AssetRole[] = REFERENCE_ROLE_ORDER.filter(
  (r) => r !== "regular_image",
);

const roleRank = (role: AssetRole) => REFERENCE_ROLE_ORDER.indexOf(role);
const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Order references exactly as the Prompt Compiler numbers them ("Image 1", "Image 2" …):
 * role order (master first), then asset ID. Submitting in this order keeps the image
 * numbering in the compiled prompt aligned with the images sent to the provider.
 */
export function orderReferences<T extends ReferenceCandidate>(assets: readonly T[]): T[] {
  return [...assets].sort(
    (a, b) => roleRank(a.role) - roleRank(b.role) || compareStrings(a.id, b.id),
  );
}

/** Order a set of asset IDs with {@link orderReferences}; unknown IDs are dropped. */
export function orderReferenceIds(
  ids: readonly string[],
  assets: readonly ReferenceCandidate[],
): string[] {
  const wanted = new Set(ids);
  return orderReferences(assets.filter((a) => wanted.has(a.id))).map((a) => a.id);
}

/**
 * Default reference selection for a model: ready assets only, master first, then the other
 * roles in `REFERENCE_ROLE_ORDER` (regular images excluded), capped at `maxReferenceImages`.
 * A model without image-to-image gets none.
 */
export function defaultReferenceIds(
  assets: readonly ReferenceCandidate[],
  model: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages">,
): string[] {
  if (!model.imageToImage) return [];
  return orderReferences(
    assets.filter((a) => a.status === "ready" && DEFAULT_REFERENCE_ROLES.includes(a.role)),
  )
    .slice(0, model.maxReferenceImages)
    .map((a) => a.id);
}

/** Default parameters for a model: first offered ratio/size (or provider default), 1 output, no seed. */
export function defaultGenerationParams(model: ModelCapabilities): GenerationParams {
  return {
    aspectRatio: model.aspectRatios[0] ?? null,
    imageSize: model.imageSizes[0] ?? null,
    outputCount: 1,
    seed: null,
  };
}

/**
 * Keep what the user chose where the model still supports it; reset the rest to defaults.
 * Used when switching model so stale values never reach the request.
 */
export function adaptGenerationParams(
  params: GenerationParams,
  model: ModelCapabilities,
): GenerationParams {
  const d = defaultGenerationParams(model);
  return {
    aspectRatio:
      params.aspectRatio !== null && model.aspectRatios.includes(params.aspectRatio)
        ? params.aspectRatio
        : d.aspectRatio,
    imageSize:
      params.imageSize !== null && model.imageSizes.includes(params.imageSize)
        ? params.imageSize
        : d.imageSize,
    outputCount: Math.min(Math.max(1, params.outputCount), model.maxOutputs),
    seed: model.supportsSeed ? params.seed : null,
  };
}

export type GenerationIssueField =
  "prompt" | "references" | "outputCount" | "aspectRatio" | "imageSize" | "seed";

export type GenerationIssue = { field: GenerationIssueField; message: string };

/**
 * Client-side mirror of the `VALIDATION_ERROR` rules of `generation_submit` (§9).
 * Existence/ownership checks (NOT_FOUND, INVALID_STATE) need backend data; pass `assets`
 * to also flag references that are unknown or not ready.
 */
export function validateGenerationRequest(
  request: {
    prompt: Pick<GenerationSubmitRequest["prompt"], "positivePrompt">;
    referenceAssetIds: readonly string[];
    params: GenerationParams;
  },
  model: ModelCapabilities,
  assets?: readonly ReferenceCandidate[],
): GenerationIssue[] {
  const issues: GenerationIssue[] = [];
  const refs = request.referenceAssetIds;
  const p = request.params;

  if (!request.prompt.positivePrompt.trim()) {
    issues.push({ field: "prompt", message: "The compiled positive prompt is empty." });
  }
  if (new Set(refs).size !== refs.length) {
    issues.push({ field: "references", message: "A reference image is listed twice." });
  }
  if (refs.length > 0 && !model.imageToImage) {
    issues.push({
      field: "references",
      message: `${model.label} does not accept reference images. Untick them to continue.`,
    });
  } else if (refs.length > model.maxReferenceImages) {
    issues.push({
      field: "references",
      message: `${model.label} accepts at most ${model.maxReferenceImages} reference image(s); ${refs.length} selected.`,
    });
  }
  if (refs.length === 0 && !model.textToImage) {
    issues.push({
      field: "references",
      message: `${model.label} needs at least one reference image.`,
    });
  }
  if (assets) {
    for (const id of refs) {
      const a = assets.find((x) => x.id === id);
      if (!a)
        issues.push({ field: "references", message: "A selected reference no longer exists." });
      else if (a.status !== "ready")
        issues.push({ field: "references", message: "A selected reference file is missing." });
    }
  }
  if (!Number.isInteger(p.outputCount) || p.outputCount < 1) {
    issues.push({ field: "outputCount", message: "Request at least one output." });
  } else if (p.outputCount > model.maxOutputs) {
    issues.push({
      field: "outputCount",
      message: `${model.label} returns at most ${model.maxOutputs} image(s) per request.`,
    });
  }
  if (
    p.aspectRatio !== null &&
    model.aspectRatios.length &&
    !model.aspectRatios.includes(p.aspectRatio)
  ) {
    issues.push({
      field: "aspectRatio",
      message: `Aspect ratio ${p.aspectRatio} is not offered by ${model.label}.`,
    });
  }
  if (p.imageSize !== null && model.imageSizes.length && !model.imageSizes.includes(p.imageSize)) {
    issues.push({
      field: "imageSize",
      message: `Image size ${p.imageSize} is not offered by ${model.label}.`,
    });
  }
  if (p.seed !== null && !model.supportsSeed) {
    issues.push({ field: "seed", message: `${model.label} does not support a fixed seed.` });
  }
  if (p.seed !== null && (!Number.isInteger(p.seed) || p.seed < 0)) {
    issues.push({ field: "seed", message: "Seed must be a whole number ≥ 0." });
  }
  return issues;
}

/**
 * Lineage anchor of a generation (ADR-015): the master if referenced, otherwise the first
 * reference, otherwise none.
 */
export function generationParentAssetId(
  referenceAssetIds: readonly string[],
  assets: readonly ReferenceCandidate[],
): string | null {
  const master = referenceAssetIds.find(
    (id) => assets.find((a) => a.id === id)?.role === "master_architecture",
  );
  return master ?? referenceAssetIds[0] ?? null;
}
