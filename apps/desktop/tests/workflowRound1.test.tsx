import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blankCamera, newCameraId } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { CameraDirector } from "../src/features/camera/CameraDirector";
import { CameraPanel } from "../src/features/camera/CameraPanel";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { OverviewPanel } from "../src/features/overview/OverviewPanel";
import { StepFrame, laterStepsToReview } from "../src/features/workflow/StepFrame";
import { WorkspaceNav } from "../src/components/shell/WorkspaceNav";
import { PropertyPanel } from "../src/components/panels/PropertyPanel";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { deriveWorkflow } from "../src/lib/workflow";
import { asset, confirmAllDna } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});

afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openProject() {
  const project = await createProject({
    name: "Workflow UI",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

describe("round 1 workflow UI regressions", () => {
  it("locks generation after reopening DNA even when the master was approved", async () => {
    const project = await openProject();
    const master = asset(project.id, "MASTER", { role: "master_architecture" });
    db.assets.MASTER = master;
    await call("asset_set_master", { projectId: project.id, assetId: master.id });
    await confirmAllDna(project.id, { approveMaster: true });
    await useStudio.getState().openProject(project.id);
    await call("workflow_reopen_step", { projectId: project.id, stepId: "dna.context" });
    await useStudio.getState().refreshWorkflow();
    const locked = useStudio.getState().workflowView!;
    expect(locked.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "generate.master",
          status: "locked",
          blockedBy: "dna.context",
        }),
        expect.objectContaining({
          id: "generate.anchors",
          status: "locked",
          blockedBy: "dna.context",
        }),
        expect.objectContaining({
          id: "generate.render",
          status: "locked",
          blockedBy: "dna.context",
        }),
      ]),
    );
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.context" });
    await call("workflow_reopen_step", { projectId: project.id, stepId: "dna.references" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.references" });
    await call("workflow_reopen_step", { projectId: project.id, stepId: "dna.camera" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.camera" });
    await call("workflow_reopen_step", { projectId: project.id, stepId: "dna.lighting" });
    await call("workflow_confirm_step", { projectId: project.id, stepId: "dna.lighting" });
    await useStudio.getState().refreshWorkflow();
    expect(useStudio.getState().workflowView?.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "generate.master", status: "done" })]),
    );
  });
  it("does not move a camera in the director when dna.camera is confirmed", async () => {
    await openProject();
    const ws = useStudio.getState().workspace!;
    const camera = {
      ...ws.draftDna.cameras[0],
      id: "CAM_01ARZ3NDEKTSV4RRFFQ69G5FAV",
      name: "Front",
      azimuthDeg: 0,
      distanceM: 10,
    };
    const before = camera.azimuthDeg;
    useStudio.getState().editDna("cameras", [camera]);
    useStudio.setState({
      workflowView: deriveWorkflow(
        [{ stepId: "dna.camera", status: "confirmed", confirmedAt: "now" }],
        {
          masterApproved: false,
          anchorCameraIds: [],
          approvedAnchorCameraIds: [],
          cameraIds: [camera.id],
        },
      ),
    });
    render(createElement(CameraDirector));
    fireEvent.keyDown(screen.getByTestId("director-camera"), { key: "ArrowRight" });
    expect(useStudio.getState().workspace!.draftDna.cameras[0]!.azimuthDeg).toBe(before);
  });

  it("keeps anchor/render actions in Generate, not the camera DNA panel", async () => {
    await openProject();
    render(createElement(CameraPanel));
    expect(screen.queryByTestId("generate-anchors")).toBeNull();
    cleanup();
    await useStudio.getState().loadProviders();
    render(createElement(GeneratePanel));
    expect(screen.getByTestId("generate-anchors")).toBeTruthy();
    expect(screen.getByTestId("render-cameras")).toBeTruthy();
  });

  it("computes reopen impact from confirmed later steps before reopening", () => {
    const workflow = deriveWorkflow(
      [
        { stepId: "dna.building", status: "confirmed", confirmedAt: "now" },
        { stepId: "dna.context", status: "confirmed", confirmedAt: "now" },
        { stepId: "dna.references", status: "confirmed", confirmedAt: "now" },
        { stepId: "dna.camera", status: "confirmed", confirmedAt: "now" },
      ],
      { masterApproved: false, anchorCameraIds: [], approvedAnchorCameraIds: [], cameraIds: [] },
    );
    expect(laterStepsToReview(workflow, "dna.context").map((step) => step.id)).toEqual([
      "dna.references",
      "dna.camera",
    ]);
  });

  it("derives non-anchor cameras on project open and every workflow refresh", async () => {
    const project = await createProject({
      name: "Non-anchor render",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const camera = { ...blankCamera(), id: newCameraId(), name: "Production", isAnchorView: false };
    await call("dna_update", {
      projectId: project.id,
      dna: { ...db.dna[project.id]!, cameras: [camera] },
    });
    db.assets.MASTER = asset(project.id, "MASTER", { role: "master_architecture" });
    await call("asset_set_master", { projectId: project.id, assetId: "MASTER" });
    await confirmAllDna(project.id, { approveMaster: true });

    await useStudio.getState().openProject(project.id);
    expect(
      useStudio.getState().workflowView?.steps.find((step) => step.id === "generate.render")
        ?.status,
    ).toBe("available");
    useStudio.getState().editDna("cameras", []);
    await useStudio.getState().refreshWorkflow();
    expect(
      useStudio.getState().workflowView?.steps.find((step) => step.id === "generate.render")
        ?.status,
    ).toBe("skipped");
    useStudio.getState().editDna("cameras", [camera]);
    await useStudio.getState().refreshWorkflow();
    expect(
      useStudio.getState().workflowView?.steps.find((step) => step.id === "generate.render")
        ?.status,
    ).toBe("available");
  });

  it("shows real DNA summaries and quick edits only for available steps", async () => {
    await openProject();
    useStudio.getState().editDna("building.buildingType", "Villa");
    render(createElement(OverviewPanel));
    expect(screen.getAllByText(/Villa/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByText("Building")[0]!);
    expect((screen.getByLabelText("Building type") as HTMLInputElement).disabled).toBe(false);
  });

  it("renders visible DNA and post group headers", async () => {
    await openProject();
    useStudio.setState({ activeModule: "overview" });
    render(createElement(WorkspaceNav));
    expect(screen.getByText("Design DNA")).toBeTruthy();
    expect(screen.getByText("Architecture")).toBeTruthy();
    expect(screen.getByText("Post-production")).toBeTruthy();
  });

  it("uses Architecture for the first DNA step and resets the property scroll on module change", async () => {
    await openProject();
    useStudio.setState({ activeModule: "design_dna" });
    render(createElement(WorkspaceNav));
    expect(screen.getByText("Architecture")).toBeTruthy();
    cleanup();
    render(createElement(PropertyPanel));
    const body = document.querySelector(".panel-body") as HTMLElement;
    body.scrollTop = 240;
    useStudio.getState().setModule("context");
    await Promise.resolve();
    expect(body.scrollTop).toBe(0);
  });
});

describe("StepFrame impact helper", () => {
  it("is available for the reopen dialog to list confirmed later steps", () => {
    expect(typeof StepFrame).toBe("function");
  });
});
