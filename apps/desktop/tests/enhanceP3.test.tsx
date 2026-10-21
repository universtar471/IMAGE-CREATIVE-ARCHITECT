/** SRS P3 (ADR-035): preservation modes, size targets, local check badge, batch retry. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectDNASchema, type EnhanceCheck } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { EnhancePanel } from "../src/features/enhance/EnhancePanel";
import { EnhanceBatchDialog } from "../src/features/enhance/EnhanceBatchDialog";
import { EnhanceCheckBadge } from "../src/features/enhance/EnhanceControls";
import {
  DEFAULT_ENHANCE_PARAMS,
  buildEnhanceRequest,
  enhanceCost,
  enhanceProviderChoice,
  enhanceTargetEdge,
  retryFailedItems,
  withPreservationMode,
  withSizeTarget,
} from "../src/features/enhance/enhance";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { t } from "../src/i18n";
import { vi as viDict } from "../src/i18n/vi";
import nhaphoDna from "./fixtures/nhapho-dna.json";
import { asset, confirmAllDna } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let sent: { command: string; request: unknown }[];

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  sent = [];
  const base = createMockTransport(db);
  const spy: Transport = async (command, args) => {
    sent.push({ command, request: args.request });
    return base(command, args);
  };
  spy.connectEvents = base.connectEvents;
  setTransport(spy);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    providers: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openApprovedProject() {
  const project = await createProject({
    name: "Enhance P3",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  db.dna[project.id] = ProjectDNASchema.parse(nhaphoDna);
  const masterId = `AST_MASTER_${project.id}`;
  db.assets[masterId] = asset(project.id, masterId, {
    role: "master_architecture",
    widthPx: 1500,
    heightPx: 1000,
  });
  db.assets[`AST_B_${project.id}`] = asset(project.id, `AST_B_${project.id}`, {
    widthPx: 5000,
    heightPx: 3000,
    originalName: "big.png",
  });
  await call("asset_set_master", { projectId: project.id, assetId: masterId });
  await confirmAllDna(project.id, { approveMaster: true });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  return { projectId: project.id, masterId, bigId: `AST_B_${project.id}` };
}

const submitted = () =>
  sent
    .filter((entry) => entry.command === "generation_submit" || entry.command === "batch_create")
    .map((entry) => entry.request as { providerId: string; params?: { enhance?: unknown } });

describe("enhance panel (ADR-035)", () => {
  it("strict mode calls only local_upscale, even after visiting a generative mode", async () => {
    await openApprovedProject();
    render(<EnhancePanel />);
    expect(screen.getByTestId("enhance-mode-strict").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: t("enhance.strictMode") })).toBeTruthy();
    // Visiting balanced offers paid providers; going back to strict must drop them again.
    fireEvent.click(screen.getByTestId("enhance-mode-balanced"));
    fireEvent.click(screen.getByTestId("enhance-mode-strict"));
    fireEvent.click(screen.getByTestId("enhance-size-uhd_3840x2160_contain"));
    expect(screen.getByTestId("enhance-size-summary").textContent).toContain("3240");
    const button = screen.getByTestId("enhance-submit") as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(submitted()).toHaveLength(1));
    const request = submitted()[0]!;
    expect(request.providerId).toBe("local_upscale");
    expect(request.params?.enhance).toMatchObject({
      mode: "conservative",
      preservationMode: "strict",
      upscale: { target: "uhd_3840x2160_contain", ifAlreadyLarger: "keep" },
    });
    expect(
      sent.some(
        (entry) =>
          entry.command === "generation_submit" &&
          entry.request &&
          (entry.request as { providerId: string }).providerId !== "local_upscale",
      ),
    ).toBe(false);
  });

  it("shows the lock toggles, all locked in strict and editable in balanced", async () => {
    await openApprovedProject();
    render(<EnhancePanel />);
    const geometry = screen.getByTestId("enhance-lock-geometry") as HTMLInputElement;
    expect(geometry.checked && geometry.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("enhance-mode-balanced"));
    const camera = screen.getByTestId("enhance-lock-camera") as HTMLInputElement;
    expect(camera.disabled).toBe(false);
    fireEvent.click(camera);
    expect((screen.getByTestId("enhance-lock-camera") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(t("enhance.allowedRegions"))).toBeTruthy();
  });
});

describe("enhance helpers (ADR-035)", () => {
  it("strict picks local_upscale whatever providers exist and refuses a paid provider", () => {
    expect(enhanceProviderChoice("strict", [])).toEqual({
      providerId: "local_upscale",
      modelId: "lanczos3",
    });
    const strict = withPreservationMode(
      withPreservationMode(DEFAULT_ENHANCE_PARAMS, "creative"),
      "strict",
    );
    expect(strict).toMatchObject({ mode: "conservative", preservationMode: "strict" });
    expect(() =>
      buildEnhanceRequest({
        projectId: "p",
        providerId: "hhtech",
        modelId: "gemini-3-pro-image",
        sourceAssetId: "a",
        params: strict,
      }),
    ).toThrow(/local_upscale/);
  });

  it("size targets keep the legacy target edge in sync and price UHD as 4K", () => {
    const uhd = withSizeTarget(DEFAULT_ENHANCE_PARAMS, "uhd_3840x2160_contain");
    expect(uhd.targetLongEdge).toBeNull();
    expect(enhanceTargetEdge(uhd, { widthPx: 1920, heightPx: 1080 })).toBe(3840);
    expect(enhanceCost("hhtech", { priceHint: { "4K": 900 } } as never, 3840, 2)).toMatchObject({
      kind: "priced",
      tier: "4K",
      amount: 1800,
    });
    const keep = withSizeTarget(withPreservationMode(uhd, "balanced"), null);
    expect(keep.upscale).toBeUndefined();
    expect(keep.targetLongEdge).toBeNull();
  });

  it("AC-13: a 20-item batch with 2 failures retries exactly the 2 failures", async () => {
    const jobs = Array.from({ length: 20 }, (_, index) => ({
      id: `JOB_${index}`,
      batchId: "BAT_1",
      status: index === 3 || index === 17 ? "failed" : "completed",
    }));
    const retry = vi.fn(async () => undefined);
    expect(await retryFailedItems(jobs, "BAT_1", retry)).toEqual(["JOB_3", "JOB_17"]);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(retry.mock.calls.map((args) => (args as unknown[])[0])).toEqual(["JOB_3", "JOB_17"]);
    expect(jobs.filter((job) => job.status === "completed")).toHaveLength(18);
  });
});

describe("enhance batch dialog (ADR-035)", () => {
  it("skips sources already larger than the target and has no mojibake", async () => {
    const { masterId, bigId } = await openApprovedProject();
    const sources = useStudio.getState().workspace!.assets;
    render(
      <EnhanceBatchDialog
        sources={sources}
        initialSelectedIds={[masterId, bigId]}
        initialParams={{
          ...DEFAULT_ENHANCE_PARAMS,
          upscale: { target: "long_edge_4096", ifAlreadyLarger: "skip" },
          targetLongEdge: 4096,
        }}
        onClose={() => undefined}
      />,
    );
    const dialog = screen.getByTestId("enhance-batch-dialog");
    expect(dialog.textContent).not.toMatch(/Ã|Â/);
    expect(dialog.textContent).toContain(t("enhance.batchSkipped", { count: 1 }));
    expect(screen.getByTestId("enhance-batch-cost").textContent).toBe(
      t("enhance.batchCostFree", { count: 1 }),
    );
  });

  it("shows 'Chưa xác định chi phí' for a generative batch without a price", async () => {
    const { masterId, bigId } = await openApprovedProject();
    const sources = useStudio.getState().workspace!.assets;
    render(
      <EnhanceBatchDialog
        sources={sources}
        initialSelectedIds={[masterId, bigId]}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId("enhance-mode-balanced"));
    await waitFor(() =>
      expect(screen.getByTestId("enhance-batch-cost").textContent).toBe(
        t("enhance.batchCostUnknown", { count: 2 }),
      ),
    );
    expect(viDict.enhance.costUnknown).toBe("Chưa xác định chi phí");
    expect(viDict.enhance.batchCostUnknown).toBe("{count} ảnh · chưa xác định chi phí");
  });
});

describe("enhance check badge", () => {
  const check: EnhanceCheck = {
    id: "ECK_1",
    version: "ec-1.0.0",
    preservationMode: "balanced",
    status: "warn",
    reasons: ["locked_ssim_low", "no_allowed_region"],
    expectedSize: { width: 4096, height: 2731 },
    actualSize: { width: 4096, height: 2731 },
    content: { x: 0, y: 0, width: 4096, height: 2731 },
    aspectDelta: 0,
    registration: { dx: 0, dy: 0, shiftPx: 0 },
    lockedSsim: 0.95,
    lockedPct: 40,
    edgeDelta: null,
    composited: true,
    sizeAction: "upscale",
  };

  it("shows 'Cần xem lại' with the reasons, or 'Đạt kiểm tra'", () => {
    const { rerender } = render(<EnhanceCheckBadge check={check} />);
    const badge = screen.getByTestId("enhance-check");
    expect(badge.textContent).toContain(t("enhance.checkWarn"));
    expect(viDict.enhance.checkWarn).toBe("Cần xem lại");
    expect(viDict.enhance.checkPass).toBe("Đạt kiểm tra");
    expect(badge.textContent).toContain(t("enhance.checkReason.locked_ssim_low"));
    expect(badge.textContent).toContain(t("enhance.checkReason.no_allowed_region"));
    rerender(<EnhanceCheckBadge check={{ ...check, status: "pass", reasons: [] }} />);
    expect(screen.getByTestId("enhance-check").textContent).toContain(t("enhance.checkPass"));
  });
});
