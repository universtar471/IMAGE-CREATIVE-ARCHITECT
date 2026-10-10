import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { MasterDnaCheck } from "../src/features/generate/MasterDnaCheck";
import { t } from "../src/i18n";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";

beforeEach(() => {
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
  useStudio.setState({ route: { name: "hub" }, workspace: null });
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

describe("master DNA check", () => {
  it("shows the DNA floors and materials and links to Building DNA", async () => {
    const p = await createProject({
      name: "Check",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    await useStudio.getState().openProject(p.id);
    const ws = useStudio.getState().workspace!;
    useStudio.setState({
      workspace: {
        ...ws,
        persistedDna: {
          ...ws.persistedDna,
          building: {
            ...ws.persistedDna.building,
            floors: 2,
            materials: [{ zone: "walls", description: "white render" }],
          },
        },
      },
    });
    render(createElement(MasterDnaCheck));
    const note = screen.getByRole("note");
    expect(note.textContent).toContain(t("masterCheck.floors", { n: 2 }));
    expect(note.textContent).toContain("walls: white render");
    fireEvent.click(screen.getByRole("button", { name: t("masterCheck.edit") }));
    expect(useStudio.getState().activeModule).toBe("design_dna");
  });
});
