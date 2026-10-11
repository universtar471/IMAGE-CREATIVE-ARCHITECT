import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialDNA } from "@arch/domain";
import { AssistControl } from "../src/features/assist/AssistControl";
import { applyAssistFields, containsVietnamese, parseAssistReply } from "../src/lib/assist";
import { defaultInteriorDNA } from "../src/lib/interior";
import { call, setTransport } from "../src/lib/bridge";
import { useStudio } from "../src/app/store";

beforeEach(() => {
  useStudio.setState({ route: { name: "hub" }, workspace: null, providers: [] });
});
afterEach(() => {
  cleanup();
  setTransport(null);
  vi.restoreAllMocks();
});

describe("assist domain stand-ins", () => {
  it("parses only catalogued values and applies only supplied fields", () => {
    const catalog = {
      scope: "interior" as const,
      fields: [
        {
          path: "interior.styleId",
          kind: "id" as const,
          options: [{ id: "japandi", en: "Japandi" }],
        },
      ],
    };
    const suggestion = parseAssistReply(
      '```json\n{"fields":[{"path":"interior.styleId","value":"japandi","confidence":0.8,"reason":"Warm and calm"},{"path":"interior.roomId","value":"living_room","confidence":1,"reason":"Unknown"}]}\n```',
      catalog,
    );
    expect(suggestion.fields.map((field) => field.path)).toEqual(["interior.styleId"]);
    expect(suggestion.dropped).toHaveLength(1);
    const dna = {
      ...createInitialDNA({ projectType: "interior", pack: null }),
      interior: defaultInteriorDNA(),
    };
    expect(applyAssistFields(dna, suggestion.fields).interior?.styleId).toBe("japandi");
    expect(containsVietnamese("Japandi ấm áp")).toBe(true);
    expect(containsVietnamese("Warm and calm")).toBe(false);
  });
});

describe("AI assist UI", () => {
  it.each([
    ["brief", "From a brief"],
    ["images", "From reference images"],
    ["master", "From Master image"],
  ])("builds the %s request", async (mode, label) => {
    const transport = vi.fn(async (_command: string, _args: unknown) => ({
      raw: '{"fields":[]}',
      modelId: "test-model",
      generationId: "generation-test",
    }));
    setTransport(transport as never);
    render(
      <AssistControl
        scope="interior"
        stepId="dna.building"
        projectType="interior"
        projectId="p1"
        dna={{
          ...createInitialDNA({ projectType: "interior", pack: null }),
          interior: defaultInteriorDNA(),
        }}
        assets={[]}
        hasMaster={mode === "master"}
        onApply={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI assist" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    if (mode === "brief")
      fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "Japandi warm" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create images" }));
    await waitFor(() => expect(transport).toHaveBeenCalledWith("dna_assist", expect.anything()));
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      request: { projectId: "p1", mode, scope: "interior" },
    });
  });

  it("renders the proposal and applies only checked fields", async () => {
    const edit = vi.fn();
    setTransport(
      vi.fn(async () => ({
        raw: JSON.stringify({
          fields: [
            { path: "interior.styleId", value: "japandi", confidence: 0.92, reason: "Warm style" },
            {
              path: "interior.roomId",
              value: "living_room",
              confidence: 0.7,
              reason: "Fits brief",
            },
          ],
        }),
        modelId: "test-model",
        generationId: "generation-test",
      })) as never,
    );
    render(
      <AssistControl
        scope="interior"
        stepId="dna.building"
        projectType="interior"
        projectId="p1"
        dna={{
          ...createInitialDNA({ projectType: "interior", pack: null }),
          interior: defaultInteriorDNA(),
        }}
        assets={[]}
        onApply={edit}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI assist" }));
    fireEvent.click(screen.getByRole("button", { name: "From a brief" }));
    fireEvent.change(screen.getByLabelText("Brief"), { target: { value: "Japandi" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Create images" }));
    await screen.findByText("Warm style");
    fireEvent.click(screen.getByLabelText(/interior.roomId/));
    fireEvent.click(screen.getByRole("button", { name: "Apply 1 items" }));
    expect(edit).toHaveBeenCalledWith([expect.objectContaining({ path: "interior.styleId" })]);
  });
});

describe("preset photo manifest", () => {
  it("prefers interior kinds and falls back when absent", async () => {
    const { previewPhoto } = await import("../src/lib/previewPhotos");
    const manifest = {
      version: 1 as const,
      items: {
        "lighting_interior/morning": {
          src: "previews/lighting_interior/morning.webp",
          w: 640,
          h: 438,
        },
      },
    };
    expect(previewPhoto("lighting", "morning", manifest, true)).toMatchObject({
      src: "previews/lighting_interior/morning.webp",
    });
    expect(previewPhoto("mood", "warm", manifest, true)).toBeUndefined();
  });
});
