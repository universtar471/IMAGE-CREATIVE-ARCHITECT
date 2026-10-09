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

export type EnhancePromptInput = {
  dna: ProjectDNA;
  params: EnhanceParams;
};

const detailBucket = (strength: number): "low" | "medium" | "high" =>
  strength <= 33 ? "low" : strength <= 66 ? "medium" : "high";

/** Build the provider-neutral, deterministic prompt for generative enhancement. */
export function buildEnhancePrompt({ dna, params }: EnhancePromptInput): string {
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
  if (parsed.mode === "conservative" && parsed.targetLongEdge === null) {
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
