import { COMPILER_VERSION } from "../prompt/compiler";
import {
  EnhanceParamsSchema,
  type EnhanceLocks,
  type EnhanceParams,
  type GenerationParams,
  type IfAlreadyLarger,
  type ModelCapabilities,
  type PreservationMode,
  type UpscaleTarget,
} from "../schemas/generation";
import type { ProjectDNA } from "../schemas/projectDna";
import type { BatchItem } from "../schemas/jobs";
import type { ReferenceCandidate } from "./helpers";

export const ENHANCE_TARGETS = [2048, 3072, 4096] as const;
export const MAX_ENHANCE_EDGE = 8192;
export const UHD_WIDTH = 3840;
export const UHD_HEIGHT = 2160;

export const DEFAULT_ENHANCE_LOCKS: EnhanceLocks = {
  geometry: true,
  material: true,
  context: true,
  camera: true,
};

/** Output layout of an upscale: the image (`width` x `height`) inside its canvas. */
export type UpscaleSize = {
  width: number;
  height: number;
  /** Equal to width/height unless a contain target leaves letterbox padding. */
  canvasWidth: number;
  canvasHeight: number;
  offsetX: number;
  offsetY: number;
  letterbox: boolean;
  /** `upscale` = scaled to the target (factor >= 1); otherwise `ifAlreadyLarger` decided. */
  action: "upscale" | IfAlreadyLarger;
};

/** round(a / b) for non-negative integers, half away from zero, without float drift. */
const roundDiv = (a: number, b: number): number => Math.floor((2 * a + b) / (2 * b));

/**
 * Resolve a size target deterministically (ADR-035). Aspect ratio is always kept, a long-edge
 * target makes the long edge exactly 2048/4096, UHD and custom targets contain the image and
 * letterbox it (never a crop), and nothing is ever downscaled: a source that is larger than
 * the target keeps its own size and `ifAlreadyLarger` decides what happens. The Rust
 * `resolve_upscale_size` follows the same integer math (test-vectors/upscale.json).
 */
export function resolveUpscaleSize(
  src: { width: number; height: number },
  target: UpscaleTarget,
  ifAlreadyLarger: IfAlreadyLarger = "keep",
): UpscaleSize {
  const sw = Math.max(1, Math.round(src.width));
  const sh = Math.max(1, Math.round(src.height));
  const keep = (): UpscaleSize => ({
    width: sw,
    height: sh,
    canvasWidth: sw,
    canvasHeight: sh,
    offsetX: 0,
    offsetY: 0,
    letterbox: false,
    action: ifAlreadyLarger,
  });
  if (target === "long_edge_2048" || target === "long_edge_4096") {
    const edge = target === "long_edge_2048" ? 2048 : 4096;
    if (Math.max(sw, sh) > edge) return keep();
    const width = sw >= sh ? edge : Math.max(1, roundDiv(sw * edge, sh));
    const height = sw >= sh ? Math.max(1, roundDiv(sh * edge, sw)) : edge;
    return {
      width,
      height,
      canvasWidth: width,
      canvasHeight: height,
      offsetX: 0,
      offsetY: 0,
      letterbox: false,
      action: "upscale",
    };
  }
  const [cw, ch] =
    target === "uhd_3840x2160_contain" ? [UHD_WIDTH, UHD_HEIGHT] : [target.width, target.height];
  if (sw > cw || sh > ch) return keep();
  const widthLimited = sw * ch >= sh * cw;
  const width = widthLimited ? cw : Math.max(1, roundDiv(sw * ch, sh));
  const height = widthLimited ? Math.max(1, roundDiv(sh * cw, sw)) : ch;
  return {
    width,
    height,
    canvasWidth: cw,
    canvasHeight: ch,
    offsetX: Math.floor((cw - width) / 2),
    offsetY: Math.floor((ch - height) / 2),
    letterbox: width !== cw || height !== ch,
    action: "upscale",
  };
}

/** The legacy `targetLongEdge` that matches an upscale target (null when it has none). */
export function upscaleTargetLongEdge(target: UpscaleTarget): 2048 | 4096 | null {
  return target === "long_edge_2048" ? 2048 : target === "long_edge_4096" ? 4096 : null;
}

