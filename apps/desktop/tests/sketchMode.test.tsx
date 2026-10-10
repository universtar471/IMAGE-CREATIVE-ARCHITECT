import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { GeneratePanel } from "../src/features/generate/GeneratePanel";
import { setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";
import type * as FileHelpers from "../src/lib/files";

vi.mock("../src/lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof FileHelpers>()),
  pickImages: vi.fn(async () => ["mock://sketch.png"]),
}));

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;
let importedRole: string | null;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  importedRole = null;
  const base = createMockTransport(db);
  const transport: Transport = async (command, args) => {
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
  setTransport(null);
});

async function openPanel() {
  const project = await createProject({
    name: "Sketch mode",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(project.id);
  await useStudio.getState().loadProviders();
  render(<GeneratePanel />);
}

describe("Generate sketch source", () => {
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
});
