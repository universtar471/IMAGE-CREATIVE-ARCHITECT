import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { InteriorDnaPanel } from "../src/features/dna/InteriorDnaPanel";
import { createMockTransport } from "../src/lib/mockBackend";
import { defaultInteriorDNA } from "../src/lib/interior";
import { setTransport } from "../src/lib/bridge";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;

let db: Db;
let observers: Array<{ callback: ResizeObserverCallback }>;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  observers = [];
  setTransport(createMockTransport(db));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }

      observe() {}

      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setTransport(null);
});

async function renderInterior() {
  const project = await createProject({
    name: "Space layout test",
    projectType: "interior",
    subtype: "default",
    starter: {},
    interior: defaultInteriorDNA(),
  });
  await useStudio.getState().openProject(project.id);
  const interior = defaultInteriorDNA();
  interior.surfaces.floor = ["walnut", "oak"];
  interior.furnitureIds = ["rug", "sofa"];
  useStudio.getState().editDna("interior", interior);
  render(<InteriorDnaPanel />);
}

describe("Space panel layout", () => {
  it("keeps the compact moodboard above space controls at every panel width", async () => {
    await renderInterior();
    const layout = screen.getByTestId("interior-layout");

    act(() => {
      observers.forEach(({ callback }) =>
        callback([{ contentRect: { width: 340 } }] as never, {} as never),
      );
    });
    expect(layout.getAttribute("data-layout")).toBe("stacked");
    expect(layout.firstElementChild?.classList.contains("interior-moodboard")).toBe(true);
    expect(layout.lastElementChild?.classList.contains("interior-fields")).toBe(true);

    act(() => {
      observers.forEach(({ callback }) =>
        callback([{ contentRect: { width: 640 } }] as never, {} as never),
      );
    });
    expect(layout.getAttribute("data-layout")).toBe("stacked");
  });

  it("moves editing controls out of Space while preserving existing selections", async () => {
    await renderInterior();
    expect(screen.queryByRole("group", { name: "Floor" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Furniture" })).toBeNull();
    expect(screen.getByText("Reference images")).toBeTruthy();
    expect(useStudio.getState().workspace!.draftDna.interior).toMatchObject({
      surfaces: { floor: ["walnut", "oak"] },
      furnitureIds: ["rug", "sofa"],
    });
  });
});