export type EnhancePromptInput = {
  dna: ProjectDNA;
  params: EnhanceParams;
};

const detailBucket = (strength: number): "low" | "medium" | "high" =>
  strength <= 33 ? "low" : strength <= 66 ? "medium" : "high";

/** SRS §8.2 template, verbatim. */
const PRESERVATION_TEMPLATE = [
  "TASK: Enhance the provided architectural render; DO NOT redesign.",
  "SOURCE OF TRUTH: The original approved image and locked Project/Site/Space facts.",
  "ALLOWED: improve light balance, shadow detail, physically plausible material response,",
  "noise and photographic clarity in the editable regions only.",
  "PRESERVE: exact geometry, doors, windows, roof, floors, furniture positions,",
  "material assignments, site neighbors, perspective and original framing.",
  "DO NOT: add, remove, move, replace or reinterpret architectural/scene objects.",
  "If uncertain, keep the source unchanged and flag for review.",
] as const;

function preservationPrompt(dna: ProjectDNA, params: EnhanceParams, mode: PreservationMode) {
  const locks = params.locks ?? DEFAULT_ENHANCE_LOCKS;
  const lines: string[] = [...PRESERVATION_TEMPLATE];
  lines.push(
    params.allowedRegionIds?.length
      ? "EDITABLE REGIONS: only the allowed-region mask; every other pixel is restored from the source."
      : "EDITABLE REGIONS: the whole frame (no allowed-region mask); every lock still applies.",
  );
  lines.push(
    mode === "creative"
      ? `INTENSITY: stronger enhancement inside the editable regions, detail level ${detailBucket(params.detailStrength)}; the result is always reviewed.`
      : `INTENSITY: subtle, detail level ${detailBucket(params.detailStrength)}.`,
  );
  if (locks.geometry)
    lines.push(
      "GEOMETRY LOCK: keep outlines, openings, roof, ceiling and floor, and locked objects exactly.",
    );
  if (locks.material) {
    const materials = dna.building.materials.map(
      (material) => `${material.zone}: ${material.description}`,
    );
    if (dna.building.colorPalette.length)
      materials.push(`color palette: ${dna.building.colorPalette.join(", ")}`);
    lines.push(
      "MATERIAL LOCK: keep material zones, approved colours and textures; only improve their light response.",
    );
    if (materials.length) lines.push(`Materials: ${materials.join("; ")}.`);
  }
  if (locks.context)
    lines.push(
      "CONTEXT LOCK: keep neighbouring buildings, road, trees and confirmed vehicles and people.",
    );
  if (locks.camera)
    lines.push(
      "CAMERA LOCK: keep the viewpoint, perspective, crop and aspect ratio; never crop or reframe.",
    );
  return lines.join("\n");
}

/**
 * Build the provider-neutral, deterministic prompt for generative enhancement. With a
 * `preservationMode` it is the SRS §8.2 template plus the active locks; without one the
 * output is exactly the legacy prompt.
 */
export function buildEnhancePrompt({ dna, params }: EnhancePromptInput): string {
  if (params.preservationMode) return preservationPrompt(dna, params, params.preservationMode);
  const lines = [
    `Enhance this architectural image with detail level: ${detailBucket(params.detailStrength)}.`,
  ];
  if (params.architecturePreserve) {
    lines.push(
      "Architecture Preserve: keep geometry, openings, proportions, materials, camera and composition exactly; add only fine detail and texture, and fix soft or noisy areas.",
    );
  } else {
    lines.push(
      "Allow richer generative detail, texture and surface refinement while preserving the existing design and composition.",
    );
  }
  const materials = dna.building.materials.map(
    (material) => `${material.zone}: ${material.description}`,
  );
  if (dna.building.colorPalette.length)
    materials.push(`color palette: ${dna.building.colorPalette.join(", ")}`);
  if (materials.length) lines.push(`Materials: ${materials.join("; ")}.`);
  lines.push("Never change the building.");
  return lines.join("\n");
}

export type EnhanceSource = ReferenceCandidate & {
  originalName?: string | null;
  name?: string | null;
  /** Pixel size when known; needed to honour `upscale.ifAlreadyLarger: "skip"`. */
  widthPx?: number | null;
  heightPx?: number | null;
};

