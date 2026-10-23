import { asset } from "./helpers";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultInteriorDNA } from "@arch/domain";
import { createProject } from "../src/app/services";
import { EMPTY_GENERATE_DRAFT, useStudio } from "../src/app/store";
import { createMockTransport } from "../src/lib/mockBackend";
import { setTransport } from "../src/lib/bridge";
import { RoomsPanel } from "../src/features/rooms/RoomsPanel";
import { WorkspaceNav } from "../src/components/shell/WorkspaceNav";
import { RegionPanel } from "../src/features/regions/RegionPanel";
import { GradePreview } from "../src/features/previews/GradePreview";
import { neutralGrade } from "../src/lib/grade";

beforeEach(() => {
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({
    workspace: null,
    workflowView: null,
    generateDraft: EMPTY_GENERATE_DRAFT,
    regionAction: "edit",
    workspaceMode: "studio",
    providers: [],
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});
async function openInterior() {
  const project = await createProject({
    name: "Room test",
    projectType: "interior",
    subtype: null,
    starter: {},
    interior: defaultInteriorDNA(),
  });
  await useStudio.getState().openProject(project.id);
  return project;
}

it("adds room components to the existing prompt and connects a draft to the selected image", async () => {
  const project = await openInterior();
  const image = asset(project.id, "AST_ROOM");
  useStudio.setState({ workspace: { ...useStudio.getState().workspace!, assets: [image] } });
  useStudio.getState().selectAsset(image.id);
  useStudio.getState().setGenerateDraft({ extraPrompt: "Preserve the layout" });
  render(<RoomsPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Bedroom" }));
  fireEvent.click(screen.getByRole("button", { name: "Add to Prompt" }));
  expect(useStudio.getState().generateDraft.extraPrompt).toContain("Preserve the layout\nBedroom:");
  expect(useStudio.getState().workspace!.draftDna.interior?.furnitureIds).toContain("bed");
  fireEvent.click(screen.getByRole("button", { name: "Add to Node" }));
  expect(useStudio.getState()).toMatchObject({
    workspaceMode: "node",
    activeModule: "generate",
    canvasSelection: ["draft"],
    generateDraft: { source: "sketch", referenceAssetIds: [image.id] },
  });
});

it("routes interior references to Style and hides standalone scene objects", async () => {
  await openInterior();
  render(<WorkspaceNav />);
  expect(screen.queryByRole("button", { name: "Rooms" })).toBeNull();
  expect(document.querySelector('[data-module="detail"]')).toBeNull();
  expect(document.querySelector('[data-module="references"]')).toBeNull();
  expect(document.querySelector('[data-module="scene_objects"]')).toBeNull();
  useStudio.getState().setModule("references");
  expect(useStudio.getState().activeModule).toBe("style");
});

it("offers region insertion actions but requires a region before material controls", async () => {
  await openInterior();
  render(<RegionPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Add person" }));
  expect(useStudio.getState().regionAction).toBe("person");
  fireEvent.click(screen.getByRole("button", { name: "Material" }));
  expect(screen.queryByRole("group", { name: "Material" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Run region edit" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it("shows a real-image empty state instead of a house illustration", () => {
  render(<GradePreview asset={null} grade={neutralGrade()} />);
  expect(screen.getByText("Select a project image to preview colour")).toBeTruthy();
  expect(document.querySelector("svg")).toBeNull();
});
