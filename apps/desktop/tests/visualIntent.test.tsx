import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { VisualIntentSelector } from "../src/features/camera/VisualIntentSelector";
import { createMockTransport } from "../src/lib/mockBackend";
import { setTransport } from "../src/lib/bridge";

type Db = NonNullable<Parameters<typeof createMockTransport>[0]>;
let db: Db;

beforeEach(() => {
  db = { projects: {}, dna: {}, assets: {}, versions: [] };
  setTransport(createMockTransport(db));
  useStudio.setState({ route: { name: "hub" }, workspace: null, workflowView: null });
});

afterEach(() => {
  cleanup();
  setTransport(null);
});

describe("visual intent selector", () => {
  it("keeps CameraDNA unchanged when switching simple, expert and simple", async () => {
    const project = await createProject({
      name: "Visual intent",
      projectType: "townhouse",
      subtype: "default",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(project.id);
    const before = structuredClone(useStudio.getState().workspace!.draftDna.cameras);

    render(<VisualIntentSelector />);
    fireEvent.click(screen.getByTestId("visual-intent-level-custom"));
    fireEvent.click(screen.getAllByTestId("visual-intent-view-card")[1]!);
    fireEvent.click(screen.getByTestId("visual-intent-level-expert"));
    fireEvent.click(screen.getByTestId("visual-intent-level-simple"));

    expect(useStudio.getState().workspace!.draftDna.cameras).toEqual(before);
    expect(useStudio.getState().workspace!.shotIntent?.visualIntent).toBeDefined();
  });
});
