import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GenerationDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { WorkspaceTopBar } from "../src/components/shell/WorkspaceTopBar";
import { GenerationResult } from "../src/features/generate/GenerationResult";
import { blockedReason } from "../src/features/workflow/blockedReason";
import { t } from "../src/i18n";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset, confirmAllDna, waitFor } from "./helpers";

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
    name: "Master approval",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  await confirmAllDna(project.id);
  await useStudio.getState().openProject(project.id);
  return project;
}

/** A completed hero generation whose only output is `assetId`, shown as the latest result. */
function showResult(projectId: string, assetId: string) {
  const generation = {
    id: "GEN_1",
    projectId,
    providerId: "local_preview",
    modelId: "local-preview",
    purpose: "hero",
    status: "completed",
    referenceAssetIds: [],
    outputAssetIds: [assetId],
    error: null,
    cameraId: null,
    batchId: null,
    jobId: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    durationMs: 1000,
  } as unknown as GenerationDTO;
  const ws = useStudio.getState().workspace!;
  useStudio.setState({ workspace: { ...ws, generations: [generation] } });
}

describe("master approval from Generate", () => {
  it("explains a Master block with the action to take, not the step id", () => {
    expect(blockedReason(t, "generate.master", false)).toBe(t("workflow.blockedNoMaster"));
    expect(blockedReason(t, "generate.master", true)).toBe(t("workflow.blockedMasterPending"));
    const other = blockedReason(t, "dna.context", false);
    expect(other).toContain(t("workflow.steps.dna.context.name"));
    expect(other).not.toContain("dna.context");
  });

  it("'Use as master' sets and approves the master in one click", async () => {
    const project = await openProject();
    db.assets.OUT = asset(project.id, "OUT", { source: "ai_generated" });
    await useStudio.getState().openProject(project.id);
    showResult(project.id, "OUT");
    render(createElement(GenerationResult));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("result.useAsMaster")) }));
    await waitFor(
      () => useStudio.getState().workspace!.project.status === "master_approved",
      "master approved",
    );
    expect(useStudio.getState().workspace!.project.activeMasterAssetId).toBe("OUT");
  });

  it("offers 'Approve master' when the master was set but not approved", async () => {
    const project = await openProject();
    db.assets.OUT = asset(project.id, "OUT", { role: "master_architecture" });
    await call("asset_set_master", { projectId: project.id, assetId: "OUT" });
    await useStudio.getState().openProject(project.id);
    expect(useStudio.getState().workspace!.project.status).toBe("master_pending");
    showResult(project.id, "OUT");
    render(createElement(GenerationResult));

    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("overview.approve")) }));
    await waitFor(
      () => useStudio.getState().workspace!.project.status === "master_approved",
      "master approved",
    );
  });

  it("the pending badge in the top bar opens Overview", async () => {
    const project = await openProject();
    db.assets.OUT = asset(project.id, "OUT", { role: "master_architecture" });
    await call("asset_set_master", { projectId: project.id, assetId: "OUT" });
    await useStudio.getState().openProject(project.id);
    useStudio.getState().setModule("generate");
    render(createElement(WorkspaceTopBar));

    fireEvent.click(screen.getByTitle(t("workflow.goApproveMaster")));
    expect(useStudio.getState().activeModule).toBe("overview");
  });
});
