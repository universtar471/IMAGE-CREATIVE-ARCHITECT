/** Source-image analysis (ADR-040, UI-5) against the mock backend: no live call anywhere. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { SourceAnalysisCard, mergeExtraPrompt } from "../src/features/assist/SourceAnalysisCard";
import { call, setTransport, type BridgeError, type Transport } from "../src/lib/bridge";
import { createMockTransport, mockSourceAnalysis } from "../src/lib/mockBackend";
import { asset, confirmAllDna, waitFor } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let commands: Array<{ command: string; args: unknown }>;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  commands = [];
  const mock = createMockTransport(db, { generationDelayMs: 0 });
  const recording: Transport = (command, args) => {
    commands.push({ command, args });
    return mock(command, args);
  };
  setTransport(recording);
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
  vi.restoreAllMocks();
});

const assistCalls = () => commands.filter((c) => c.command === "dna_assist");

async function openProject() {
  const p = await createProject({
    name: "Source",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  const masterId = `AST_M_${p.id}`;
  db.assets[masterId] = asset(p.id, masterId, { role: "master_architecture" });
  await call("asset_set_master", { projectId: p.id, assetId: masterId });
  await confirmAllDna(p.id, { approveMaster: true });
  await call("provider_set_api_key", { providerId: "hhtech", apiKey: "k" });
  const sourceId = `AST_S_${p.id}`;
  db.assets[sourceId] = asset(p.id, sourceId, { role: "architecture_reference" });
  await useStudio.getState().openProject(p.id);
  return { project: p, sourceId };
}

describe("mock dna_assist mode source", () => {
  it("takes exactly one image of the project and answers a canned reply", async () => {
    const { project, sourceId } = await openProject();
    const request = (ids: string[]) => ({
      projectId: project.id,
      mode: "source" as const,
      scope: "building" as const,
      brief: "warmer",
      referenceAssetIds: ids,
      catalog: { scope: "building", fields: [] },
      systemPrompt: "source",
    });
    for (const ids of [[], [sourceId, sourceId]]) {
      const err = await call("dna_assist", request(ids)).catch((e: unknown) => e);
      expect((err as BridgeError).code).toBe("VALIDATION_ERROR");
    }
    const ok = await call("dna_assist", request([sourceId]));
    expect(JSON.parse(ok.raw)).toEqual(mockSourceAnalysis("building"));
  });
});

describe("SourceAnalysisCard", () => {
  it("calls nothing before the click and shows the spend confirmation first", async () => {
    const { sourceId } = await openProject();
    commands = [];
    render(<SourceAnalysisCard assetId={sourceId} wish="Ấm hơn, hoàng hôn" />);
    expect(assistCalls()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "AI reads the image" }));
    // The spend confirmation is open; still no call.
    const confirm = await screen.findByRole("button", { name: "Create images" });
    expect(assistCalls()).toHaveLength(0);
    fireEvent.click(confirm);
    await screen.findByText("Two-storey building seen from the front corner");
    expect(assistCalls()).toHaveLength(1);
    expect(assistCalls()[0]!.args).toMatchObject({
      request: {
        mode: "source",
        scope: "building",
        brief: "Ấm hơn, hoàng hôn",
        referenceAssetIds: [sourceId],
      },
    });

    // Observed and inferred items are listed apart.
    const observed = screen.getByRole("list", { name: "Seen in the image" });
    const inferred = screen.getByRole("list", { name: "Inferred" });
    expect(observed.textContent).toContain("Flat roof with deep overhangs");
    expect(observed.textContent).not.toContain("Rear terrace");
    expect(inferred.textContent).toContain("Rear terrace facing the garden");
    expect(inferred.textContent).toContain("40%");
  });

  it("cancelling the spend confirmation makes no call", async () => {
    const { sourceId } = await openProject();
    commands = [];
    render(<SourceAnalysisCard assetId={sourceId} wish="" />);
    fireEvent.click(screen.getByRole("button", { name: "AI reads the image" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await new Promise((r) => setTimeout(r, 10));
    expect(assistCalls()).toHaveLength(0);
  });

  it("is disabled without a source image", async () => {
    await openProject();
    render(<SourceAnalysisCard assetId={null} wish="warmer" />);
    const button = screen.getByRole("button", { name: "AI reads the image" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("applying writes the extra prompt and the DNA only through the diff", async () => {
    const { sourceId } = await openProject();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useStudio.getState().setGenerateDraft({ extraPrompt: "my own words" });
    render(<SourceAnalysisCard assetId={sourceId} wish="warmer" />);
    fireEvent.click(screen.getByRole("button", { name: "AI reads the image" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create images" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use this description" }));

    expect(useStudio.getState().generateDraft.extraPrompt).toBe(
      "my own words\n\nRender the same design at golden hour with warmer light.\n" +
        "Keep: massing; window layout; roof shape.",
    );
    // The DNA is untouched until the diff is applied.
    const style = () => useStudio.getState().workspace!.draftDna.building.architecturalStyle;
    const before = style();
    expect(screen.getByText("Deep overhangs and timber louvres.")).toBeTruthy();
    expect(style()).toBe(before);

    fireEvent.click(screen.getByRole("button", { name: "Apply 1 items" }));
    await waitFor(() => (style() === "modern tropical" ? true : null), "DNA applied");
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toBe("Written to the extra prompt.");
  });

  it("merges the extra prompt once", () => {
    expect(mergeExtraPrompt(undefined, " A ")).toBe("A");
    expect(mergeExtraPrompt("mine", "A")).toBe("mine\n\nA");
    expect(mergeExtraPrompt("mine\n\nA", "A")).toBe("mine\n\nA");
  });
});

describe("applying assist fields to the draft DNA", () => {
  it("normalises free-text list fields so the draft stays valid", async () => {
    await openProject();
    const { applyAssistToDraft } = await import("../src/lib/assist");
    const ok = applyAssistToDraft([
      { path: "building.materials", value: "white render, timber louvres" },
      { path: "building.specialFeatures", value: "roof garden" },
      { path: "context.vegetation", value: "tropical planting" },
    ] as never);
    expect(ok).toBe(true);
    const dna = useStudio.getState().workspace!.draftDna;
    expect(dna.building.materials).toEqual([
      { zone: "general", description: "white render, timber louvres" },
    ]);
    expect(dna.building.specialFeatures).toEqual(["roof garden"]);
    expect(useStudio.getState().save.status).not.toBe("invalid");
  });

  it("refuses a proposal the DNA schema rejects and leaves the draft unchanged", async () => {
    await openProject();
    const { applyAssistToDraft } = await import("../src/lib/assist");
    const before = useStudio.getState().workspace!.draftDna;
    const ok = applyAssistToDraft([{ path: "building.floors", value: "many" }] as never);
    expect(ok).toBe(false);
    expect(useStudio.getState().workspace!.draftDna).toBe(before);
  });
});
