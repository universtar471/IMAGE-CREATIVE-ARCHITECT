import type { GenerationPurpose } from "../schemas/generation";
import type { ProjectDNA } from "../schemas/projectDna";
import type { QcReportDTO } from "./schemas";

export const QC_SAME_VIEW_PURPOSES = ["enhance", "variation", "repair", "color_grade"] as const;
export type QcPurpose = GenerationPurpose | "color_grade";

export type VisionPromptInput = { dna: ProjectDNA; purpose: QcPurpose };
export type VisionPrompt = { system: string; user: string };

const SYSTEM_PROMPT = `You are a strict architectural image quality-control judge. Compare the evaluated image with its reference images and the supplied project DNA facts.

Score exactly these five categories from 0 to 100:
- geometry: building massing, proportions, floor count, roof form, perspective and structural consistency.
- material: specified facade, roof and surface materials, colors, texture fidelity and finish consistency.
- openings: window and door count, placement, rhythm, frames, glazing and alignment.
- context: site layout, streets, neighbouring buildings, landscape, vegetation and background consistency.
- lighting: time of day, direction, intensity, shadows, artificial lights, weather and atmosphere consistency.

List visible image-generation artifacts separately. Artifact severity must be low, medium or high. Each box must be [x,y,w,h] normalized to 0..1, or null when no useful box can be given. Issue category must be geometry, material, openings, context, lighting or artifact.

Return JSON only, without markdown or prose, using exactly these top-level keys:
{"scores":{"geometry":0,"material":0,"openings":0,"context":0,"lighting":0},"artifacts":[{"label":"","severity":"low","box":null}],"issues":[{"category":"geometry","text":""}],"repairInstruction":""}`;

function facts(dna: ProjectDNA): string {
  return [
    `Building DNA: ${JSON.stringify(dna.building)}`,
    `Context DNA: ${JSON.stringify(dna.context)}`,
    `Camera DNA: ${JSON.stringify(dna.cameras)}`,
    `Lighting DNA: ${JSON.stringify(dna.lighting ?? null)}`,
    `Weather DNA: ${JSON.stringify(dna.weather ?? null)}`,
    `Mood DNA: ${JSON.stringify(dna.mood ?? null)}`,
  ].join("\n");
}

/** Build deterministic provider-neutral instructions for the optional vision judge. */
export function buildVisionPrompt({ dna, purpose }: VisionPromptInput): VisionPrompt {
  const sameView = (QC_SAME_VIEW_PURPOSES as readonly string[]).includes(purpose)
    ? "This output must keep the same viewpoint, camera, framing and composition as its primary reference. Treat any drift as a geometry issue."
    : "Judge the requested viewpoint on its own terms; do not require it to match the primary reference camera.";
  return {
    system: SYSTEM_PROMPT,
    user: [`Generation purpose: ${purpose}.`, sameView, "Project DNA facts:", facts(dna)].join(
      "\n",
    ),
  };
}

export type RepairPromptInput = { dna: ProjectDNA; report: QcReportDTO };

/** Build a narrow edit prompt that changes only defects recorded by one QC report. */
export function buildRepairPrompt({ dna, report }: RepairPromptInput): string {
  const vision = report.vision;
  const issueLines = vision?.issues.length
    ? vision.issues.map((issue, index) => `${index + 1}. [${issue.category}] ${issue.text}`)
    : ["None listed."];
  const artifactLines = vision?.artifacts.length
    ? vision.artifacts.map(
        (artifact, index) =>
          `${index + 1}. [${artifact.severity}] ${artifact.label}; box: ${artifact.box ? JSON.stringify(artifact.box) : "null"}`,
      )
    : ["None listed."];
  const instruction = vision?.repairInstruction || "No additional repair instruction.";

  return [
    "Repair this architectural image. Fix only the QC issues and artifacts listed below.",
    "QC issues:",
    ...issueLines,
    "QC artifacts:",
    ...artifactLines,
    `Repair instruction: ${instruction}`,
    "Keep the architecture, camera and composition unchanged. Keep every element not explicitly listed above unchanged, including geometry, materials, openings, context, lighting, weather and mood.",
    "Do not redesign, restyle, reframe, crop, add or remove anything else.",
    "Project facts to preserve:",
    facts(dna),
  ].join("\n");
}
