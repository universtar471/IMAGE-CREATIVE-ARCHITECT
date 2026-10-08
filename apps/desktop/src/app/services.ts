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
import { call } from "../lib/bridge";
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

/**
 * Compile from PERSISTED data only (never unsaved form state), so the preview always
 * reflects what is stored. Deterministic for identical stored data + compiler version.
 * With `referenceAssetIds`, only those (ready) assets are described as references — the
 * exact set a generation sends; otherwise every ready asset is (the Prompt Preview view).
 */
export async function compilePromptPreview(
  projectId: string,
  referenceAssetIds?: readonly string[],
): Promise<PromptBundle> {
  const { project, dna, assets } = await call("project_get", { projectId });
  const { pack } = knowledge.resolve(project.projectType, project.subtype);
  return compilePrompt({
    project: {
      id: project.id,
      name: project.name,
      projectType: project.projectType,
      subtype: project.subtype,
    },
    dna,
    pack,
    references: assets
      .filter((a) => a.status === "ready")
      .filter((a) => !referenceAssetIds || referenceAssetIds.includes(a.id))
      .map((a) => ({ assetId: a.id, role: a.role, label: a.originalName })),
  });
}
