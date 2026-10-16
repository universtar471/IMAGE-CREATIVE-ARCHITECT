/** Context Library V4 panel (SRS P1d): the only writer of `context.library`. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ProjectDNASchema, compilePrompt, type ProjectDNA } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { useLocale } from "../src/i18n";
import { ContextDnaPanel } from "../src/features/dna/ContextDnaPanel";
import { ContextLibraryPanel } from "../src/features/contextLibrary/ContextLibraryPanel";
import { call, setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  useLocale.setState({ locale: "en" });
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});

afterEach(() => {
  cleanup();
  setTransport(null);
  useLocale.setState({ locale: "en" });
});

async function openTownhouse() {
  const project = await createProject({
    name: "Context library",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

const draft = () => useStudio.getState().workspace!.draftDna as ProjectDNA;
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const optionLabels = (label: string) => [...select(label).options].map((o) => o.value);

describe("context library panel", () => {
  it("is part of the context panel and filters presets by the project archetype", async () => {
    await openTownhouse();
    render(<ContextDnaPanel />);
    const panel = screen.getByTestId("context-library-panel");
    expect(screen.getByText("Context suggestions (library V4)")).toBeTruthy();
    expect(within(panel).getByTestId("context-library-evidence-note").textContent).toMatch(
      /verified site evidence.*always win/,
    );
    expect(select("Building type").value).toBe("townhouse");
    const presets = optionLabels("Context preset").filter(Boolean);
    expect(presets).toHaveLength(12);
    expect(presets.every((id) => id.startsWith("townhouse."))).toBe(true);
    // Nothing is written until the user picks a preset; the region waits for a preset.
    expect(draft().context.library).toBeUndefined();
    expect(select("Region").disabled).toBe(true);

    fireEvent.change(select("Building type"), { target: { value: "villa" } });
    expect(optionLabels("Context preset").filter(Boolean)[0]).toMatch(/^villa\./);
    expect(draft().context.library).toBeUndefined();
  });

  it("writes context.library for preset, region and optional cues, and the compiler uses it", async () => {
    const project = await openTownhouse();
    render(<ContextLibraryPanel />);
    fireEvent.change(select("Context preset"), { target: { value: "townhouse.urban_infill" } });
    expect(draft().context.library).toEqual({
      version: 1,
      presetId: "townhouse.urban_infill",
      regionId: "unspecified",
      approvedOptional: [],
    });
    fireEvent.change(select("Region"), { target: { value: "vn_south_urban" } });
    expect(draft().context.library?.regionId).toBe("vn_south_urban");
    expect(screen.getByTestId("context-library-region-avoid").textContent).toContain(
      "automatic detached lawns",
    );

    const optional = screen.getByTestId("context-library-optional");
    fireEvent.click(within(optional).getByLabelText("realistic surface weathering"));
    fireEvent.click(within(optional).getByLabelText("restrained local activity"));
    // Stored in library order, independent of click order.
    expect(draft().context.library?.approvedOptional).toEqual([
      "restrained local activity",
      "realistic surface weathering",
    ]);
    fireEvent.click(within(optional).getByLabelText("restrained local activity"));
    expect(draft().context.library?.approvedOptional).toEqual(["realistic surface weathering"]);

    expect(await useStudio.getState().flushDna()).toBe(true);
    const persisted = ProjectDNASchema.parse(await call("dna_get", { projectId: project.id }));
    expect(persisted.context.library).toEqual(draft().context.library);
    const bundle = compilePrompt({
      project: { id: project.id, name: project.name, projectType: "townhouse", subtype: null },
      dna: persisted,
      references: [],
    });
    expect(bundle.positivePrompt).toContain(
      "Approved optional cues: realistic surface weathering.",
    );
    expect(bundle.positivePrompt).not.toContain("restrained local activity");

    // Clearing the preset removes the field.
    fireEvent.change(select("Context preset"), { target: { value: "" } });
    expect("library" in draft().context).toBe(false);
  });

  it("lists cues the site contradicts as dropped and keeps them out of the choices", async () => {
    await openTownhouse();
    render(<ContextLibraryPanel />);
    fireEvent.change(select("Building type"), { target: { value: "villa" } });
    fireEvent.change(select("Context preset"), { target: { value: "villa.detached" } });
    const dropped = screen.getByTestId("context-library-dropped");
    expect(dropped.textContent).toContain("four exposed elevations — contradicts the site data");
    expect(dropped.textContent).toContain("attached party walls");
    expect(screen.getByTestId("context-library-required").textContent).not.toContain(
      "four exposed elevations",
    );
    expect(screen.queryByTestId("context-library-forbidden")).toBeNull();
  });

  it("cannot be edited in a read-only project or with the context locked", async () => {
    const project = await openTownhouse();
    useStudio.getState().editDna("context.library", {
      version: 1,
      presetId: "townhouse.alley",
      regionId: "vn_north_urban",
      approvedOptional: [],
    });
    expect(await useStudio.getState().flushDna()).toBe(true);
    db.projects[project.id]!.archivedAt = "2026-10-16T00:00:00Z";
    await useStudio.getState().openProject(project.id);
    render(<ContextLibraryPanel />);
    for (const label of ["Building type", "Context preset", "Region"])
      expect(select(label).disabled, label).toBe(true);
    const box = within(screen.getByTestId("context-library-optional")).getByLabelText(
      "restrained local activity",
    ) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    fireEvent.change(select("Context preset"), { target: { value: "townhouse.main_road" } });
    expect(draft().context.library?.presetId).toBe("townhouse.alley");

    cleanup();
    await openTownhouse();
    useStudio.getState().editDna("locks.context", true);
    render(<ContextLibraryPanel />);
    expect(select("Context preset").disabled).toBe(true);
  });

  it("renders accented Vietnamese labels and the drop reason", async () => {
    useLocale.setState({ locale: "vi" });
    await openTownhouse();
    render(<ContextLibraryPanel />);
    expect(screen.getByText("Gợi ý bối cảnh (thư viện V4)")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Nhà phố liền kề" })).toBeTruthy();
    fireEvent.change(select("Loại công trình"), { target: { value: "hotel" } });
    fireEvent.change(select("Mẫu bối cảnh"), { target: { value: "hotel.retreat" } });
    expect(screen.getByTestId("context-library-dropped").textContent).toContain(
      "mâu thuẫn với dữ liệu khu đất",
    );
    expect(screen.getByTestId("context-library-evidence-note").textContent).toContain(
      "luôn được ưu tiên",
    );
    expect(screen.getByRole("option", { name: "Bắc Bộ đô thị" })).toBeTruthy();
  });
});
