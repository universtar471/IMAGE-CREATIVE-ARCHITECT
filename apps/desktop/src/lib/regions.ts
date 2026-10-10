import {
  buildRegionEditPrompt as buildDomainRegionEditPrompt,
  featherMask,
  newSceneObjectId,
  newUlid,
  rasterizeMask,
  sceneObjectLines,
  type ProjectDNA,
  type RegionDTO,
  type RegionEditParams,
  type RegionKind,
  type RegionShape,
  type Scene,
  type SceneObject,
  type SceneObjectCategory,
} from "@arch/domain";

export { featherMask, rasterizeMask, sceneObjectLines, newSceneObjectId };
export type {
  ProjectDNA,
  RegionDTO,
  RegionEditParams,
  RegionKind,
  RegionShape,
  SceneObject,
  SceneObjectCategory,
  Scene,
};
export type SceneRelationType = SceneObject["relations"][number]["type"];

export type SceneDNA = Scene;
export type RegionDraft = Omit<
  RegionDTO,
  "id" | "projectId" | "assetId" | "createdAt" | "updatedAt"
> & { id?: string };

/** IDs are generated locally only for optimistic UI state; persistence remains backend-owned. */
export const newRegionId = () => `RGN_${newUlid()}`;

export type RegionPromptBundle = {
  compilerVersion: "pc-1.3.0";
  positivePrompt: string;
  negativePrompt: string;
  referenceInstructions: string;
  preservationInstructions: string;
  metadata: Record<string, string>;
};

/** Adapt the domain prompt text to the persisted PromptBundle consumed by the desktop UI. */
export function buildRegionEditPrompt(input: {
  dna: ProjectDNA | (Partial<Pick<ProjectDNA, "locks">> & { scene?: SceneDNA });
  regions: readonly Pick<RegionDTO, "id" | "label" | "kind" | "objectId">[];
  params: RegionEditParams;
  nativeMask: boolean;
}): RegionPromptBundle {
  const text = buildDomainRegionEditPrompt({
    dna: input.dna as ProjectDNA,
    regions: input.regions as RegionDTO[],
    params: input.params,
    nativeMask: input.nativeMask,
  });
  const lines = text.split("\n");
  const maskNote = input.nativeMask
    ? "Use the supplied native mask; transparent alpha (0) is the area to edit."
    : "The second image is a white-on-black mask; white is the area to edit.";
  return {
    compilerVersion: "pc-1.3.0",
    positivePrompt: `${lines[0] ?? ""} ${maskNote}`,
    negativePrompt: "",
    referenceInstructions: input.nativeMask
      ? "The source image is the only reference image."
      : "The source image is followed by a black-and-white mask image.",
    preservationInstructions: `${lines.slice(1).join("\n")}\n${maskNote}`.trim(),
    metadata: {
      purpose: "region_edit",
      regionIds: input.params.regionIds.join(","),
    },
  };
}

export function buildRegionGenerationRequest(input: {
  projectId: string;
  providerId: string;
  modelId: string;
  sourceAssetId: string;
  params: RegionEditParams;
  dna: ProjectDNA | (Partial<Pick<ProjectDNA, "locks">> & { scene?: SceneDNA });
  regions: readonly Pick<RegionDTO, "id" | "label" | "kind" | "objectId">[];
  nativeMask: boolean;
}) {
  return {
    projectId: input.projectId,
    providerId: input.providerId,
    modelId: input.modelId,
    purpose: "region_edit" as const,
    prompt: buildRegionEditPrompt(input),
    referenceAssetIds: [input.sourceAssetId],
    params: {
      aspectRatio: null,
      imageSize: null,
      outputCount: 1,
      seed: null,
      quality: null,
      region: input.params,
    },
    cameraId: null,
  };
}

export const isRegionResponseCurrent = (
  projectId: string,
  assetId: string,
  responseProjectId: string | undefined,
  responseAssetId: string | undefined,
) => projectId === responseProjectId && assetId === responseAssetId;

export function normalisePoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): [number, number] {
  return [
    Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
    Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
  ];
}
