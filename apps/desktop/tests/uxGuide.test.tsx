import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceData } from "../src/app/store";
import { useStudio } from "../src/app/store";
import { SpendConfirmHarness } from "./uxGuideHarness";
import { nextStep } from "../src/lib/nextStep";
import { nextStepBarMode } from "../src/features/workflow/NextStepBar";
import { BlockedExplainer } from "../src/features/workflow/BlockedExplainer";
import { deriveWorkflow, WORKFLOW_STEPS } from "../src/lib/workflow";
import { en } from "../src/i18n/en";
import { vi as viDict } from "../src/i18n/vi";

const paidSubmitSources = import.meta.glob<string>(
  [
    "../src/features/generate/GenerationResult.tsx",
    "../src/features/history/HistoryTab.tsx",
    "../src/features/camera/ContactSheet.tsx",
    "../src/features/jobs/JobsTab.tsx",
    "../src/features/regions/RegionPanel.tsx",
  ],
  { eager: true, query: "?raw", import: "default" },
);

const project = {
  id: "P",
  name: "P",
  projectType: "villa",
  subtype: null,
  status: "draft",
  activeMasterAssetId: null,
  archivedAt: null,
  createdAt: "now",
  updatedAt: "now",
} as WorkspaceData["project"];

function workspace(over: Partial<WorkspaceData> = {}): WorkspaceData {
  const dna = { cameras: [] } as unknown as WorkspaceData["draftDna"];
  return {
    project,
    persistedDna: dna,
    draftDna: dna,
    assets: [],
    generations: [],
    anchors: [],
    batches: [],
    workflow: { steps: [] },
    ...over,
  };
}

const facts = {
  masterApproved: false,
  anchorCameraIds: [],
  approvedAnchorCameraIds: [],
  cameraIds: [],
};
const confirmed = WORKFLOW_STEPS.filter((step) => step.id.startsWith("dna.")).map((step) => ({
  stepId: step.id as `dna.${string}`,
  status: "confirmed" as const,
  confirmedAt: "now",
}));

describe("next-step guidance", () => {
  it("uses the required order for every branch", () => {
    const open = deriveWorkflow([], facts);
    expect(nextStep(workspace(), open).id).toBe("dna.building");
    const ready = deriveWorkflow(confirmed as never, facts);
    expect(nextStep(workspace(), ready).id).toBe("generate.master");
    const pending = workspace({ project: { ...project, activeMasterAssetId: "M" } });
    expect(nextStep(pending, ready).title).toContain("Approve");
    const cam = { id: "CAM", name: "Front", isAnchorView: true } as never;
    const anchors = workspace({
      project: { ...project, activeMasterAssetId: "M", status: "master_approved" },
      draftDna: { cameras: [cam] } as never,
    });
    expect(nextStep(anchors, ready).id).toBe("generate.anchors");
    const render = workspace({
      ...anchors,
      anchors: [{ projectId: "P", cameraId: "CAM", assetId: "A", approvedAt: "now" }],
    });
    expect(nextStep(render, ready).id).toBe("generate.render");
    const post = workspace({
      ...render,
      generations: [{ purpose: "production", status: "completed", outputAssetIds: ["O"] }] as never,
    });
    expect(nextStep(post, ready).id).toBe("post.grade");
  });

  it("hides Export, shows a hint on target, and a bar elsewhere", () => {
    expect(nextStepBarMode("export", "generate")).toBe("hidden");
    expect(nextStepBarMode("generate", "generate")).toBe("hint");
    expect(nextStepBarMode("camera", "generate")).toBe("bar");
    expect(nextStepBarMode("regions", "generate")).toBe("bar");
  });
});

describe("spend confirmation", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows paid providers, skips local providers, and cancel does not submit", async () => {
    const submit = vi.fn();
    render(<SpendConfirmHarness provider="hhtech" submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    expect(await screen.findByRole("dialog", { name: en.spend.title })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: en.common.cancel }));
    expect(submit).not.toHaveBeenCalled();
    cleanup();
    render(<SpendConfirmHarness provider="local_preview" submit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    await Promise.resolve();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("remembers the threshold preference", async () => {
    render(<SpendConfirmHarness provider="hhtech" submit={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "run" }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(screen.getByLabelText(en.spend.threshold), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: en.spend.create }));
    expect(localStorage.getItem("arch.spendConfirmThreshold")).toBe("5000");
  });

  it.each([
    "../src/features/generate/GenerationResult.tsx",
    "../src/features/history/HistoryTab.tsx",
    "../src/features/camera/ContactSheet.tsx",
    "../src/features/jobs/JobsTab.tsx",
  ])("keeps the paid retry in %s behind the shared confirmation", (file) => {
    const source = paidSubmitSources[file]!;
    expect(source).toContain("useSpendConfirm");
    expect(source).toContain("spendRequestForGeneration");
    expect(source).toMatch(/await spend\.request/);
  });

  it("keeps region edit submission behind the shared confirmation", () => {
    const regionSource = paidSubmitSources["../src/features/regions/RegionPanel.tsx"]!;
    expect(regionSource).toContain("useSpendConfirm");
    expect(regionSource.indexOf("await spend.request")).toBeLessThan(
      regionSource.indexOf('call("generation_submit"'),
    );
  });
});

describe("blocking explanations", () => {
  afterEach(cleanup);
  it("renders an explainer for every workflow step id", () => {
    useStudio.setState({ activeModule: "overview" });
    for (const step of WORKFLOW_STEPS) {
      const { unmount } = render(<BlockedExplainer stepId={step.id} />);
      expect(screen.getByTestId(`blocked-explainer-${step.id}`)).toBeTruthy();
      unmount();
    }
  });

  it("keeps new dictionaries in parity and Vietnamese accented", () => {
    expect(Object.keys(viDict.nextStep.steps)).toEqual(Object.keys(en.nextStep.steps));
    expect(Object.keys(viDict.workflow.explain)).toEqual(Object.keys(en.workflow.explain));
    expect(Object.values(viDict.workflow.explain).join(" ")).toMatch(/[À-ỹ]/);
    expect(viDict.spend.title).toBe("Xác nhận chi phí");
  });
});
