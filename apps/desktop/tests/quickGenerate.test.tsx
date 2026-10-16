/** ADR-040 UI-3: the quick-generate screen fills the Generate draft and shares its submit path. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProjectDNASchema, type ModelCapabilities } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { QuickGenerateView } from "../src/features/generate/quick";
import {
  availableQuickSources,
  faithfulnessReferenceIds,
  initialQuickChoice,
  quickDraft,
} from "../src/features/generate/quick/quickDraft";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { t } from "../src/i18n";
import nhaphoDna from "./fixtures/nhapho-dna.json";
import { asset, confirmAllDna } from "./helpers";
import type * as FileHelpers from "../src/lib/files";

vi.mock("../src/lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof FileHelpers>()),
  pickImages: vi.fn(async () => ["mock://source.png"]),
}));

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let imports: string[];
let submits: number;
const realSubmitGeneration = useStudio.getState().submitGeneration;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  imports = [];
  submits = 0;
  const base = createMockTransport(db);
  const transport: Transport = async (command, args) => {
    if (command === "provider_list") {
      const providers = (await base(command, args)) as Array<{ id: string; configured: boolean }>;
      return providers.map((p) => (p.id === "hhtech" ? { ...p, configured: true } : p));
    }
    if (command === "asset_import") {
      const request = args.request as { projectId: string; role: string };
      imports.push(request.role);
      const imported = asset(request.projectId, `AST_IMPORTED_${imports.length}`, {
        role: request.role as never,
        originalName: "source.png",
        createdAt: "2026-02-01T00:00:00Z",
      });
      db.assets[imported.id] = imported;
      return imported;
    }
    if (command === "generation_submit") submits++;
    return base(command, args);
  };
  setTransport(transport);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    run: null,
    jobs: [],
    providers: null,
    providersError: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    submitGeneration: realSubmitGeneration,
  });
  try {
    localStorage.clear();
  } catch {
    // jsdom storage always exists; keep the guard for parity with the app.
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTransport(null);
});

async function openProject(options: { midBlock?: boolean; master?: boolean } = {}) {
  const project = await createProject({
    name: "Quick",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  if (options.midBlock) {
    const dna = ProjectDNASchema.parse(nhaphoDna);
    dna.context.siteTopology = { left: "attached", right: "attached", cornerLot: false };
    db.dna[project.id] = dna;
  }
  if (options.master) {
    const masterId = `AST_MASTER_${project.id}`;
    db.assets[masterId] = asset(project.id, masterId, { role: "master_architecture" });
    db.assets.AST_MAT = asset(project.id, "AST_MAT", { role: "material_reference" });
    db.assets.AST_ARCH = asset(project.id, "AST_ARCH", { role: "architecture_reference" });
    await call("asset_set_master", { projectId: project.id, assetId: masterId });
    await confirmAllDna(project.id, { approveMaster: true });
  }
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  return project.id;
}

const useHhtech = () =>
  useStudio.getState().setGenerateDraft({ providerId: "hhtech", modelId: null, params: null });

describe("quick generate screen", () => {
  it("shows an empty drop zone that names the next step", async () => {
    await openProject();
    render(<QuickGenerateView />);
    const zone = screen.getByTestId("quick-dropzone");
    expect(zone.textContent).toContain(t("quick.empty.existing.title"));
    expect(zone.textContent).toContain(t("quick.empty.existing.step"));
    expect(screen.getByText(t("quick.reasonNoSource"))).toBeTruthy();
  });

  it("imports an existing image as the master architecture role and shows it large", async () => {
    await openProject();
    render(<QuickGenerateView />);
    fireEvent.click(screen.getByTestId("quick-dropzone"));
    await waitFor(() => expect(imports).toEqual(["master_architecture"]));
    expect(await screen.findByTestId("quick-stage-image")).toBeTruthy();
    expect(screen.queryByText(t("quick.reasonNoSource"))).toBeNull();
  });

  it("maps From sketch to the structure_sketch role and the panel's sketch source", async () => {
    await openProject();
    render(<QuickGenerateView />);
    fireEvent.click(screen.getByTestId("quick-source-sketch"));
    expect(screen.getByTestId("quick-dropzone").textContent).toContain(
      t("quick.empty.sketch.title"),
    );
    fireEvent.click(screen.getByTestId("quick-dropzone"));
    await waitFor(() => expect(imports).toEqual(["structure_sketch"]));
    expect(await screen.findByTestId("quick-stage-image")).toBeTruthy();
    fireEvent.click(screen.getByTestId("quick-open-full"));
    const draft = useStudio.getState().generateDraft;
    expect(draft).toMatchObject({ source: "sketch", purpose: "hero" });
    expect(draft.referenceAssetIds?.[0]).toBe("AST_IMPORTED_1");
    // The full Generate panel takes over the request column with the same draft.
    expect(screen.getByTestId("generate-button")).toBeTruthy();
  });

  it("From description has no source image and no faithfulness control", async () => {
    await openProject({ master: true });
    render(<QuickGenerateView />);
    expect(screen.getByTestId("quick-faith-balanced")).toBeTruthy();
    fireEvent.click(screen.getByTestId("quick-source-text"));
    expect(screen.getByTestId("quick-stage-text")).toBeTruthy();
    expect(screen.queryByTestId("quick-faith-balanced")).toBeNull();
    expect(screen.queryByTestId("quick-dropzone")).toBeNull();
  });

  it("starts on a given library asset and renders the analysis slot with it", async () => {
    const projectId = await openProject({ master: true });
    const slot = vi.fn(({ asset: a, wish }: { asset: { id: string } | null; wish: string }) => (
      <div data-testid="analysis-slot">{`${a?.id}|${wish}`}</div>
    ));
    render(
      <QuickGenerateView initialSourceAssetId={`AST_MASTER_${projectId}`} analysisSlot={slot} />,
    );
    fireEvent.change(screen.getByTestId("quick-wish"), { target: { value: "more trees" } });
    expect(screen.getByTestId("analysis-slot").textContent).toBe(
      `AST_MASTER_${projectId}|more trees`,
    );
  });

  it("puts the wish in the Generate draft's extra prompt", async () => {
    await openProject();
    render(<QuickGenerateView />);
    fireEvent.change(screen.getByTestId("quick-wish"), {
      target: { value: "warm afternoon light" },
    });
    expect(useStudio.getState().generateDraft.extraPrompt).toBe("warm afternoon light");
  });

  it("defaults to one test image", async () => {
    await openProject({ master: true });
    render(<QuickGenerateView />);
    expect(screen.getByTestId("quick-count-1").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("quick-plan"));
    const dialog = screen.getByRole("dialog", { name: t("quick.planTitle") });
    expect(within(dialog).getByTestId("plan-summary").textContent).toContain(
      t("quick.planWhatValue", { count: 1 }),
    );
  });

  it("the plan dialog shows the cost estimate", async () => {
    await openProject({ master: true });
    useHhtech();
    render(<QuickGenerateView />);
    fireEvent.click(screen.getByTestId("quick-plan"));
    const cost = screen.getByTestId("plan-cost").textContent ?? "";
    expect(cost).not.toBe(t("spend.unknown"));
    expect(cost).toMatch(/\d/);
  });

  it("the plan dialog blocks on BLOCK and offers only Fix", async () => {
    await openProject({ midBlock: true, master: true });
    render(<QuickGenerateView />);
    fireEvent.change(screen.getByTestId("quick-wish"), {
      target: { value: "mở mặt hông bên trái" },
    });
    fireEvent.click(screen.getByTestId("quick-plan"));
    const dialog = screen.getByRole("dialog", { name: t("quick.planTitle") });
    expect(within(dialog).getByTestId("conflict-panel").textContent).toContain(
      t("conflicts.ADJACENT_BUILDING_CONFLICT"),
    );
    expect(within(dialog).queryByTestId("conflict-approve")).toBeNull();
    expect((within(dialog).getByTestId("plan-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByTestId("plan-disabled-reason").textContent).toContain(
      t("conflictUi.refusedBlock"),
    );
    expect(submits).toBe(0);
  });

  it("a WARN asks for approval before the plan can be confirmed", async () => {
    await openProject({ midBlock: true, master: true });
    render(<QuickGenerateView />);
    fireEvent.change(screen.getByTestId("quick-wish"), { target: { value: "exactly 5 m wide" } });
    fireEvent.click(screen.getByTestId("quick-plan"));
    const dialog = screen.getByRole("dialog", { name: t("quick.planTitle") });
    const confirm = within(dialog).getByTestId("plan-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId("conflict-approve"));
    expect(useStudio.getState().generateDraft.approvedExceptions).toEqual(["UNVERIFIED_GEOMETRY"]);
    expect(confirm.disabled).toBe(false);
  });

  it("submits through the same spend confirmation and service as the Generate panel", async () => {
    await openProject({ master: true });
    useHhtech();
    useStudio.getState().setGenerateDraft({ extraPrompt: "more trees" });
    const spy = vi.fn(async () => undefined);
    useStudio.setState({ submitGeneration: spy });

    // The Generate panel with the same draft (DNA source, default references).
    const panel = render(<GeneratePanel />);
    fireEvent.click(screen.getByTestId("generate-button"));
    fireEvent.click(await screen.findByRole("button", { name: t("spend.create") }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    panel.unmount();

    render(<QuickGenerateView />);
    fireEvent.click(screen.getByTestId("quick-source-text"));
    fireEvent.click(screen.getByTestId("quick-plan"));
    fireEvent.click(screen.getByTestId("plan-confirm"));
    expect(spy).toHaveBeenCalledTimes(1); // nothing is sent before the spend confirmation
    expect(await screen.findByRole("dialog", { name: t("spend.title") })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("spend.create") }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    const calls = spy.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls[1]![0]).toEqual(calls[0]![0]);
    expect(calls[1]![0]).toMatchObject({ providerId: "hhtech", extraPrompt: "more trees" });
  });

  it("a confirmed quick plan reaches generation_submit", async () => {
    await openProject({ master: true });
    useStudio.getState().setGenerateDraft({ providerId: "local_preview" });
    render(<QuickGenerateView />);
    fireEvent.click(screen.getByTestId("quick-plan"));
    fireEvent.click(screen.getByTestId("plan-confirm"));
    // The offline local provider needs no spend confirmation.
    await waitFor(() => expect(submits).toBe(1));
  });
});

describe("quick generate mapping", () => {
  const model = (over: Partial<ModelCapabilities> = {}): ModelCapabilities => ({
    id: "m",
    label: "Model M",
    textToImage: true,
    imageToImage: true,
    maxReferenceImages: 4,
    maxOutputs: 4,
    aspectRatios: [],
    imageSizes: [],
    supportsNegativePrompt: false,
    supportsSeed: false,
    qualityOptions: [],
    priceHint: null,
    ...over,
  });
  const assets = [
    asset("P", "M1", { role: "master_architecture" }),
    asset("P", "S1", { role: "structure_sketch" }),
    asset("P", "A1", { role: "architecture_reference" }),
    asset("P", "L1", { role: "lighting_reference" }),
    asset("P", "T1", { role: "material_reference" }),
  ];

  it("hides the image sources for a text-only model", () => {
    expect(availableQuickSources(model())).toEqual(["existing", "sketch", "text"]);
    expect(availableQuickSources(model({ imageToImage: false }))).toEqual(["text"]);
    expect(availableQuickSources(null)).toEqual(["text"]);
    expect(
      initialQuickChoice(EMPTY_GENERATE_DRAFT, model({ imageToImage: false }), assets).source,
    ).toBe("text");
  });

  it("faithfulness widens the references sent next to the source", () => {
    expect(faithfulnessReferenceIds("M1", "keep", assets, 4)).toEqual(["M1"]);
    expect(faithfulnessReferenceIds("M1", "balanced", assets, 4)).toEqual(["M1", "T1", "L1"]);
    expect(faithfulnessReferenceIds("M1", "creative", assets, 4)).toEqual(["M1", "A1", "T1", "L1"]);
    expect(faithfulnessReferenceIds("M1", "creative", assets, 2)).toEqual(["M1", "A1"]);
  });

  it("maps each source onto the existing draft", () => {
    const base = { ...EMPTY_GENERATE_DRAFT, extraPrompt: "wish", purpose: "variation" as const };
    const choice = { sourceAssetId: null, faithfulness: "keep" as const };
    expect(quickDraft(base, { ...choice, source: "existing" }, assets, "M1", model())).toEqual({
      ...base,
      source: "dna",
      purpose: "hero",
      referenceAssetIds: ["M1"],
    });
    expect(quickDraft(base, { ...choice, source: "sketch" }, assets, "M1", model())).toMatchObject({
      source: "sketch",
      purpose: "hero",
      referenceAssetIds: ["S1"],
      extraPrompt: "wish",
    });
    expect(quickDraft(base, { ...choice, source: "text" }, assets, "M1", model())).toMatchObject({
      source: "dna",
      purpose: "hero",
      referenceAssetIds: null,
    });
  });
});
