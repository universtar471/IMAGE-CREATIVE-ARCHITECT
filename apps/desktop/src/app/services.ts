/**
 * UI-side application services: compose domain logic (Knowledge Packs, prompt compiler)
 * with backend commands. Components call these, never `invoke` directly.
 */
import {
  compilePrompt,
  createInitialDNA,
  type ProjectDTO,
  type ProjectType,
  type PromptBundle,
  type WizardStarter,
} from "@arch/domain";
import { call, type CommandResponse } from "../lib/bridge";
import { knowledge } from "../lib/knowledge";

export type NewProjectInput = {
  name: string;
  projectType: ProjectType;
  subtype: string | null;
  starter: WizardStarter;
};

/** Resolve pack defaults + wizard input into DNA, then create project + DNA atomically. */
export async function createProject(input: NewProjectInput): Promise<ProjectDTO> {
  const { pack } = knowledge.resolve(input.projectType, input.subtype);
  const dna = createInitialDNA({
    projectType: input.projectType,
    subtype: input.subtype,
    pack,
    starter: input.starter,
  });
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
  } = {},
): PromptBundle {
  const { project, dna, assets } = bundle;
  const { pack } = knowledge.resolve(project.projectType, project.subtype);
  const ids = options.referenceAssetIds;
  return compilePrompt({
    project: {
      id: project.id,
      name: project.name,
      projectType: project.projectType,
      subtype: project.subtype,
    },
    dna,
    pack,
    cameraId: options.cameraId ?? null,
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
}

/**
 * Compile from PERSISTED data only (never unsaved form state), so the preview always
 * reflects what is stored. Deterministic for identical stored data + compiler version.
 */
export async function compilePromptPreview(
  projectId: string,
  referenceAssetIds?: readonly string[],
  camera?: { cameraId: string | null; anchorAssetId?: string | null },
): Promise<PromptBundle> {
  const bundle = await call("project_get", { projectId });
  return compileFromBundle(bundle, { referenceAssetIds, ...camera });
}
