/**
 * Optional isometric frames (ADR-037): one paid image per step, all with the same fixed
 * camera and the SRS §10.3 prompt, submitted as ONE batch through the existing batch flow
 * and conflict gate. The image never carries text: labels stay in the vector layout.
 */
import { compilePrompt, type PromptReference } from "../prompt/compiler";
import type { KnowledgePack } from "../knowledge/pack";
import type { ProjectDNA } from "../schemas/projectDna";
import type { AssetRole, ProjectType } from "../schemas/enums";
import type { GenerationParams, ModelCapabilities } from "../schemas/generation";
import type { BatchItem } from "../schemas/jobs";
import type { DiagramPlan, DiagramStep } from "./schemas";

/** SRS §10.3, verbatim. */
export const DIAGRAM_CONCEPT_PROMPT = [
  "Create a clean architectural axonometric CONCEPT diagram using ONLY verified",
  "massing facts and approved illustrative design steps. Keep one fixed camera,",
  "consistent proportions and drawing style across all panels.",
  "Do not imply unseen floor plans or hidden structure have been measured.",
  "Leave all labels and arrows to the vector layout compositor.",
].join("\n");

/** The one camera every frame uses (AC-15: consistent angle and scale). */
export const DIAGRAM_ISOMETRIC_CAMERA = {
  id: "diagram.isometric.fixed",
  projection: "orthographic",
  azimuthDeg: 45,
  elevationDeg: 30,
  prompt:
    "Fixed isometric camera: orthographic axonometric projection, 45° azimuth from the front-left corner, 30° elevation, the whole building centred with the same scale and margin in every panel, plain light background, 16:9 frame.",
} as const;

const NO_TEXT = "The image must contain no text, letters, numbers, captions, arrows or labels.";

function verifiedMassingFacts(dna: ProjectDNA): string[] {
  const b = dna.building;
  const d = b.dimensions;
  const size = [
    d.widthM && `${d.widthM} m wide`,
    d.depthM && `${d.depthM} m deep`,
    d.heightM && `${d.heightM} m high`,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    `Building: ${b.buildingType}${b.architecturalStyle ? `, ${b.architecturalStyle}` : ""}.`,
    b.floors ? `Floors: ${b.floors}.` : null,
    size ? `Size: ${size}.` : null,
    b.massing.mainVolume ? `Main volume: ${b.massing.mainVolume}.` : null,
    b.massing.secondaryVolume ? `Secondary volume: ${b.massing.secondaryVolume}.` : null,
    b.massing.voids.length ? `Voids: ${b.massing.voids.join(", ")}.` : null,
    b.roof.type ? `Roof: ${b.roof.type}.` : null,
  ].filter((line): line is string => !!line);
}

/** The positive prompt of one step's frame (English, model-facing). */
export function diagramFramePrompt(dna: ProjectDNA, plan: DiagramPlan, step: DiagramStep): string {
  const total = plan.steps.length;
  const lines = [
    DIAGRAM_CONCEPT_PROMPT,
    "",
    DIAGRAM_ISOMETRIC_CAMERA.prompt,
    `Panel ${step.index + 1} of ${total}: ${step.title.en}. ${step.caption.en}`,
    step.evidence === "verified"
      ? "This step is backed by the project facts below."
      : "This step is an illustrative idea: draw it as abstract massing, not as measured geometry.",
    step.interior && step.evidence !== "verified"
      ? "Do not draw interior rooms, furniture, partitions or a floor plan."
      : null,
    NO_TEXT,
    "",
    "Verified massing facts:",
    ...verifiedMassingFacts(dna),
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

export type DiagramFrameBuildInput = {
  project: { id: string; name: string; projectType: ProjectType; subtype?: string | null };
  dna: ProjectDNA;
  pack?: KnowledgePack | null;
  assets: readonly { id: string; role: AssetRole; originalName?: string | null }[];
  /** The selected source render; passed as the only reference when the model takes one. */
  sourceAssetId: string;
  plan: DiagramPlan;
  model: Pick<ModelCapabilities, "imageToImage" | "maxReferenceImages">;
  params: GenerationParams;
};

/** One batch item per step, same camera and params; labels are `NN · title`. */
export function buildDiagramFrameItems(input: DiagramFrameBuildInput): BatchItem[] {
  const source = input.assets.find((asset) => asset.id === input.sourceAssetId);
  if (!source) throw new Error(`Diagram source asset not found: ${input.sourceAssetId}`);
  const useSource = input.model.imageToImage && input.model.maxReferenceImages >= 1;
  const references: PromptReference[] = useSource
    ? [{ assetId: source.id, role: "master_architecture", label: source.originalName ?? null }]
    : [];
  const base = compilePrompt({
    project: input.project,
    dna: input.dna,
    pack: input.pack,
    references,
  });
  return input.plan.steps.map((step) => ({
    cameraId: null,
    label: `${String(step.index + 1).padStart(2, "0")} · ${step.title.en}`,
    prompt: {
      ...base,
      positivePrompt: diagramFramePrompt(input.dna, input.plan, step),
      negativePrompt: [
        base.negativePrompt,
        "text, letters, labels, arrows, watermark, perspective distortion, people",
      ]
        .filter((part) => part.trim())
        .join(", "),
      referenceInstructions: useSource
        ? "Image 1 is the source render: keep its massing, proportions and roof form."
        : "",
      preservationInstructions:
        "Keep the same isometric camera, scale, line weight and palette in every panel.",
      metadata: {
        ...base.metadata,
        diagram: { type: input.plan.type, stepId: step.id, camera: DIAGRAM_ISOMETRIC_CAMERA.id },
      },
    },
    referenceAssetIds: useSource ? [source.id] : [],
    params: { ...input.params },
  }));
}

type FrameGeneration = {
  batchId: string | null;
  status: string;
  createdAt: string;
  outputAssetIds: readonly string[];
  prompt: { metadata: Record<string, unknown> };
};

export type DiagramFrameOutputs = {
  /** The newest frame batch of this diagram; null when none was queued. */
  batchId: string | null;
  /** Completed frames of that batch by step id (first output of each item). */
  frames: Record<string, string>;
  /** Every step of the plan has a frame from that one batch. */
  complete: boolean;
};

/**
 * The frames of the newest frame batch of `plan` (one batch = one camera and style, AC-15).
 * Items are matched by the step id recorded in their prompt metadata, never by position.
 */
export function diagramFrameOutputs(
  plan: Pick<DiagramPlan, "type" | "steps">,
  generations: readonly FrameGeneration[],
): DiagramFrameOutputs {
  const stepIds = new Set(plan.steps.map((s) => s.id));
  const ofPlan = generations
    .map((g) => {
      const meta = g.prompt.metadata.diagram as { type?: unknown; stepId?: unknown } | undefined;
      return meta?.type === plan.type && typeof meta.stepId === "string" && stepIds.has(meta.stepId)
        ? { g, stepId: meta.stepId }
        : null;
    })
    .filter((x): x is { g: FrameGeneration; stepId: string } => x !== null);
  if (!ofPlan.length) return { batchId: null, frames: {}, complete: false };
  const newest = ofPlan.reduce((a, b) => (b.g.createdAt > a.g.createdAt ? b : a));
  const batchId = newest.g.batchId;
  const frames: Record<string, string> = {};
  for (const { g, stepId } of ofPlan) {
    if (g.batchId !== batchId || g.status !== "completed" || !g.outputAssetIds[0]) continue;
    frames[stepId] = g.outputAssetIds[0];
  }
  return { batchId, frames, complete: plan.steps.every((s) => frames[s.id]) };
}
