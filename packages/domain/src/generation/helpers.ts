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
  (r) => r !== "regular_image" && r !== "structure_sketch",
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

/** Pixel size of the image a generation is anchored on (master, else first reference). */
export type AspectAnchor = { widthPx: number | null; heightPx: number | null };

/**
 * The offered "W:H" ratio closest to `width`/`height` (compared in log space, so 2:1 and 1:2
 * are equally far from 1:1). Falls back to the first option when the size is unknown or no
 * option parses; null when the model offers none (provider decides).
 */
export function closestAspectRatio(
  ratios: readonly string[],
  width: number | null | undefined,
  height: number | null | undefined,
): string | null {
  if (!ratios.length) return null;
  if (!width || !height) return ratios[0]!;
  const target = Math.log(width / height);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const r of ratios) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(r);
    if (!m || !Number(m[1]) || !Number(m[2])) continue;
    const dist = Math.abs(Math.log(Number(m[1]) / Number(m[2])) - target);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return best ?? ratios[0]!;
}

/**
 * Default parameters for a model: the offered ratio closest to the anchor image (first option
 * without one), the first offered size (null when the model lists none), 1 output, no seed,
 * the provider's default quality.
 */
export function defaultGenerationParams(
  model: ModelCapabilities,
  anchor?: AspectAnchor | null,
): GenerationParams {
  return {
    aspectRatio: closestAspectRatio(model.aspectRatios, anchor?.widthPx, anchor?.heightPx),
    imageSize: model.imageSizes[0] ?? null,
    outputCount: 1,
    seed: null,
    quality: null,
  };
}

/**
 * Keep what the user chose where the model still supports it; reset the rest to defaults.
 * Used when switching model so stale values never reach the request.
 */
export function adaptGenerationParams(
  params: GenerationParams,
  model: ModelCapabilities,
  anchor?: AspectAnchor | null,
): GenerationParams {
  const d = defaultGenerationParams(model, anchor);
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
    quality:
      params.quality !== null && model.qualityOptions.includes(params.quality)
        ? params.quality
        : null,
  };
}

export type GenerationIssueField =
  "prompt" | "references" | "outputCount" | "aspectRatio" | "imageSize" | "seed" | "quality";

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
  // An empty list means the provider decides, so only null is valid then (§9).
  if (p.aspectRatio !== null && !model.aspectRatios.includes(p.aspectRatio)) {
    issues.push({
      field: "aspectRatio",
      message: model.aspectRatios.length
        ? `Aspect ratio ${p.aspectRatio} is not offered by ${model.label}.`
        : `${model.label} chooses the aspect ratio itself; leave it unset.`,
    });
  }
  if (p.imageSize !== null && !model.imageSizes.includes(p.imageSize)) {
    issues.push({
      field: "imageSize",
      message: model.imageSizes.length
        ? `Image size ${p.imageSize} is not offered by ${model.label}.`
        : `${model.label} chooses the image size itself; leave it unset.`,
    });
  }
  if (p.seed !== null && !model.supportsSeed) {
    issues.push({ field: "seed", message: `${model.label} does not support a fixed seed.` });
  }
  if (p.seed !== null && (!Number.isInteger(p.seed) || p.seed < 0)) {
    issues.push({ field: "seed", message: "Seed must be a whole number ≥ 0." });
  }
  // Older rows and callers may omit quality; treat that as null (provider default).
  const quality = p.quality ?? null;
  if (quality !== null && !model.qualityOptions.includes(quality)) {
    issues.push({
      field: "quality",
      message: model.qualityOptions.length
        ? `Quality ${quality} is not offered by ${model.label}.`
        : `${model.label} has no quality choice; leave it unset.`,
    });
  }
  return issues;
}

/**
 * Estimated cost in VND of `images` images at the chosen tier, from the model's `priceHint`.
 * Null when the model has no price list, no tier is chosen, or the tier has no published price.
 */
export function estimateCostVnd(
  model: Pick<ModelCapabilities, "priceHint">,
  imageSize: string | null,
  images: number,
): number | null {
  if (!model.priceHint || imageSize === null) return null;
  const price = model.priceHint[imageSize];
  return price === undefined ? null : price * images;
}

/** VND with a dot as thousands separator, as the HHTECH price list writes it: 1200 → "1.200đ". */
export function formatVnd(amount: number): string {
  const digits = String(Math.round(amount));
  return `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}đ`;
}

/**
 * Short cost text for a run, e.g. "≈ 1.200đ"; for a priced model whose tier has no published
 * price, says so. Null for models without a price list (other providers).
 */
export function costHintText(
  model: Pick<ModelCapabilities, "priceHint">,
  imageSize: string | null,
  images: number,
): string | null {
  if (!model.priceHint) return null;
  const cost = estimateCostVnd(model, imageSize, images);
  if (cost === null) {
    return imageSize ? `No published price for ${imageSize}` : null;
  }
  return `≈ ${formatVnd(cost)}`;
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
