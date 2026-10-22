/**
 * UI-side application services: compose domain logic (Knowledge Packs, prompt compiler)
 * with backend commands. Components call these, never `invoke` directly.
 */
import {
  compilePrompt,
  canonicalHash,
  orderReferences,
  createInitialDNA,
  setShotPresets,
  shotPreset,
  type InteriorDNA,
  type ProjectDNA,
  type ProjectDTO,
  type ProjectType,
  type PromptBundle,
  type ShotIntent,
  type WizardStarter,
} from "@arch/domain";
import { call, type CommandResponse } from "../lib/bridge";
import { knowledge } from "../lib/knowledge";

export type NewProjectInput = {
  name: string;
  projectType: ProjectType;
  subtype: string | null;
  starter: WizardStarter;
  interior?: InteriorDNA;
};

/** Resolve pack defaults + wizard input into DNA, then create project + DNA atomically. */
export async function createProject(input: NewProjectInput): Promise<ProjectDTO> {
  const { pack } = knowledge.resolve(input.projectType, input.subtype);
  const base = createInitialDNA({
    projectType: input.projectType,
    subtype: input.subtype,
    pack,
    starter: input.starter,
  });
  const dna: ProjectDNA = input.interior ? { ...base, interior: input.interior } : base;
  return call("project_create", {
    name: input.name,
    projectType: input.projectType,
    subtype: input.subtype,
    dna,
  });
}

export type ProjectBundle = CommandResponse<"project_get">;

/**
 * Compile from one persisted bundle (ADR-008). With `referenceAssetIds`, exactly those
 * assets are described, in that order (master, anchor, then role order); otherwise every
 * ready asset is (the Prompt Preview view). `anchorAssetId` marks the camera's anchor and
 * `cameraId` adds the camera section.
 */
export function compileFromBundle(
  bundle: ProjectBundle,
  options: {
    referenceAssetIds?: readonly string[];
    cameraId?: string | null;
    anchorAssetId?: string | null;
    shotIntent?: ShotIntent;
    sourceAssetId?: string;
    variation?: boolean;
  } = {},
): PromptBundle {
  const { project, dna, assets } = bundle;
  const { pack } = knowledge.resolve(project.projectType, project.subtype);
  const ids = options.referenceAssetIds;
  const selection = options.shotIntent;
  const effectiveShot =
    options.variation && selection?.presetIds?.some((id) => shotPreset(id)?.group === "render")
      ? setShotPresets(
          selection,
          selection.presetIds.filter((id) => shotPreset(id)?.group !== "render"),
          dna,
        ).shotIntent
      : selection;
  const result = compilePrompt({
    project: {
      id: project.id,
      name: project.name,
      projectType: project.projectType,
      subtype: project.subtype,
    },
    dna,
    pack,
    cameraId: options.cameraId ?? null,
    shotIntent: effectiveShot,
    references: assets
      .filter((a) => a.status === "ready")
      .filter((a) => !ids || ids.includes(a.id))
      .map((a) => ({
        assetId: a.id,
        role: a.role,
        label: a.originalName,
        isAnchor: !!options.anchorAssetId && a.id === options.anchorAssetId,
      })),
  });
  const ordered = orderReferences(
    assets.filter((a) => a.status === "ready" && (!ids || ids.includes(a.id))),
  );
  const sourceIndex = ordered.findIndex((a) => a.id === options.sourceAssetId);
  if (sourceIndex >= 0 && !result.metadata.interiorComposerVersion) {
    const prefix = `Image ${sourceIndex + 1}`;
    const instruction = `${prefix} is the authoritative source image. Preserve its building massing, floor count, proportions, openings, roof and materials; where the structured description differs, follow this image. ${options.variation ? "Create a variation of this same building or interior design; change only the requested viewpoint, detail, lighting or atmosphere. Reframe the source according to the requested Camera section; do not copy its original camera angle or whole-room framing when a different view or close-up is requested. Keep the same room, furniture and finishes when creating an interior detail." : "Keep the source camera and geometry exactly; render sketch lines as finished photorealistic architecture."}`;
    result.referenceInstructions = result.referenceInstructions
      .split("\n")
      .filter((line) => !line.startsWith(`${prefix} `))
      .join("\n");
    result.referenceInstructions = `${instruction}\n${result.referenceInstructions}`.trim();
    result.preservationInstructions = instruction;
    result.metadata.sourceAssetId = options.sourceAssetId!;
    result.configHash = canonicalHash({
      previous: result.configHash,
      sourceAssetId: options.sourceAssetId,
      variation: !!options.variation,
      sourceInstructionVersion: 2,
    });
  }
  return result;
}

/**
 * Compile from PERSISTED data only (never unsaved form state), so the preview always
 * reflects what is stored. Deterministic for identical stored data + compiler version.
 */
export async function compilePromptPreview(
  projectId: string,
  referenceAssetIds?: readonly string[],
  camera?: { cameraId: string | null; anchorAssetId?: string | null },
  shotIntent?: ShotIntent,
  source?: { sourceAssetId?: string; variation?: boolean },
): Promise<PromptBundle> {
  const bundle = await call("project_get", { projectId });
  return compileFromBundle(bundle, { referenceAssetIds, ...camera, shotIntent, ...source });
}
