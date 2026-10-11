import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMockTransport } from "../src/lib/mockBackend";
import { createProject } from "../src/app/services";
import { setTransport } from "../src/lib/bridge";
import { useStudio } from "../src/app/store";
import { useLocale } from "../src/i18n";
import { defaultInteriorDNA } from "../src/lib/interior";
import { InteriorDnaPanel } from "../src/features/dna/InteriorDnaPanel";
import { LightingPanel } from "../src/features/lighting/LightingPanel";
import { MoodGradePanel } from "../src/features/mood/MoodGradePanel";

beforeEach(() => {
  useLocale.setState({ locale: "en" });
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({
    route: { name: "hub" },
    workspace: null,
    workflowView: null,
    providers: [],
  });
});
afterEach(() => {
  cleanup();
  setTransport(null);
  vi.restoreAllMocks();
});

describe("rendered translations", () => {
  it("does not expose raw translation keys in Space, lighting, mood/grade or assist", async () => {
    const project = await createProject({
      name: "Keys",
      projectType: "interior",
      subtype: "default",
      starter: {},
      interior: defaultInteriorDNA(),
    });
    await useStudio.getState().openProject(project.id);
    for (const Panel of [InteriorDnaPanel, LightingPanel, MoodGradePanel]) {
      const { container } = render(<Panel />);
      const assist = container.querySelector<HTMLButtonElement>(".assist-trigger");
      if (assist) fireEvent.click(assist);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      const rawKeys: string[] = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim() ?? "";
        if (/^[a-z]+(\.[a-zA-Z0-9_]+){1,}$/.test(text)) rawKeys.push(text);
      }
      expect(rawKeys).toEqual([]);
      cleanup();
    }
    expect(screen.queryByText("assist.title")).toBeNull();
  });
});
