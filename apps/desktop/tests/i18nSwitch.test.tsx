/** The VI | EN switch on real screens: text changes instantly and the choice survives a remount. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { GenerationDTO } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { WorkspaceTopBar } from "../src/components/shell/WorkspaceTopBar";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { GenerationResult } from "../src/features/generate/GenerationResult";
import { JobsTab } from "../src/features/jobs/JobsTab";
import { ProjectHub } from "../src/features/projects/ProjectHub";
import { ProviderSettingsDialog } from "../src/features/providers/ProviderSettingsDialog";
import { LOCALE_STORAGE_KEY, reloadLocale, useLocale, type Locale } from "../src/i18n";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

beforeEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
  setTransport(
    createMockTransport(
      { projects: {}, dna: {}, assets: {}, versions: [] },
      { generationDelayMs: 0 },
    ),
  );
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    providers: null,
    providersError: null,
    providerDialog: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

/** Click the VI or EN button of the (first) language switch on screen. */
const switchTo = (l: Locale) =>
  fireEvent.click(
    within(screen.getAllByTestId("locale-switch")[0]!).getByRole("button", {
      name: l.toUpperCase(),
    }),
  );

async function openProject() {
  const p = await createProject({
    name: "Villa Thảo Điền",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(p.id);
  await useStudio.getState().loadProviders();
  return p;
}

describe("language switch", () => {
  it("switches the workspace top bar instantly, both ways", async () => {
    await openProject();
    render(<WorkspaceTopBar />);
    expect(screen.getByRole("button", { name: /Projects/ })).toBeTruthy();
    expect(screen.getByText("Queue idle")).toBeTruthy();
    expect(screen.getByText(/Villa · Tropical villa/)).toBeTruthy();

    switchTo("vi");
    expect(useLocale.getState().locale).toBe("vi");
    expect(screen.getByRole("button", { name: /Dự án/ })).toBeTruthy();
    expect(screen.getByText("Hàng đợi trống")).toBeTruthy();
    expect(screen.getByText(/Biệt thự · Biệt thự nhiệt đới/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Lưu trữ/ })).toBeTruthy();
    expect(screen.queryByText("Queue idle")).toBeNull();

    switchTo("en");
    expect(screen.getByText("Queue idle")).toBeTruthy();
  });

  it("translates the Generate panel but leaves the compiled prompt in English", async () => {
    await openProject();
    render(<GeneratePanel />);
    expect(screen.getByTestId("generate-button").textContent).toMatch(/Generate/);

    act(() => useLocale.getState().setLocale("vi"));
    expect(screen.getByTestId("generate-button").textContent).toMatch(/Tạo (ảnh Hero|biến thể)/);
    expect(screen.getByText("Nhà cung cấp", { selector: "summary" })).toBeTruthy();
    expect(screen.getByText("Prompt đã biên dịch")).toBeTruthy();
    expect(screen.getByText("Prompt bổ sung")).toBeTruthy();

    // The prompt that is sent stays English.
    fireEvent.click(screen.getByText("Prompt đã biên dịch"));
    const prompt = await screen.findByTestId("generate-prompt");
    expect(prompt.querySelector("pre")?.textContent).toMatch(/villa/i);
    expect(prompt.querySelector("pre")?.getAttribute("lang")).toBe("en");
    expect(prompt.textContent).toMatch(/tiếng Anh/);
  });

  it("translates the Jobs tray", async () => {
    await openProject();
    useLocale.getState().setLocale("vi");
    render(<JobsTab />);
    expect(screen.getByRole("button", { name: "Dự án này" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mọi dự án" })).toBeTruthy();
    expect(screen.getByText("Không có tác vụ")).toBeTruthy();
  });

  it("translates the provider dialog, including the key help", async () => {
    useLocale.getState().setLocale("vi");
    useStudio.getState().openProviderDialog("openai");
    render(<ProviderSettingsDialog />);
    await screen.findByLabelText("API key OpenAI (GPT Image)");
    expect(screen.getByRole("dialog", { name: "Nhà cung cấp ảnh" })).toBeTruthy();
    const help = screen.getByRole("list", { name: "Hướng dẫn lấy key OpenAI (GPT Image)" });
    expect(help.textContent).toMatch(/Lấy key tại/);
    expect(help.textContent).toMatch(/tính phí theo lượt dùng/);
    expect(help.textContent).toMatch(/platform\.openai\.com\/settings\/organization\/billing/);
  });

  it("shows a Vietnamese headline above the original provider error", async () => {
    const p = await openProject();
    const failed: GenerationDTO = {
      id: "GEN_1",
      projectId: p.id,
      providerId: "gemini",
      modelId: "m",
      purpose: "hero",
      status: "failed",
      prompt: {
        compilerVersion: "1",
        positivePrompt: "x",
        negativePrompt: "",
        referenceInstructions: "",
        preservationInstructions: "",
        metadata: {},
      },
      referenceAssetIds: [],
      params: { aspectRatio: null, imageSize: null, outputCount: 1, seed: null, quality: null },
      parentAssetId: null,
      outputAssetIds: [],
      error: { kind: "timeout", message: "Gateway timeout after 120 s.", retryable: true },
      cameraId: null,
      batchId: null,
      jobId: null,
      createdAt: "2026-10-09T00:00:00Z",
      startedAt: "2026-10-09T00:00:00Z",
      finishedAt: "2026-10-09T00:02:00Z",
      durationMs: 120000,
    };
    const ws = useStudio.getState().workspace!;
    useStudio.setState({ workspace: { ...ws, generations: [failed] } });
    useLocale.getState().setLocale("vi");
    render(<GenerationResult />);
    const error = screen.getByTestId("error-message");
    expect(within(error).getByText("Hết thời gian chờ")).toBeTruthy();
    expect(within(error).getByText("Gateway timeout after 120 s.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thử lại/ })).toBeTruthy();

    act(() => useLocale.getState().setLocale("en"));
    expect(within(screen.getByTestId("error-message")).getByText("Timed out")).toBeTruthy();
  });
});

describe("language persistence", () => {
  it("starts in Vietnamese on first run", async () => {
    reloadLocale();
    render(<ProjectHub />);
    expect(await screen.findByRole("button", { name: /Dự án mới/ })).toBeTruthy();
    expect(useLocale.getState().locale).toBe("vi");
  });

  it("keeps the chosen language through a remount (app restart)", async () => {
    reloadLocale();
    const first = render(<ProjectHub />);
    await screen.findByRole("button", { name: /Dự án mới/ });
    switchTo("en");
    expect(screen.getByRole("button", { name: /New Project/ })).toBeTruthy();
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    first.unmount();

    // A fresh start reads the stored choice.
    useLocale.setState({ locale: "vi" });
    reloadLocale();
    render(<ProjectHub />);
    expect(await screen.findByRole("button", { name: /New Project/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Dự án mới/ })).toBeNull();
  });
});
