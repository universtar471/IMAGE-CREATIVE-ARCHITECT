import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport, MOCK_INBOX_PATH } from "../src/lib/mockBackend";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  localStorage.removeItem("arch.generateMode");
  db = {
    projects: {},
    dna: {},
    assets: {},
    versions: [],
    sketchupInbox: [
      {
        fileName: "nha_Front.png",
        fingerprint: "front",
        scene: "Front",
        width: 2048,
        height: 1152,
      },
      { fileName: "nha_Street.png", fingerprint: "street", scene: "Street", model: "C:/p/nha.skp" },
    ],
  };
  const base = createMockTransport(db);
  const transport: Transport = async (command, args) => base(command, args);
  setTransport(transport);
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    providers: null,
    providersError: null,
    run: null,
    jobs: [],
    generateDraft: EMPTY_GENERATE_DRAFT,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setTransport(null);
});

async function openPanel() {
  const project = await createProject({
    name: "M2",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  render(<GeneratePanel />);
  return project;
}

describe("My presets (ADR-040)", () => {
  it("saves the current chips, applies them in another shot and deletes after confirming", async () => {
    await openPanel();
    const save = await screen.findByRole("button", { name: "Save current combination" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Golden hour" }));
    fireEvent.click(screen.getByRole("button", { name: "A few people" }));
    fireEvent.click(save);
    fireEvent.change(screen.getByLabelText("Combination name"), {
      target: { value: "Warm street" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = await screen.findByRole("button", { name: "Warm street" });
    expect(db.userPresets?.[0]?.presetIds).toEqual(["time.golden_hour", "people.few_adults"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Golden hour" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove A few people" }));
    expect(useStudio.getState().workspace?.shotIntent).toBeUndefined();
    fireEvent.click(saved);
    expect(useStudio.getState().workspace?.shotIntent?.presetIds).toEqual([
      "time.golden_hour",
      "people.few_adults",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Warm street" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete saved combination?" });
    expect(db.userPresets).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Warm street" })).toBeNull());
    expect(db.userPresets).toHaveLength(0);
  }, 15_000); // renders the full Generate panel twice; ~3 s alone, slower under 4 workers

  it("validates names and ids like the backend", async () => {
    await expect(
      call("user_preset_save", { name: " ", presetIds: ["time.night"] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(
      call("user_preset_save", { name: "X", presetIds: ["../x"] }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

describe("SketchUp inbox (ADR-040)", () => {
  it("lists waiting views and imports one as the selected structure sketch", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "From sketch / massing" }));
    const receive = await screen.findByRole("button", { name: "Receive from SketchUp (2)" });
    fireEvent.click(receive);
    expect(screen.getByText(MOCK_INBOX_PATH)).toBeTruthy();
    const list = screen.getByRole("list", { name: "Views sent from SketchUp" });
    expect(within(list).getByText("Street")).toBeTruthy();
    fireEvent.click(within(list).getAllByRole("button", { name: "Import" })[1]!);
    await waitFor(() => expect(useStudio.getState().workspace?.assets).toHaveLength(1));
    const asset = useStudio.getState().workspace!.assets[0]!;
    expect(asset).toMatchObject({ role: "structure_sketch", source: "sketchup" });
    expect(useStudio.getState().generateDraft).toMatchObject({
      source: "sketch",
      purpose: "hero",
      referenceAssetIds: [asset.id],
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Receive from SketchUp (1)" })).toBeTruthy(),
    );
  });

  it("returns the existing asset when the same view is sent again", async () => {
    const project = await openPanel();
    const first = await call("sketchup_inbox_import", {
      projectId: project.id,
      fileNames: ["nha_Front.png"],
    });
    db.sketchupInbox!.push({ fileName: "nha_Front (again).png", fingerprint: "front" });
    const again = await call("sketchup_inbox_import", {
      projectId: project.id,
      fileNames: ["nha_Front (again).png"],
    });
    expect(again.duplicates).toBe(1);
    expect(again.assets[0]!.id).toBe(first.assets[0]!.id);
    await expect(
      call("sketchup_inbox_import", { projectId: project.id, fileNames: ["../x.png"] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
