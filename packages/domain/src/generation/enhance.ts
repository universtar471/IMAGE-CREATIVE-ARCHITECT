import { COMPILER_VERSION } from "../prompt/compiler";
import {
  EnhanceParamsSchema,
  type EnhanceParams,
  type GenerationParams,
  type ModelCapabilities,
} from "../schemas/generation";
import type { ProjectDNA } from "../schemas/projectDna";
import type { BatchItem } from "../schemas/jobs";
import type { ReferenceCandidate } from "./helpers";

export const ENHANCE_TARGETS = [2048, 3072, 4096] as const;
export const MAX_ENHANCE_EDGE = 8192;

export type UpscaleTarget =
  | "long_edge_2048"
  | "long_edge_4096"
  | "uhd_3840x2160_contain"
  | { width: number; height: number; fit: "contain" };

export type UpscaleSize = {
  width: number;
  height: number;
  /** UHD/custom contain targets may leave these pixels as letterbox padding. */
  canvasWidth: number;
  canvasHeight: number;
  letterbox: boolean;
  action: "upscale" | "keep" | "quality_only" | "skip";
};

export type EnhancePromptInput = {
  dna: ProjectDNA;
  params: EnhanceParams;
};

/** Resolve a target without ever shrinking an image accidentally. */
export function resolveUpscaleSize(
  src: { width: number; height: number },
  target: UpscaleTarget,
  ifAlreadyLarger: "keep" | "quality_only" | "skip" = "keep",
): UpscaleSize {
  const sourceWidth = Math.max(1, Math.round(src.width));
  const sourceHeight = Math.max(1, Math.round(src.height));
  const sourceLong = Math.max(sourceWidth, sourceHeight);
  const contain = (canvasWidth: number, canvasHeight: number): UpscaleSize => {
    const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const alreadyLarger =
      width < sourceWidth ||
      height < sourceHeight ||
      sourceLong > Math.max(canvasWidth, canvasHeight);
    if (alreadyLarger) {
      return {
        width: sourceWidth,
        height: sourceHeight,
        canvasWidth,
        canvasHeight,
        letterbox: true,
        action: ifAlreadyLarger,
      };
    }
    return {
      width,
      height,
      canvasWidth,
      canvasHeight,
      letterbox: width !== canvasWidth || height !== canvasHeight,
      action: "upscale",
    };
  };
  if (target === "uhd_3840x2160_contain") return contain(3840, 2160);
  if (typeof target === "object") return contain(target.width, target.height);
  const longEdge = target === "long_edge_2048" ? 2048 : 4096;
  if (sourceLong >= longEdge) {
    return {
      width: sourceWidth,
      height: sourceHeight,
      canvasWidth: sourceWidth,
      canvasHeight: sourceHeight,
      letterbox: false,
      action: ifAlreadyLarger,
    };
  }
  const scale = longEdge / sourceLong;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
    canvasWidth: Math.max(1, Math.round(sourceWidth * scale)),
    canvasHeight: Math.max(1, Math.round(sourceHeight * scale)),
    letterbox: false,
    action: "upscale",
  };
}

const detailBucket = (strength: number): "low" | "medium" | "high" =>
  strength <= 33 ? "low" : strength <= 66 ? "medium" : "high";

/** Build the provider-neutral, deterministic prompt for generative enhancement. */
export function buildEnhancePrompt({ dna, params }: EnhancePromptInput): string {
  if (params.preservationMode) {
    const locks = params.locks ?? { geometry: true, material: true, context: true, camera: true };
    const locked = Object.entries(locks)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(", ");
    const editable =
      params.preservationMode === "strict"
        ? "local deterministic processing only"
        : "light, shadow detail, material response, noise and photographic clarity";
    return [
      "TASK: Enhance the provided architectural render; DO NOT redesign.",
      "SOURCE OF TRUTH: The original approved image and locked Project/Site/Space facts.",
      `ALLOWED: improve ${editable} in editable regions only.`,
      `PRESERVE: exact geometry, doors, windows, roof, floors, furniture positions, material assignments, site neighbors, perspective and original framing. Locked facts: ${locked || "none"}.`,
      "DO NOT: add, remove, move, replace or reinterpret architectural/scene objects.",
      "If uncertain, keep the source unchanged and flag for review.",
    ].join("\n");
  }
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
};

export type EnhanceBuildInput = {
  sources: readonly EnhanceSource[];
  params: GenerationParams | EnhanceParams;
  providerId: string;
  model: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages" | "label">;
  dna?: ProjectDNA;
};

/** Build one reference-only enhancement item for every selected source image. */
export function buildEnhanceItems(input: EnhanceBuildInput): BatchItem[] {
  const enhance = "enhance" in input.params ? input.params.enhance : input.params;
  if (!enhance) throw new Error("Enhancement params are required to build enhancement items.");
  const parsed = EnhanceParamsSchema.parse(enhance);
  if (parsed.preservationMode === "strict" && input.providerId !== "local_upscale") {
    throw new Error('Strict enhancement requires providerId "local_upscale".');
  }
  if (parsed.mode === "conservative" && parsed.targetLongEdge === null) {
    throw new Error("Conservative enhancement requires targetLongEdge.");
  }
  if (parsed.mode === "conservative" && input.providerId !== "local_upscale") {
    throw new Error('Conservative enhancement requires providerId "local_upscale".');
  }
  if (!input.model.imageToImage || input.model.maxReferenceImages < 1) {
    throw new Error(`${input.model.label} does not accept reference images for enhancement.`);
  }
  if (parsed.mode === "generative" && parsed.preservationMode !== "strict" && !input.dna) {
    throw new Error("Generative enhancement requires project DNA to build its prompt.");
  }
  const promptText =
    parsed.mode === "generative" && parsed.preservationMode !== "strict"
      ? buildEnhancePrompt({ dna: input.dna!, params: parsed })
      : parsed.preservationMode && input.dna
        ? buildEnhancePrompt({ dna: input.dna, params: parsed })
        : "";
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
  return input.sources.map((source) => ({
    cameraId: null,
    label: `Enhance \u2014 ${source.originalName?.trim() || source.name?.trim() || source.id}`,
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
