import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextDNA, LightingDNA, AssetDTO } from "@arch/domain";
import { LightingPreview, LightingPresetCards } from "../src/features/previews/LightingPreview";
import { MoodPresetCards } from "../src/features/previews/MoodPreview";
import { GradePresetCards, GradePreview } from "../src/features/previews/GradePreview";
import { ContextPresetCards, ContextPreview } from "../src/features/previews/ContextPreview";
import { translate } from "../src/i18n";
import { neutralGrade } from "../src/lib/grade";
import { knowledge } from "../src/lib/knowledge";
import { ProjectTypeSchema } from "@arch/domain";

afterEach(cleanup);

const lighting = (patch: Partial<LightingDNA> = {}): LightingDNA => ({
  schemaVersion: 1,
  timeOfDay: "morning",
  sunDirection: "east",
  sunElevation: "35°",
  intensity: "natural",
  shadowLength: "medium",
  shadowSoftness: "soft",
  ambientLight: "balanced",
  artificialLighting: [],
  ...patch,
});

describe("local visual previews", () => {
  it("changes lighting sky and sun position with time and direction", () => {
    const { rerender, container } = render(<LightingPreview lighting={lighting()} />);
    const firstSunX = container.querySelector('[data-testid="preview-sun"]')?.getAttribute("cx");
    const firstSkyTime = container
      .querySelector('[data-testid="preview-sky"]')
      ?.getAttribute("data-time");
    rerender(<LightingPreview lighting={lighting({ timeOfDay: "night", sunDirection: "west" })} />);
    expect(container.querySelector('[data-testid="preview-sky"]')?.getAttribute("data-time")).toBe(
      "night",
    );
    expect(container.querySelector('[data-testid="preview-sun"]')?.getAttribute("cx")).not.toBe(
      firstSunX,
    );
    expect(
      container.querySelector('[data-testid="preview-sky"]')?.getAttribute("data-time"),
    ).not.toBe(firstSkyTime);
  });

  it("renders one visual thumbnail for every lighting and mood preset", () => {
    const { rerender } = render(
      <LightingPresetCards
        lighting={lighting()}
        presets={[
          { id: "morning", label: "Morning", tags: [], values: { timeOfDay: "morning" } },
          { id: "night", label: "Night", tags: [], values: { timeOfDay: "night" } },
        ]}
      />,
    );
    expect(screen.getAllByTestId("lighting-preset-thumbnail")).toHaveLength(2);
    rerender(
      <MoodPresetCards
        presets={[
          { id: "calm", label: "Calm", values: { warmth: "cool" } },
          { id: "warm", label: "Warm", values: { warmth: "warm" } },
        ]}
      />,
    );
    expect(screen.getAllByTestId("mood-preset-thumbnail")).toHaveLength(2);
  });

  it("uses a selected grade image when provided and falls back to the SVG scene", () => {
    const asset = {
      id: "MASTER",
      projectId: "P",
      status: "ready",
      role: "master_architecture",
      absolutePath: "data:image/png;base64,ZmFrZQ==",
    } as AssetDTO;
    const { rerender } = render(<GradePreview asset={asset} grade={neutralGrade()} />);
    expect(screen.getByTestId("grade-preview-image").getAttribute("data-asset-id")).toBe("MASTER");
    const masterCards = render(
      <GradePresetCards
        asset={asset}
        presets={[
          { id: "neutral", label: "Neutral", grade: neutralGrade() },
          { id: "warm", label: "Warm", grade: { ...neutralGrade(), temperature: 30 } },
        ]}
      />,
    );
    expect(
      masterCards.container.querySelectorAll('[data-testid="grade-preview-image"]'),
    ).toHaveLength(2);
    rerender(<GradePreview asset={null} grade={neutralGrade()} />);
    expect(screen.getByTestId("grade-preview-fallback")).toBeTruthy();
  });

  it("keeps the before image visible and clips the graded image at the split value", () => {
    const asset = {
      id: "MASTER",
      projectId: "P",
      status: "ready",
      role: "master_architecture",
      absolutePath: "data:image/png;base64,ZmFrZQ==",
    } as AssetDTO;
    render(<GradePreview asset={asset} grade={neutralGrade()} />);
    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    const slider = screen.getByRole("slider", { name: "Split" });
    fireEvent.change(slider, { target: { value: "35" } });
    const preview = screen.getByTestId("grade-preview-image");
    expect(preview.querySelector(".grade-image-before")).toBeTruthy();
    expect(preview.querySelector(".grade-image-after")).toBeTruthy();
    const before = preview.querySelector(".grade-image-before");
    const graded = preview.querySelector(".grade-image-after");
    expect(before?.getAttribute("src")).toBe(graded?.getAttribute("src"));
    expect(graded?.getAttribute("style")).toContain("inset(0 65% 0 0)");
  });

  it("assigns every mood preset in every knowledge pack a distinct palette and tone", () => {
    const projectTypes = ProjectTypeSchema.options;
    for (const type of projectTypes) {
      for (const pack of knowledge.listSubtypes(type)) {
        const { container, unmount } = render(
          <MoodPresetCards
            presets={pack.moodPresets.map((preset) => ({
              id: preset.id,
              label: preset.label,
              values: preset.values,
            }))}
          />,
        );
        const thumbnails = [...container.querySelectorAll("[data-testid='mood-preview']")].filter(
          (node) => node.classList.contains("mood-preview-compact"),
        );
        expect(thumbnails).toHaveLength(pack.moodPresets.length);
        const palettes = thumbnails.map((node) =>
          [...node.querySelectorAll(".mood-palette span")]
            .map((swatch) => (swatch as HTMLElement).style.backgroundColor)
            .join("|"),
        );
        expect(new Set(palettes).size).toBe(pack.moodPresets.length);
        expect(
          new Set(
            thumbnails.map((node) => (node as HTMLElement).style.getPropertyValue("--mood-tint")),
          ).size,
        ).toBe(pack.moodPresets.length);
        unmount();
      }
    }
  });

  it("draws attached, corner and open site conditions and interior daylight", () => {
    const base = {
      schemaVersion: 1,
      front: { roadType: "alley", vegetation: ["tree"] },
    } as ContextDNA;
    const { rerender, container } = render(
      <ContextPreview
        context={{
          ...base,
          siteTopology: { left: "attached", right: "attached", cornerLot: false },
        }}
      />,
    );
    expect(
      container.querySelector('[data-testid="context-preview"]')?.getAttribute("data-left"),
    ).toBe("attached");
    expect(
      container.querySelector('[data-testid="context-neighbor-left"]')?.getAttribute("x"),
    ).toBe("38");
    rerender(
      <ContextPreview
        context={{
          ...base,
          siteTopology: { left: "open", right: "unknown", cornerLot: true, cornerSide: "left" },
        }}
      />,
    );
    expect(
      container.querySelector('[data-testid="context-preview"]')?.getAttribute("data-corner-side"),
    ).toBe("left");
    expect(container.querySelector('[data-testid="context-side-street"]')).toBeTruthy();
    rerender(
      <ContextPreview
        context={{ ...base, siteTopology: { left: "open", right: "open", cornerLot: false } }}
      />,
    );
    expect(
      container.querySelector('[data-testid="context-neighbor-left"]')?.getAttribute("x"),
    ).toBe("24");
    rerender(<ContextPreview projectType="interior" daylightDirection="right" />);
    expect(
      container
        .querySelector('[data-testid="interior-context-preview"]')
        ?.getAttribute("data-daylight"),
    ).toBe("right");
  });

  it("localizes SVG titles in Vietnamese and English", () => {
    expect(translate("vi", "previews.lightingTitle")).toBe("Bản xem trước ánh sáng");
    expect(translate("en", "previews.lightingTitle")).toBe("Lighting preview");
    const { container, rerender } = render(<LightingPreview lighting={lighting()} locale="vi" />);
    expect(container.querySelector("title")?.textContent).toBe("Bản xem trước ánh sáng");
    rerender(<LightingPreview lighting={lighting()} locale="en" />);
    expect(container.querySelector("title")?.textContent).toBe("Lighting preview");
  });

  it("renders a mini context diagram for every context preset", () => {
    const context = {
      schemaVersion: 1,
      front: { roadType: "alley", elements: [], vegetation: [], adjacentBuildings: [], notes: "" },
      rear: { elements: [], vegetation: [], adjacentBuildings: [], notes: "" },
      left: { elements: [], vegetation: [], adjacentBuildings: [], notes: "" },
      right: { elements: [], vegetation: [], adjacentBuildings: [], notes: "" },
      distantBackground: [],
      atmosphereNotes: "",
      negativeConstraints: [],
    } as ContextDNA;
    const { container } = render(
      <ContextPresetCards
        context={context}
        presets={[
          { id: "dense", label: "Dense", context: { density: "high" } },
          { id: "open", label: "Open", context: { density: "low" } },
        ]}
        onChoose={() => undefined}
      />,
    );
    expect(container.querySelectorAll('[data-testid="context-preset-thumbnail"]')).toHaveLength(2);
    // Each card includes both its compact diagram and the larger hover/focus preview.
    expect(container.querySelectorAll('[data-testid="context-preview"]')).toHaveLength(4);
  });
});
