import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInitialDNA } from "@arch/domain";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { PropertyPanel } from "../src/components/panels/PropertyPanel";
import { SpaceReferences } from "../src/features/assets/SpaceReferences";
import { AssistControl } from "../src/features/assist/AssistControl";
import { setTransport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { asset } from "./helpers";

beforeEach(() => {
  useStudio.setState({ workspace: null, workflowView: null, providers: [] });
  setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
});
afterEach(() => {
  cleanup();
  setTransport(null);
});

it("exposes import and AI recommendations in the architecture References inspector", async () => {
  const project = await createProject({
    name: "Architecture",
    projectType: "custom",
    subtype: null,
    starter: {},
  });
  await useStudio.getState().openProject(project.id);
  useStudio.getState().setModule("references");
  render(<PropertyPanel />);
  expect(screen.getByRole("button", { name: "Import images" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "AI assist" })).toBeTruthy();
});

it("asks reference AI for architecture fields and applies only after approval", async () => {
  const project = await createProject({
    name: "Architecture",
    projectType: "custom",
    subtype: null,
    starter: {},
  });
  await useStudio.getState().openProject(project.id);
  const transport = vi.fn(async (_command: string, _args: unknown) => ({
    raw: JSON.stringify({
      fields: [
        {
          path: "building.architecturalStyle",
          value: "japandi",
          confidence: 0.9,
          reason: "Reference style",
        },
      ],
    }),
    modelId: "mock",
    generationId: "GEN_REF",
    usage: null,
  }));
  setTransport(transport as never);
  render(<SpaceReferences />);
  fireEvent.click(screen.getByRole("button", { name: "AI assist" }));
  fireEvent.click(screen.getByRole("button", { name: "From a brief" }));
  fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "Match the facade style" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Create images" }));
  await screen.findByText("Reference style");
  const request = transport.mock.calls[0]?.[1] as {
    request: { scope: string; catalog: { fields: { path: string }[] } };
  };
  expect(request.request.scope).toBe("building");
  const paths = request.request.catalog.fields.map((f) => f.path);
  expect(paths).toContain("building.architecturalStyle");
  expect(paths).toContain("lighting.timeOfDay");
  expect(paths.some((p) => p.startsWith("interior."))).toBe(false);
  expect(useStudio.getState().workspace!.draftDna.building.architecturalStyle).not.toBe("japandi");
  fireEvent.click(screen.getByRole("button", { name: "Apply 1 items" }));
  await waitFor(() =>
    expect(useStudio.getState().workspace!.draftDna.building.architecturalStyle).toBe("japandi"),
  );
});

it("preselects newly imported references when opening an already mounted AI control", () => {
  const props = {
    scope: "building" as const,
    projectType: "custom",
    projectId: "p1",
    dna: createInitialDNA({ projectType: "custom", pack: null }),
    onApply: vi.fn(),
  };
  const view = render(<AssistControl {...props} assets={[]} />);
  view.rerender(<AssistControl {...props} assets={[asset("p1", "AST_NEW")]} />);
  fireEvent.click(screen.getByRole("button", { name: "AI assist" }));
  fireEvent.click(screen.getByRole("button", { name: "From reference images" }));
  expect((screen.getByRole("checkbox", { name: "AST_NEW.jpg" }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(
    false,
  );
});
