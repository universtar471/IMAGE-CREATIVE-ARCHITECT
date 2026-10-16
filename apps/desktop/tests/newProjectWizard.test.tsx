/** ADR-039: the short, theme-first project wizard. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createInitialDNA, type ProjectDNA, type ProjectDTO } from "@arch/domain";
import { NewProjectWizard } from "../src/features/projects/NewProjectWizard";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { knowledge } from "../src/lib/knowledge";
import { applyStyleDefaults, defaultInteriorDNA } from "../src/lib/interior";
import { waitFor } from "./helpers";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

function renderWizard() {
  const result: { project?: ProjectDTO } = {};
  render(<NewProjectWizard onClose={() => undefined} onCreated={(p) => (result.project = p)} />);
  return result;
}

const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

function basics(name: string, theme: RegExp) {
  fireEvent.change(screen.getByLabelText("Project name"), { target: { value: name } });
  fireEvent.click(radio(theme));
  fireEvent.click(button(/Next/));
}

async function createAndGetDna(result: { project?: ProjectDTO }) {
  fireEvent.click(button(/Create project/));
  const project = await waitFor(() => result.project, "project creation");
  return { project, dna: db.dna[project.id] as ProjectDNA };
}

describe("new project wizard — step 1 Cơ bản", () => {
  it("requires a name and a theme, and the theme cards toggle", () => {
    renderWizard();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "1Basics",
      "2Classification",
    ]);
    const next = button(/Next/);
    expect(next.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Thảo Điền" } });
    expect(next.disabled).toBe(true);

    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(radio(/^Architecture/));
    expect(radio(/^Architecture/).checked).toBe(true);
    expect(radio(/^Interior/).checked).toBe(false);
    expect(next.disabled).toBe(false);

    fireEvent.click(radio(/^Interior/));
    expect(radio(/^Interior/).checked).toBe(true);
    expect(radio(/^Architecture/).checked).toBe(false);

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "   " } });
    expect(next.disabled).toBe(true);
    expect(screen.getByText("Give the project a name.")).toBeTruthy();
  });
});

describe("new project wizard — step 2 Phân loại", () => {
  it("offers exactly the eight in-scope building types for Công trình", () => {
    renderWizard();
    basics("Types", /^Architecture/);
    const group = screen.getByRole("radiogroup", { name: "Building type" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.closest("label")!.textContent),
    ).toEqual([
      "Townhouse",
      "Single-storey house",
      "Villa",
      "Urban villa",
      "Prefab / modular",
      "Hotel",
      "Resort",
      "Other",
    ]);
    for (const absent of [/Cafe/i, /Restaurant/i, /Office/i, /Commercial/i]) {
      expect(within(group).queryByRole("radio", { name: absent })).toBeNull();
    }
    expect(radio(/^Villa$/).checked).toBe(true);
    // Step 2 holds the create button; there is no third step.
    expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
    expect(button(/Create project/).disabled).toBe(false);
  });

  it("creates an interior project with the chosen room and style", async () => {
    const result = renderWizard();
    basics("New interior", /^Interior/);
    fireEvent.change(screen.getByLabelText("Building use"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("Room"), { target: { value: "meeting_room" } });
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    const { project, dna } = await createAndGetDna(result);
    expect(project.projectType).toBe("interior");
    expect(dna.interior).toMatchObject({
      buildingUseId: "office",
      roomId: "meeting_room",
      styleId: "modern",
    });
    const base = createInitialDNA({
      projectType: "interior",
      subtype: null,
      pack: knowledge.resolve("interior", null).pack,
      starter: { dimensions: {} },
    });
    expect(dna).toEqual({
      ...base,
      interior: applyStyleDefaults(
        defaultInteriorDNA("office", "meeting_room", "modern"),
        "modern",
      ),
    });
  });

  it("resets the step-2 values when the theme changes", () => {
    renderWizard();
    basics("Switch", /^Architecture/);
    fireEvent.click(radio(/^Townhouse$/));
    fireEvent.change(screen.getByLabelText("Architectural style"), {
      target: { value: "Brutalist" },
    });
    fireEvent.change(screen.getByLabelText("Floors"), { target: { value: "0" } });
    expect(button(/Create project/).disabled).toBe(true);

    fireEvent.click(button(/Back/));
    fireEvent.click(radio(/^Interior/));
    fireEvent.click(button(/Next/));
    expect((screen.getByLabelText("Building use") as HTMLSelectElement).value).toBe("apartment");
    expect((screen.getByLabelText("Room") as HTMLSelectElement).value).toBe("living_room");
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "modern" } });
    // The hidden invalid floors value from Công trình was dropped.
    expect(button(/Create project/).disabled).toBe(false);

    fireEvent.click(button(/Back/));
    fireEvent.click(radio(/^Architecture/));
    fireEvent.click(button(/Next/));
    expect(radio(/^Villa$/).checked).toBe(true);
    expect((screen.getByLabelText("Architectural style") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Floors") as HTMLInputElement).value).toBe("");
  });

  it("creates without opening Thông số and applies the pack defaults", async () => {
    const result = renderWizard();
    basics("Defaults", /^Architecture/);
    const section = screen.getByText("Parameters (optional)").closest("details")!;
    expect(section.open).toBe(false);
    fireEvent.click(radio(/^Townhouse$/));
    const { project, dna } = await createAndGetDna(result);
    expect(project.projectType).toBe("townhouse");
    const pack = knowledge.resolve("townhouse", null).pack!;
    expect(dna.building.floors).toBe(pack.defaults.building.floors);
    expect(dna.context.macroContext).toBe(pack.defaults.context.macroContext);
    expect(dna).toEqual(
      createInitialDNA({
        projectType: "townhouse",
        subtype: null,
        pack,
        starter: { dimensions: {} },
      }),
    );
  });

  it("with Thông số filled, matches the old wizard output for the same inputs", async () => {
    const result = renderWizard();
    basics("Filled", /^Architecture/);
    fireEvent.click(radio(/^Townhouse$/));
    fireEvent.change(screen.getByLabelText("Subtype"), { target: { value: "narrow_lot" } });
    fireEvent.change(screen.getByLabelText("Architectural style"), {
      target: { value: "Tropical modern" },
    });
    fireEvent.change(screen.getByLabelText("Floors"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Building width"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Building depth"), { target: { value: "16" } });
    fireEvent.change(screen.getByLabelText("Site width"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Site depth"), { target: { value: "20" } });
    const pack = knowledge.resolve("townhouse", "narrow_lot").pack!;
    const preset = pack.contextPresets[0]!;
    const presetButton = screen
      .getAllByRole("button")
      .find((b) => b.classList.contains("choice") && b.textContent?.includes(preset.label))!;
    fireEvent.click(presetButton);
    expect(presetButton.getAttribute("aria-pressed")).toBe("true");

    const { project, dna } = await createAndGetDna(result);
    expect(project.subtype).toBe("narrow_lot");
    // The same createInitialDNA call the old four-step wizard made for these inputs.
    const expected = createInitialDNA({
      projectType: "townhouse",
      subtype: "narrow_lot",
      pack,
      starter: {
        architecturalStyle: "Tropical modern",
        floors: 4,
        dimensions: { widthM: 4, depthM: 16, siteWidthM: 4, siteDepthM: 20 },
        contextPresetId: preset.id,
      },
    });
    expect(dna).toEqual(expected);
    expect(dna.building.floors).toBe(4);
    expect(dna.building.dimensions).toMatchObject({ widthM: 4, depthM: 16 });
  });

  it("shows the DNA summary on step 2", () => {
    renderWizard();
    basics("Summary", /^Architecture/);
    const summary = screen.getByRole("table", { name: "Starting DNA summary" });
    expect(within(summary).getByText(/^Villa ·/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Floors"), { target: { value: "3" } });
    expect(within(summary).getByText("3")).toBeTruthy();
  });
});
