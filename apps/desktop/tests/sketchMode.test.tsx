import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport, registerBrowserFile } from "../src/lib/mockBackend";
import { asset } from "./helpers";
import type * as FileHelpers from "../src/lib/files";

vi.mock("../src/lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof FileHelpers>()),
  pickImages: vi.fn(async () => ["mock://sketch.png"]),
}));

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let importedRole: string | null;
let generationSubmits: number;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  importedRole = null;
  generationSubmits = 0;
  const base = createMockTransport(db);
  const transport: Transport = async (command, args) => {
    if (command === "provider_list") {
      const providers = (await base(command, args)) as Array<{ id: string; configured: boolean }>;
      return providers.map((provider) =>
        provider.id === "gemini" ? { ...provider, configured: true } : provider,
      );
    }
    if (command === "asset_import") {
      const request = args.request as {
        projectId: string;
        role: string;
        source: "external";
      };
      importedRole = request.role;
      const imported = asset(request.projectId, "AST_IMPORTED_SKETCH", {
        role: "structure_sketch",
        source: request.source,
        originalName: "sketch.png",
      });
      db.assets[imported.id] = imported;
      return imported;
    }
    if (command === "generation_submit") generationSubmits++;
    return base(command, args);
  };
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

async function openPanel(confirmed = false) {
  const project = await createProject({
    name: "Sketch mode",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  if (confirmed) {
    db.workflow ??= {};
    db.workflow[project.id] = [
      "dna.building",
      "dna.context",
      "dna.references",
      "dna.camera",
      "dna.lighting",
    ].map((stepId) => ({ stepId, status: "confirmed", confirmedAt: "now" })) as never;
  }
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  render(<GeneratePanel />);
}

describe("Generate sketch source", () => {
  it("stores structure_sketch when asset_import runs through the mock transport", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "structure.png", {
      type: "image/png",
    });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:structure");
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(400);
    vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(300);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/jpeg,x");
    const project = await createProject({
      name: "Mock role",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    const handle = registerBrowserFile(file);
    const imported = await createMockTransport(db)("asset_import", {
      request: {
        projectId: project.id,
        sourcePath: handle,
        source: "external",
        role: "structure_sketch",
        allowDuplicate: false,
      },
    });
    expect(imported).toMatchObject({ role: "structure_sketch" });
    expect(Object.values(db.assets)[0]).toMatchObject({ role: "structure_sketch" });
  });

  it("toggles into sketch mode and forces Hero", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "From sketch / massing" }));
    expect(useStudio.getState().generateDraft).toMatchObject({ source: "sketch", purpose: "hero" });
    expect(screen.getByText("No structure sketch yet — click Import sketch")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hero" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("imports through the existing path with the structure_sketch role", async () => {
    await openPanel();
    fireEvent.click(screen.getByRole("button", { name: "From sketch / massing" }));
    fireEvent.click(screen.getByRole("button", { name: "Import sketch" }));
    await waitFor(() => expect(importedRole).toBe("structure_sketch"));
    await waitFor(() =>
      expect(useStudio.getState().workspace?.assets[0]?.role).toBe("structure_sketch"),
    );
  });

  it("routes a paid sketch Hero submit through the shared spend confirmation", async () => {
    await openPanel(true);
    fireEvent.click(screen.getByRole("button", { name: "From sketch / massing" }));
    fireEvent.click(screen.getByRole("button", { name: "Import sketch" }));
    await waitFor(() => expect(useStudio.getState().workspace?.assets).toHaveLength(1));
    fireEvent.click(screen.getByTestId("generate-button"));
    expect(await screen.findByRole("dialog", { name: "Confirm cost" })).toBeTruthy();
    expect(generationSubmits).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(generationSubmits).toBe(0);
  });
});
