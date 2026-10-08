import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../src/app/services";
import { AUTOSAVE_DELAY_MS, useStudio } from "../src/app/store";
import { call, setTransport, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

let transport: Transport;
let spy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const base = createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] });
  spy = vi.fn(base);
  transport = spy as unknown as Transport;
  setTransport(transport);
  useStudio.setState({ route: { name: "hub" }, workspace: null });
});

afterEach(() => {
  vi.useRealTimers();
  setTransport(null);
});

async function openNewVilla() {
  const p = await createProject({
    name: "Villa Tropical Test",
    projectType: "villa",
    subtype: "tropical",
    starter: { floors: 2 },
  });
  await useStudio.getState().openProject(p.id);
  return p;
}

const dnaUpdates = () => spy.mock.calls.filter(([cmd]) => cmd === "dna_update").length;

describe("DNA editing and autosave", () => {
  it("creates a project from pack defaults and opens it", async () => {
    const p = await openNewVilla();
    const ws = useStudio.getState().workspace!;
    expect(ws.project.id).toBe(p.id);
    expect(ws.persistedDna.building.architecturalStyle).toBe("Modern tropical");
    expect(ws.persistedDna.building.floors).toBe(2);
  });

  it("debounces and persists valid edits", async () => {
    vi.useFakeTimers();
    const p = await openNewVilla();
    const { editDna } = useStudio.getState();
    editDna("building.colorPalette", ["white", "beige"]);
    editDna("building.notes", "deep overhangs");
    expect(useStudio.getState().save.status).toBe("dirty");
    expect(dnaUpdates()).toBe(0);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 10);
    expect(dnaUpdates()).toBe(1);
    expect(useStudio.getState().save.status).toBe("saved");

    const stored = await call("dna_get", { projectId: p.id });
    expect(stored.building.colorPalette).toEqual(["white", "beige"]);
    expect(stored.building.notes).toBe("deep overhangs");
  });

  it("never persists invalid values and reports field errors", async () => {
    vi.useFakeTimers();
    const p = await openNewVilla();
    useStudio.getState().editDna("building.dimensions.widthM", -5);
    expect(useStudio.getState().save.status).toBe("invalid");
    expect(useStudio.getState().save.fieldErrors["building.dimensions.widthM"]).toMatch(
      /greater than 0/,
    );

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3);
    expect(await useStudio.getState().flushDna()).toBe(false);
    expect(dnaUpdates()).toBe(0);
    const stored = await call("dna_get", { projectId: p.id });
    expect(stored.building.dimensions.widthM).toBeUndefined();

    // The unsaved draft is kept (not silently lost) until fixed.
    expect(useStudio.getState().workspace!.draftDna.building.dimensions.widthM).toBe(-5);
    useStudio.getState().editDna("building.dimensions.widthM", 12);
    expect(await useStudio.getState().flushDna()).toBe(true);
    expect((await call("dna_get", { projectId: p.id })).building.dimensions.widthM).toBe(12);
  });

  it("flushes pending edits when returning to the hub", async () => {
    vi.useFakeTimers();
    const p = await openNewVilla();
    useStudio.getState().editDna("context.macroContext", "lake shore");
    await useStudio.getState().goToHub();
    expect(useStudio.getState().route).toEqual({ name: "hub" });
    expect((await call("dna_get", { projectId: p.id })).context.macroContext).toBe("lake shore");
  });

  it("archived projects are read-only in the editor", async () => {
    const p = await openNewVilla();
    const archived = await call("project_set_archived", { projectId: p.id, archived: true });
    useStudio.getState().adoptProject(archived);
    useStudio.getState().editDna("building.notes", "should not apply");
    expect(useStudio.getState().workspace!.draftDna.building.notes).toBe("");
    expect(useStudio.getState().save.status).toBe("saved");
  });
});