export type EnhanceSourcePlan = {
  source: EnhanceSource;
  /** null when there is no `upscale` target or the size of the source is unknown. */
  size: UpscaleSize | null;
  /** The source already exceeds the target and the user chose to skip it. */
  skip: boolean;
};

/** Resolve every source against the size target: which ones run and at what size. */
export function planEnhanceSources(
  sources: readonly EnhanceSource[],
  params: EnhanceParams,
): EnhanceSourcePlan[] {
  return sources.map((source) => {
    const upscale = params.upscale;
    if (!upscale || !source.widthPx || !source.heightPx) return { source, size: null, skip: false };
    const size = resolveUpscaleSize(
      { width: source.widthPx, height: source.heightPx },
      upscale.target,
      upscale.ifAlreadyLarger,
    );
    return { source, size, skip: size.action === "skip" };
  });
}

export type EnhanceBuildInput = {
  sources: readonly EnhanceSource[];
  params: GenerationParams | EnhanceParams;
  providerId: string;
  model: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages" | "label">;
  dna?: ProjectDNA;
};

/**
 * Build one reference-only enhancement item for every selected source image. Sources the
 * size target says to skip produce no item (no job, no charge).
 */
export function buildEnhanceItems(input: EnhanceBuildInput): BatchItem[] {
  const enhance = "enhance" in input.params ? input.params.enhance : input.params;
  if (!enhance) throw new Error("Enhancement params are required to build enhancement items.");
  const parsed = EnhanceParamsSchema.parse(enhance);
  if (parsed.preservationMode === "strict" && input.providerId !== "local_upscale") {
    throw new Error('Strict enhancement requires providerId "local_upscale".');
  }
  if (parsed.preservationMode === "strict" && parsed.mode !== "conservative") {
    throw new Error("Strict enhancement is local and non-generative.");
  }
  if (parsed.mode === "conservative" && parsed.targetLongEdge === null && !parsed.upscale) {
    throw new Error("Conservative enhancement requires targetLongEdge.");
  }
  if (parsed.mode === "conservative" && input.providerId !== "local_upscale") {
    throw new Error('Conservative enhancement requires providerId "local_upscale".');
  }
  if (!input.model.imageToImage || input.model.maxReferenceImages < 1) {
    throw new Error(`${input.model.label} does not accept reference images for enhancement.`);
  }
  if (parsed.mode === "generative" && !input.dna) {
    throw new Error("Generative enhancement requires project DNA to build its prompt.");
  }
  const promptText =
    parsed.mode === "generative" ? buildEnhancePrompt({ dna: input.dna!, params: parsed }) : "";
  const referenceInstructions =
    parsed.mode === "generative"
      ? "Image 1 is the MASTER source image: preserve its architecture, camera and composition."
      : "";
  const batchParams: GenerationParams =
    "enhance" in input.params
      ? { ...input.params, enhance: parsed }
      : {
          aspectRatio: null,
          imageSize: null,
          outputCount: 1,
          seed: null,
          quality: null,
          enhance: parsed,
        };
  return planEnhanceSources(input.sources, parsed)
    .filter((plan) => !plan.skip)
    .map(({ source }) => ({
      cameraId: null,
      label: `Enhance — ${source.originalName?.trim() || source.name?.trim() || source.id}`,
      prompt: {
        compilerVersion: COMPILER_VERSION,
        positivePrompt: promptText,
        negativePrompt: "",
        referenceInstructions,
        preservationInstructions: "",
        metadata: {},
      },
      referenceAssetIds: [source.id],
      params: batchParams,
    }));
}

/** Job states that count as a failed item: retry resends exactly these (AC-13). */
const RETRYABLE_ITEM_STATES = new Set(["failed", "interrupted"]);

/**
 * The jobs of one batch that a "retry failed" action resends. Completed items are never
 * resent (no duplicate charge); cancelled items were skipped by the user and stay skipped.
 */
export function failedBatchJobIds(
  jobs: readonly { id: string; batchId: string | null; status: string }[],
  batchId: string,
): string[] {
  return jobs
    .filter((job) => job.batchId === batchId && RETRYABLE_ITEM_STATES.has(job.status))
    .map((job) => job.id);
}
