import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CATALOG_VERSION, compilePrompt, type ProjectDNA } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { useLocale } from "../src/i18n";
import { SpaceSelector } from "../src/features/space/SpaceSelector";
import { BuildingDnaPanel } from "../src/features/dna/BuildingDnaPanel";

beforeEach(() => {
  useLocale.setState({ locale: "vi" });
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

async function openTownhouse() {
  const project = await createProject({
    name: "Nhà phố",
    projectType: "townhouse",
    subtype: "default",
    starter: {},
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

const draft = () => useStudio.getState().workspace!.draftDna as ProjectDNA;

describe("SpaceSelector (ADR-034 P1a)", () => {
  it("writes dna.spaceCatalog through archetype → group → space, with blank dimensions", async () => {
    await openTownhouse();
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    expect(within(panel).getByText("Gợi ý theo loại dự án: Nhà phố")).toBeTruthy();
    expect(draft().spaceCatalog).toBeUndefined();

    fireEvent.change(within(panel).getByLabelText("Loại công trình (danh mục)"), {
      target: { value: "townhouse" },
    });
    expect(draft().spaceCatalog).toEqual({
      version: 1,
      buildingArchetype: "townhouse",
      spaces: [],
    });

    fireEvent.click(within(panel).getByRole("button", { name: "Ngoài trời" }));
    // A townhouse offers its narrow rear courtyard, never the villa pool.
    expect(within(panel).queryByRole("button", { name: /Hồ bơi/ })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: /Sân sau hẹp/ }));

    const catalog = draft().spaceCatalog!;
    expect(catalog.spaces).toHaveLength(1);
    expect(catalog.spaces[0]).toMatchObject({
      presetId: "townhouse.outdoor.san_sau_hep",
      facts: {},
      approvedOptionalIds: [],
    });
    expect(catalog.spaces[0]!.id).toMatch(/^SPC_[0-9A-Z]{26}$/);
    expect(catalog.activeSpaceId).toBe(catalog.spaces[0]!.id);
    expect(useStudio.getState().save.status).toBe("dirty");

    // Evidence badges; no variant step because the preset has no variants.
    for (const badge of ["Đã xác minh", "Chưa rõ", "Người dùng khai báo"])
      expect(within(panel).getByRole("button", { name: badge })).toBeTruthy();
    expect(within(panel).queryByLabelText("Biến thể")).toBeNull();
    // Unmeasured dimensions stay blank.
    const width = within(panel).getByLabelText("Rộng") as HTMLInputElement;
    expect(width.value).toBe("");

    fireEvent.click(within(panel).getByRole("button", { name: "Đã xác minh" }));
    fireEvent.change(width, { target: { value: "3,5" } });
    expect(draft().spaceCatalog!.spaces[0]!.facts.widthM).toEqual({
      value: 3.5,
      evidence: { status: "verified", sourceAssetIds: [] },
    });

    const bundle = compilePrompt({
      project: { id: "PRJ_T", name: "T", projectType: "townhouse" },
      dna: draft(),
      references: [],
    });
    expect(bundle.catalogVersion).toBe(CATALOG_VERSION);
    expect(bundle.positivePrompt).toContain(
      "Space scope: render only the compact rear courtyard of this townhouse",
    );
    expect(bundle.positivePrompt).toContain("Verified dimensions: width 3.5 m.");

    fireEvent.change(width, { target: { value: "" } });
    expect(draft().spaceCatalog!.spaces[0]!.facts).toEqual({});
  });

  it("supports an other / custom space", async () => {
    await openTownhouse();
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    fireEvent.change(within(panel).getByLabelText("Loại công trình (danh mục)"), {
      target: { value: "villa" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Không gian khác / tùy chỉnh" }));
    fireEvent.change(within(panel).getByLabelText("Tên không gian tùy chỉnh"), {
      target: { value: "Góc đọc sách" },
    });
    const catalog = draft().spaceCatalog!;
    expect(catalog.buildingArchetype).toBe("villa");
    expect(catalog.spaces[0]).toMatchObject({ presetId: "custom", label: "Góc đọc sách" });
    expect(catalog.activeSpaceId).toBe(catalog.spaces[0]!.id);
  });

  it("is shown in the Design DNA panel and is read-only for archived projects", async () => {
    await openTownhouse();
    const ws = useStudio.getState().workspace!;
    useStudio.setState({
      workspace: { ...ws, project: { ...ws.project, archivedAt: "2026-10-16T00:00:00Z" } },
    });
    render(<BuildingDnaPanel />);
    const panel = screen.getByTestId("space-selector");
    expect(
      (within(panel).getByLabelText("Loại công trình (danh mục)") as HTMLSelectElement).disabled,
    ).toBe(true);
    fireEvent.change(within(panel).getByLabelText("Loại công trình (danh mục)"), {
      target: { value: "villa" },
    });
    expect(draft().spaceCatalog).toBeUndefined();
  });

  it("renders English labels", async () => {
    useLocale.setState({ locale: "en" });
    await openTownhouse();
    render(<SpaceSelector />);
    const panel = screen.getByTestId("space-selector");
    fireEvent.change(within(panel).getByLabelText("Building type (catalog)"), {
      target: { value: "townhouse" },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Outdoor" }));
    fireEvent.click(within(panel).getByRole("button", { name: /Compact rear courtyard/ }));
    expect(within(panel).getByTestId("space-active").textContent).toBe(
      "Active space: Compact rear courtyard",
    );
    expect(within(panel).getByRole("button", { name: "Declared by user" })).toBeTruthy();
  });
});
