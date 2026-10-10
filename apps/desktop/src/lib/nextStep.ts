import type { WorkspaceData } from "../app/store";
import type { DerivedWorkflow } from "./workflow";
import { WORKFLOW_STEPS } from "./workflow";

export type NextStep = {
  id: string;
  title: string;
  action: string;
  module:
    | "overview"
    | "design_dna"
    | "context"
    | "references"
    | "camera"
    | "lighting"
    | "generate"
    | "mood_grade"
    | "enhance"
    | "qc"
    | "regions";
  focus?: string;
};

/** Pure ordering for the guided workflow. Labels are stable English fallbacks; the UI translates by id. */
export function nextStep(workspace: WorkspaceData, workflowView: DerivedWorkflow | null): NextStep {
  const dna =
    workflowView?.steps.filter((step) => step.id.startsWith("dna.")) ??
    WORKFLOW_STEPS.filter((step) => step.id.startsWith("dna.")).map((step) => ({
      ...step,
      status: "available" as const,
    }));
  const firstOpen = dna.find((step) => step.status !== "confirmed");
  if (firstOpen) {
    const module = firstOpen.moduleId as NextStep["module"];
    return {
      id: firstOpen.id,
      title: `Confirm ${firstOpen.id}`,
      action: "Confirm step",
      module,
      focus: firstOpen.id,
    };
  }

  const hasMaster = Boolean(workspace.project.activeMasterAssetId);
  if (!hasMaster) {
    return {
      id: "generate.master",
      title: "Create a Hero image and use it as Master",
      action: "Open Generate",
      module: "generate",
      focus: "create-master",
    };
  }
  const approved = ["master_approved", "anchor_generation", "production"].includes(
    workspace.project.status,
  );
  if (!approved) {
    return {
      id: "generate.master",
      title: "Approve the Master image",
      action: "Open Generate",
      module: "generate",
      focus: "approve-master",
    };
  }

  const anchorCameras = workspace.draftDna.cameras.filter((camera) => camera.isAnchorView);
  const approvedCameras = new Set(workspace.anchors.map((anchor) => anchor.cameraId));
  const missing = anchorCameras.filter((camera) => !approvedCameras.has(camera.id));
  if (missing.length) {
    return {
      id: "generate.anchors",
      title: "Create / approve Anchors",
      action: "Open Generate",
      module: "generate",
      focus: missing[0]?.id,
    };
  }

  const rendered = workspace.generations.some(
    (generation) =>
      generation.purpose === "production" &&
      generation.status === "completed" &&
      generation.outputAssetIds.length > 0,
  );
  if (!rendered) {
    return {
      id: "generate.render",
      title: "Render the camera views",
      action: "Open Generate",
      module: "generate",
    };
  }
  return {
    id: "post.grade",
    title: "Post: grade, enhance and QC",
    action: "Open Post-production",
    module: "mood_grade",
  };
}
