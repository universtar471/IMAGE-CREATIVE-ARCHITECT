/**
 * Grade UI v2 (ADR-031/032, API §21.3): gallery categories and style badge, slider groups,
 * debounced v2 live preview, LUT library, batch dialog. Mock backend / stubbed transport only.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GRADE_LOOKS,
  GRADE_STYLE_PRESETS,
  type AssetDTO,
  type ColorGradeDNA,
  type ProjectDNA,
} from "@arch/domain";
import { BridgeError, setTransport, type LutItem, type Transport } from "../src/lib/bridge";
import { createMockTransport } from "../src/lib/mockBackend";
import { neutralGrade } from "../src/lib/grade";
import { createProject } from "../src/app/services";
import { useStudio } from "../src/app/store";
import { GradeLookGallery } from "../src/features/mood/GradeLookGallery";
import { GradeCanvas, GRADE_PREVIEW_DEBOUNCE_MS } from "../src/features/mood/GradeCanvas";
import {
  GradeSliders,
  keyboardStep,
  setSliderValue,
  type SliderSpec,
} from "../src/features/mood/GradeSliders";
import {
  chooseGradePreset,
  matchingStylePresets,
  projectStyleKeys,
  stylePresetGrade,
  withLut,
  withLutStrength,
} from "../src/features/mood/gradePresets";
import { BatchGradeDialog } from "../src/features/mood/BatchGradeDialog";
import { LutLibrary } from "../src/features/luts/LutLibrary";
import { groupLuts, LUT_PAGE_SIZE } from "../src/features/luts/lutApi";
import { useLazyThumbnail } from "../src/features/luts/useLazyThumbnail";
import { exposureBrightness, gradeFilter } from "../src/features/previews/GradePreview";
import { en } from "../src/i18n/en";
import { vi as viDict } from "../src/i18n/vi";
import { asset } from "./helpers";

type Call = { command: string; request: Record<string, unknown> };

/** A transport that records calls and answers from `handlers` (unknown → error). */
function stubTransport(handlers: Record<string, (request: never) => unknown>) {
  const calls: Call[] = [];
  const transport = (async (command: string, args: { request: unknown }) => {
    calls.push({ command, request: args.request as Record<string, unknown> });
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler(args.request as never);
  }) as unknown as Transport;
  setTransport(transport);
  return calls;
}

const jpeg = (tag: string) => new Blob([tag], { type: "image/jpeg" });

let urlSeq = 0;
beforeEach(() => {
  urlSeq = 0;
  URL.createObjectURL = vi.fn(() => `blob:thumb-${++urlSeq}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  setTransport(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function lut(id: string, over: Partial<LutItem> = {}): LutItem {
  return {
    id,
    sourceId: "SRC",
    relPath: `Pack/Cat/${id}.cube`,
    pack: "Pack",
    category: "Cat",
    name: `LUT ${id}`,
    size: 33,
    isLog: false,
    favorite: false,
    status: "ok",
    ...over,
  };
}

// ------------------------------------------------------------------ presets and style

describe("style presets and the project style badge", () => {
  it("finds presets from the interior style id and the exterior style key", () => {
    const interior = { interior: { styleId: "japandi" } } as unknown as ProjectDNA;
    expect([...matchingStylePresets(interior)]).toEqual(["earthy_muted"]);
    const exterior = {
      building: { architecturalStyle: "Industrial modern" },
    } as unknown as ProjectDNA;
    expect(projectStyleKeys(exterior)).toEqual(["industrial_modern", "industrial", "modern"]);
    expect([...matchingStylePresets(exterior)]).toEqual(["concrete_steel"]);
    const neo = { building: { architecturalStyle: "Neo classic" } } as unknown as ProjectDNA;
    expect([...matchingStylePresets(neo)]).toEqual(["heritage_warmth"]);
    expect(matchingStylePresets(null).size).toBe(0);
  });

  it("builds a full grade from a style preset and keeps the LUT when a look is chosen", () => {
    const grade = stylePresetGrade("heritage_warmth");
    expect(grade.schemaVersion).toBe(1);
    expect(grade.look).toBe("heritage_warmth");
    expect(grade.toneCurve).toBe("soft_s");
    expect(grade.splitTone).toEqual(GRADE_STYLE_PRESETS.heritage_warmth.grade.splitTone);
    expect(grade.splitTone).not.toBe(GRADE_STYLE_PRESETS.heritage_warmth.grade.splitTone);
    const withAlut = withLut(neutralGrade(), "L1");
    const chosen = chooseGradePreset(withAlut, "warm_tropical")!;
    expect(chosen.temperature).toBe(GRADE_LOOKS.warm_tropical.temperature);
    expect(chosen.lut).toEqual({ lutId: "L1", strength: 70 });
    expect(chooseGradePreset(neutralGrade(), "nope")).toBeNull();
  });

  it("selecting a LUT sets strength 70, re-selecting keeps the strength, null clears it", () => {
    const first = withLut(neutralGrade(), "A");
    expect(first.lut).toEqual({ lutId: "A", strength: 70 });
    const weaker = withLutStrength(first, 35.4);
    expect(weaker.lut).toEqual({ lutId: "A", strength: 35 });
    expect(withLut(weaker, "A").lut?.strength).toBe(35);
    expect(withLut(weaker, "B").lut).toEqual({ lutId: "B", strength: 70 });
    expect("lut" in withLut(weaker, null)).toBe(false);
  });
});

// ------------------------------------------------------------------ gallery

describe("gallery categories", () => {
  it("offers the six look groups plus style and LUT; style tiles use 256 px grade_preview", async () => {
    const calls = stubTransport({
      asset_preview: () => {
        throw new Error("no canvas in this test");
      },
      grade_preview: () => jpeg("style"),
      lut_list: () => ({ items: [], total: 0 }),
      lut_source_list: () => [],
    });
    const onChange = vi.fn();
    const onLut = vi.fn();
    render(
      <GradeLookGallery
        asset={asset("P", "SRC")}
        styleMatches={new Set(["earthy_muted"])}
        onChange={onChange}
        onLut={onLut}
      />,
    );
    const categories = screen
      .getAllByRole("button")
      .filter((b) => b.dataset.testid?.startsWith("grade-category-"))
      .map((b) => b.dataset.testid!.replace("grade-category-", ""));
    expect(categories).toEqual([
      "all",
      "natural",
      "warm",
      "cool",
      "editorial",
      "cinematic",
      "special",
      "style",
      "lut",
    ]);
    expect(screen.getAllByTestId(/^grade-look-/).length).toBeGreaterThanOrEqual(30);

    fireEvent.click(screen.getByTestId("grade-category-style"));
    expect(screen.queryAllByTestId(/^grade-look-(?!gallery)/)).toHaveLength(0);
    for (const id of Object.keys(GRADE_STYLE_PRESETS)) {
      expect(screen.getByTestId(`grade-style-${id}`)).toBeTruthy();
    }
    // The badge marks only presets matching the project style.
    expect(screen.getByTestId("grade-style-badge-earthy_muted").textContent).toBe(
      en.moodGrade.styleMatch,
    );
    expect(screen.queryByTestId("grade-style-badge-concrete_steel")).toBeNull();
    await waitFor(() => expect(calls.filter((c) => c.command === "grade_preview")).toHaveLength(5));
    const previews = calls.filter((c) => c.command === "grade_preview");
    expect(previews.every((c) => c.request.size === 256)).toBe(true);
    expect(previews[0]!.request.grade).toEqual(stylePresetGrade("earthy_muted"));
    await waitFor(() =>
      expect(
        screen.getByTestId("grade-style-earthy_muted").querySelector("img")?.getAttribute("src"),
      ).toMatch(/^blob:thumb-/),
    );
    fireEvent.click(screen.getByTestId("grade-style-concrete_steel"));
    expect(onChange).toHaveBeenCalledWith("concrete_steel");

    fireEvent.click(screen.getByTestId("grade-category-lut"));
    expect(await screen.findByTestId("lut-library-panel")).toBeTruthy();
  });

  it("hides the LUT tab when no LUT handler is given", () => {
    stubTransport({ asset_preview: () => jpeg("x") });
    render(<GradeLookGallery asset={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId("grade-category-lut")).toBeNull();
    expect(screen.getByTestId("grade-category-style")).toBeTruthy();
  });

  it("loads thumbnails only when IntersectionObserver reports the tile visible", async () => {
    const observers: Array<{ cb: IntersectionObserverCallback; el?: Element }> = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        entry: { cb: IntersectionObserverCallback; el?: Element };
        constructor(cb: IntersectionObserverCallback) {
          this.entry = { cb };
          observers.push(this.entry);
        }
        observe(el: Element) {
          this.entry.el = el;
        }
        disconnect() {}
      },
    );
    const calls = stubTransport({ grade_preview: () => jpeg("style") });
    render(<GradeLookGallery asset={asset("P", "SRC")} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("grade-category-style"));
    await act(async () => {});
    expect(calls.filter((c) => c.command === "grade_preview")).toHaveLength(0);
    const tile = observers.find((o) => o.el === screen.getByTestId("grade-style-clean_editorial"))!;
    act(() => tile.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as never));
    await waitFor(() => expect(calls.filter((c) => c.command === "grade_preview")).toHaveLength(1));
    expect(calls.find((c) => c.command === "grade_preview")!.request.grade).toEqual(
      stylePresetGrade("clean_editorial"),
    );
  });
});

describe("lazy thumbnail hook", () => {
  function Probe({ k, load }: { k: string; load: () => Promise<Blob> }) {
    const state = useLazyThumbnail(k, true, load);
    return <span data-testid="probe">{`${state.url}|${state.error}`}</span>;
  }

  it("never lets an older response overwrite a newer one", async () => {
    let releaseOld!: (b: Blob) => void;
    const old = new Promise<Blob>((resolve) => (releaseOld = resolve));
    const { rerender } = render(<Probe k="a" load={() => old} />);
    rerender(<Probe k="b" load={async () => jpeg("new")} />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("blob:thumb-1|null"));
    await act(async () => releaseOld(jpeg("old")));
    expect(screen.getByTestId("probe").textContent).toBe("blob:thumb-1|null");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("reports a NOT_FOUND preview as missing", async () => {
    render(
      <Probe
        k="a"
        load={async () => {
          throw new BridgeError({ code: "NOT_FOUND", message: "gone" });
        }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe("null|missing"));
  });
});

// ------------------------------------------------------------------ sliders

describe("grade panel v2 sliders", () => {
  const exposure: SliderSpec = { kind: "flat", key: "exposure", min: -100, max: 100 };
  const grain: SliderSpec = { kind: "flat", key: "grain", min: 0, max: 100 };
  const shadowsSat: SliderSpec = { kind: "split", key: "shadowsSat", min: 0, max: 100 };

  it("clamps, clears the look, and drops neutral optional fields", () => {
    const warm = { ...GRADE_LOOKS.warm_tropical };
    const next = setSliderValue(warm, exposure, 250);
    expect(next.exposure).toBe(100);
    expect(next.look).toBeUndefined();
    const grained = setSliderValue(neutralGrade(), grain, 30);
    expect(grained.grain).toBe(30);
    expect("grain" in setSliderValue(grained, grain, 0)).toBe(false);
    const toned = setSliderValue(neutralGrade(), shadowsSat, 40);
    expect(toned.splitTone).toEqual({
      shadowsHue: 0,
      shadowsSat: 40,
      highlightsHue: 0,
      highlightsSat: 0,
      balance: 0,
    });
    expect("splitTone" in setSliderValue(toned, shadowsSat, 0)).toBe(false);
  });

  it("maps keys to steps", () => {
    expect(keyboardStep({ key: "ArrowRight", shiftKey: false }, exposure)).toBe(1);
    expect(keyboardStep({ key: "ArrowLeft", shiftKey: true }, exposure)).toBe(-10);
    expect(keyboardStep({ key: "PageUp", shiftKey: false }, exposure)).toBe(10);
    expect(keyboardStep({ key: "End", shiftKey: false }, exposure)).toBe(200);
    expect(keyboardStep({ key: "a", shiftKey: false }, exposure)).toBe(0);
  });

  it("renders the §21.3 groups with range labels, double-click reset and keyboard steps", () => {
    const onChange = vi.fn();
    const grade = { ...neutralGrade(), exposure: 40, look: "warm_tropical" };
    render(<GradeSliders grade={grade} disabled={false} onChange={onChange} />);
    const groups = [...document.querySelectorAll(".grade-group > summary")].map(
      (s) => s.textContent,
    );
    expect(groups).toEqual(["Light", "Colour", "Effects", "Split toning", "Tone curve"]);
    const row = screen.getByTestId("grade-slider-exposure");
    expect([...row.querySelectorAll(".grade-slider-range")].map((n) => n.textContent)).toEqual([
      "−100",
      "100",
    ]);
    expect(
      [...screen.getByTestId("grade-slider-grain").querySelectorAll(".grade-slider-range")].map(
        (n) => n.textContent,
      ),
    ).toEqual(["0", "100"]);
    const input = screen.getByRole("slider", { name: "Exposure" });
    fireEvent.doubleClick(input);
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ exposure: 0, look: undefined });
    fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true });
    expect(onChange.mock.lastCall?.[0].exposure).toBe(50);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onChange.mock.lastCall?.[0].exposure).toBe(39);
    fireEvent.change(screen.getByRole("combobox", { name: "Tone curve" }), {
      target: { value: "matte" },
    });
    expect(onChange.mock.lastCall?.[0].toneCurve).toBe("matte");
  });
});

// ------------------------------------------------------------------ live preview

describe("GradeCanvas v2 live preview", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  /** Pixel value per decoded image tag: the original is 10, backend renders 100+. */
  function installCanvas() {
    class TestImageData {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    let lastDrawn = "original";
    const value = (tag: string) => (tag === "original" ? 10 : tag === "A" ? 100 : 200);
    vi.stubGlobal("ImageData", TestImageData);
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async (blob: Blob) => ({
        tag: blob.type === "image/png" ? "original" : await blob.text(),
        width: 2,
        height: 1,
        close: vi.fn(),
      })),
    );
    const putImageData = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: (bitmap: { tag: string }) => {
        lastDrawn = bitmap.tag;
      },
      getImageData: () => {
        const v = value(lastDrawn);
        return new TestImageData(new Uint8ClampedArray([v, v, v, 255, v, v, v, 255]), 2, 1);
      },
      putImageData,
      fillRect: vi.fn(),
      fillStyle: "",
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    return { putImageData };
  }

  const lutGrade = (strength: number): ColorGradeDNA => ({
    ...neutralGrade(),
    lut: { lutId: "L", strength },
  });

  it("debounces grade_preview at 120 ms and sends only the latest grade", async () => {
    const { putImageData } = installCanvas();
    const calls = stubTransport({
      asset_preview: () => new Blob(["src"], { type: "image/png" }),
      grade_preview: () => jpeg("B"),
    });
    const image = asset("P", "SRC");
    const { rerender } = render(<GradeCanvas asset={image} grade={lutGrade(10)} />);
    await waitFor(() => expect(calls.some((c) => c.command === "asset_preview")).toBe(true));
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    rerender(<GradeCanvas asset={image} grade={lutGrade(20)} />);
    rerender(<GradeCanvas asset={image} grade={lutGrade(30)} />);
    expect(calls.filter((c) => c.command === "grade_preview")).toHaveLength(0);
    await new Promise((r) => setTimeout(r, GRADE_PREVIEW_DEBOUNCE_MS + 60));
    const previews = calls.filter((c) => c.command === "grade_preview");
    expect(previews).toHaveLength(1);
    expect(previews[0]!.request).toMatchObject({
      projectId: "P",
      assetId: "SRC",
      size: 640,
      grade: { lut: { lutId: "L", strength: 30 } },
    });
    await waitFor(() => expect((putImageData.mock.lastCall?.[0] as ImageData).data[0]).toBe(200));
    expect(screen.getByTestId("grade-preview").dataset.engine).toBe("v2");
  });

  it("ignores a stale grade_preview answer and keeps Before/Split on the original", async () => {
    const { putImageData } = installCanvas();
    const pending: Array<(blob: Blob) => void> = [];
    const calls = stubTransport({
      asset_preview: () => new Blob(["src"], { type: "image/png" }),
      grade_preview: () => new Promise<Blob>((resolve) => pending.push(resolve)),
    });
    const image = asset("P", "SRC");
    const { rerender } = render(<GradeCanvas asset={image} grade={lutGrade(10)} />);
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(<GradeCanvas asset={image} grade={lutGrade(90)} />);
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]!(jpeg("B")));
    await waitFor(() => expect((putImageData.mock.lastCall?.[0] as ImageData).data[0]).toBe(200));
    await act(async () => pending[0]!(jpeg("A")));
    await new Promise((r) => setTimeout(r, 20));
    expect((putImageData.mock.lastCall?.[0] as ImageData).data[0]).toBe(200);
    expect(calls.filter((c) => c.command === "grade_preview")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Split" }));
    await waitFor(() => expect(putImageData.mock.lastCall?.length).toBe(7));
    expect(putImageData.mock.lastCall?.slice(1)).toEqual([0, 0, 0, 0, 1, 1]);
    expect((putImageData.mock.lastCall?.[0] as ImageData).data[0]).toBe(10);
    fireEvent.click(screen.getByRole("button", { name: "Before" }));
    await waitFor(() => expect((putImageData.mock.lastCall?.[0] as ImageData).data[0]).toBe(10));
  });

  it("keeps the TypeScript v1 path (no grade_preview) for v1-only grades", async () => {
    const { putImageData } = installCanvas();
    const calls = stubTransport({
      asset_preview: () => new Blob(["src"], { type: "image/png" }),
    });
    render(<GradeCanvas asset={asset("P", "SRC")} grade={{ ...neutralGrade(), exposure: 60 }} />);
    await waitFor(() => expect(putImageData).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, GRADE_PREVIEW_DEBOUNCE_MS + 30));
    expect(calls.some((c) => c.command === "grade_preview")).toBe(false);
    expect(screen.getByTestId("grade-preview").dataset.engine).toBe("v1");
  });
});

// ------------------------------------------------------------------ LUT library

describe("LUT library", () => {
  function lutBackend(items: LutItem[], extra: Record<string, (r: never) => unknown> = {}) {
    return stubTransport({
      lut_list: (r: { limit: number; offset: number }) => ({
        items: items.slice(r.offset, r.offset + r.limit),
        total: items.length,
      }),
      lut_source_list: () => [
        {
          id: "SRC",
          path: "D:/LUTs/Bay",
          addedAt: "2026-10-01T00:00:00Z",
          lastScanAt: "2026-10-01T00:00:00Z",
          lutCount: items.length,
        },
      ],
      lut_preview: () => jpeg("lut"),
      ...extra,
    });
  }

  it("pages by 60 with the architecture filter on by default", async () => {
    const items = Array.from({ length: 130 }, (_, i) => lut(`L${String(i).padStart(3, "0")}`));
    const calls = lutBackend(items);
    render(<LutLibrary asset={asset("P", "SRC")} onSelect={vi.fn()} onStrength={vi.fn()} />);
    expect((screen.getByTestId("lut-arch-filter") as HTMLInputElement).checked).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId("lut-page").textContent).toBe("Page 1/3 · 130 LUTs"),
    );
    const first = calls.find((c) => c.command === "lut_list")!.request;
    expect(first).toMatchObject({ archOnly: true, favoritesOnly: false, limit: 60, offset: 0 });
    expect(screen.getAllByTestId(/^lut-tile-/)).toHaveLength(LUT_PAGE_SIZE);
    fireEvent.click(screen.getByTestId("lut-next-page"));
    await waitFor(() =>
      expect(screen.getByTestId("lut-page").textContent).toBe("Page 2/3 · 130 LUTs"),
    );
    expect(calls.filter((c) => c.command === "lut_list").at(-1)!.request.offset).toBe(60);
    fireEvent.click(screen.getByTestId("lut-arch-filter"));
    await waitFor(() =>
      expect(calls.filter((c) => c.command === "lut_list").at(-1)!.request).toMatchObject({
        archOnly: false,
        offset: 0,
      }),
    );
  });

  it("shows the log badge, the missing state, and selects with a strength slider", async () => {
    lutBackend(
      [
        lut("LOG", { name: "S-Log3 Urban", isLog: true }),
        lut("GONE", { status: "missing" }),
        lut("OK"),
      ],
      {
        lut_preview: (r: { lutId: string }) => {
          if (r.lutId === "OK") throw { code: "NOT_FOUND", message: "file moved" };
          return jpeg("lut");
        },
      },
    );
    const onSelect = vi.fn();
    const onStrength = vi.fn();
    const { rerender } = render(
      <LutLibrary asset={asset("P", "SRC")} onSelect={onSelect} onStrength={onStrength} />,
    );
    const logTile = await screen.findByTestId("lut-tile-LOG");
    expect(logTile.querySelector('[data-testid="lut-log-badge"]')?.textContent).toBe(
      en.luts.logBadge,
    );
    const gone = screen.getByTestId("lut-tile-GONE");
    expect(gone.querySelector('[data-testid="lut-missing"]')?.textContent).toBe("File not found");
    expect(gone.querySelector("button.lut-tile-pick")?.hasAttribute("disabled")).toBe(true);
    // A preview answered NOT_FOUND also shows the missing state.
    await waitFor(() =>
      expect(
        screen.getByTestId("lut-tile-OK").querySelector('[data-testid="lut-missing"]'),
      ).toBeTruthy(),
    );
    fireEvent.click(logTile.querySelector("button.lut-tile-pick")!);
    expect(onSelect).toHaveBeenCalledWith("LOG");
    rerender(
      <LutLibrary
        asset={asset("P", "SRC")}
        selectedLutId="LOG"
        strength={70}
        onSelect={onSelect}
        onStrength={onStrength}
      />,
    );
    const slider = screen.getByTestId("lut-strength") as HTMLInputElement;
    expect(slider.value).toBe("70");
    fireEvent.change(slider, { target: { value: "45" } });
    expect(onStrength).toHaveBeenCalledWith(45);
  });

  it("asks for confirmation before removing a source", async () => {
    const calls = lutBackend([lut("A")], { lut_source_remove: () => null });
    render(<LutLibrary asset={null} onSelect={vi.fn()} onStrength={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    fireEvent.click(await screen.findByTestId("lut-remove-SRC"));
    expect(screen.getByRole("dialog", { name: "Remove LUT folder" })).toBeTruthy();
    expect(calls.some((c) => c.command === "lut_source_remove")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(calls.some((c) => c.command === "lut_source_remove")).toBe(false);
    fireEvent.click(screen.getByTestId("lut-remove-SRC"));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(calls.find((c) => c.command === "lut_source_remove")?.request).toEqual({
        sourceId: "SRC",
      }),
    );
  });

  it("adds a folder and shows the scan summary (mock backend)", async () => {
    setTransport(createMockTransport({ projects: {}, dna: {}, assets: {}, versions: [] }));
    vi.spyOn(window, "prompt").mockReturnValue("D:/LUTs");
    render(<LutLibrary asset={null} onSelect={vi.fn()} onStrength={vi.fn()} />);
    fireEvent.click(screen.getByTestId("lut-add-folder"));
    await waitFor(() =>
      expect(screen.getByTestId("lut-summary").textContent).toBe(
        "Scan finished: 4 LUTs added, 0 invalid files.",
      ),
    );
    // Architecture filter on: the mock hides "Portrait Wedding" and the log LUT.
    await waitFor(() => expect(screen.getAllByTestId(/^lut-tile-/)).toHaveLength(2));
  });

  it("groups a page by pack and category", () => {
    const groups = groupLuts([
      lut("1", { pack: "Urban", category: "night" }),
      lut("2", { pack: "Aerial", category: "drone" }),
      lut("3", { pack: "Urban", category: "night" }),
    ]);
    expect(groups.map((g) => [g.pack, g.category, g.items.map((i) => i.id)])).toEqual([
      ["Aerial", "drone", ["2"]],
      ["Urban", "night", ["1", "3"]],
    ]);
  });
});

// ------------------------------------------------------------------ batch dialog

describe("batch colour grade dialog", () => {
  async function openWorkspace(ids: string[], archived = false) {
    const db = { projects: {}, dna: {}, assets: {}, versions: [] } as NonNullable<
      Parameters<typeof createMockTransport>[0]
    >;
    const base = createMockTransport(db);
    setTransport(base);
    const project = await createProject({
      name: "Batch",
      projectType: "villa",
      subtype: "tropical",
      starter: { floors: 2 },
    });
    ids.forEach((id, index) => {
      db.assets[id] = asset(project.id, id, {
        source: "ai_generated",
        createdAt: `2026-01-0${index + 1}T00:00:00Z`,
      }) as AssetDTO;
    });
    if (archived) db.projects[project.id]!.archivedAt = "2026-01-09T00:00:00Z";
    await useStudio.getState().openProject(project.id);
    return { base, projectId: project.id };
  }

  it("stops after the current image, resumes the rest and retries failures", async () => {
    const { base } = await openWorkspace(["A", "B", "C"]);
    let hold: (() => void) | null = null;
    let failB = true;
    const applied: string[] = [];
    const wrapped = (async (command, args) => {
      if (command === "grade_apply") {
        const request = args.request as { assetId: string; grade: ColorGradeDNA };
        applied.push(request.assetId);
        if (applied.length === 1) {
          await new Promise<void>((resolve) => (hold = resolve));
        }
        if (request.assetId === "B" && failB) throw { code: "IO_ERROR", message: "disk busy" };
      }
      return base(command, args);
    }) as Transport;
    setTransport(wrapped);
    const draftBefore = JSON.stringify(useStudio.getState().workspace!.draftDna.colorGrade);
    render(<BatchGradeDialog onClose={vi.fn()} />);
    for (const id of ["A", "B", "C"]) fireEvent.click(screen.getByTestId(`batch-grade-tile-${id}`));
    fireEvent.click(screen.getByTestId("batch-grade-run"));
    await waitFor(() => expect(hold).not.toBeNull());
    fireEvent.click(screen.getByTestId("batch-grade-stop"));
    await act(async () => hold!());
    // The stop request is honoured after the current image: one write, two remaining.
    expect((await screen.findByTestId("batch-grade-resume")).textContent).toContain("2");
    expect(applied).toHaveLength(1);
    fireEvent.click(screen.getByTestId("batch-grade-resume"));
    await screen.findByTestId("batch-grade-retry");
    expect([...applied].sort()).toEqual(["A", "B", "C"]);
    expect(screen.queryByTestId("batch-grade-resume")).toBeNull();
    failB = false;
    fireEvent.click(screen.getByTestId("batch-grade-retry"));
    await waitFor(() => expect(screen.queryByTestId("batch-grade-retry")).toBeNull());
    expect(applied).toHaveLength(4);
    expect(applied[3]).toBe("B");
    expect(JSON.stringify(useStudio.getState().workspace!.draftDna.colorGrade)).toBe(draftBefore);
  });

  it("sends a style preset scaled by the intensity through grade_apply", async () => {
    const { base } = await openWorkspace(["A"]);
    const grades: ColorGradeDNA[] = [];
    setTransport((async (command, args) => {
      if (command === "grade_apply") grades.push((args.request as { grade: ColorGradeDNA }).grade);
      return base(command, args);
    }) as Transport);
    render(<BatchGradeDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("batch-grade-look"), {
      target: { value: "concrete_steel" },
    });
    fireEvent.change(screen.getByRole("slider", { name: /Intensity/ }), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByTestId("batch-grade-tile-A"));
    fireEvent.click(screen.getByTestId("batch-grade-run"));
    await waitFor(() => expect(grades).toHaveLength(1));
    expect(grades[0]).toMatchObject({
      contrast: 15,
      clarity: 30,
      toneCurve: "strong_s",
      look: "concrete_steel",
    });
  });

  it("is disabled for a read-only project", async () => {
    await openWorkspace(["A"], true);
    render(<BatchGradeDialog onClose={vi.fn()} />);
    expect(screen.getByTestId("batch-grade-readonly")).toBeTruthy();
    expect((screen.getByTestId("batch-grade-run") as HTMLButtonElement).disabled).toBe(true);
  });
});

// ------------------------------------------------------------------ CSS preview, strings

describe("CSS grade preview exposure scale", () => {
  it("maps −100..100 to ±1 stop instead of the old −5..5 scale", () => {
    expect(exposureBrightness(0)).toBe(1);
    expect(exposureBrightness(100)).toBeCloseTo(2 ** (1 / 2.2), 3);
    expect(exposureBrightness(-100)).toBeCloseTo(2 ** (-1 / 2.2), 3);
    expect(exposureBrightness(500)).toBe(exposureBrightness(100));
    // Exposure 25 is a quarter stop, not the old clamp of 1 + 25/6 → 1.3.
    const brightness = Number(
      /brightness\(([\d.]+)\)/.exec(gradeFilter({ ...neutralGrade(), exposure: 25 }))![1],
    );
    expect(brightness).toBeGreaterThan(1.05);
    expect(brightness).toBeLessThan(1.1);
  });
});

describe("grade UI strings", () => {
  it("keeps the Vietnamese LUT and grade v2 labels accented", () => {
    expect(viDict.luts.logBadge).toBe("LUT cho video log — có thể gắt");
    expect(viDict.luts.missing).toBe("Không tìm thấy file");
    expect(viDict.luts.archOnly).toBe("Hợp kiến trúc");
    expect(viDict.moodGrade.gradeCategory.style).toBe("Hợp phong cách");
    expect(viDict.moodGrade.groups).toEqual({
      light: "Ánh sáng",
      color: "Màu",
      effects: "Hiệu ứng",
      split: "Tách tông",
      curve: "Đường cong",
    });
    for (const value of Object.values(viDict.moodGrade.fields)) expect(value).toMatch(/[À-ỹ]/);
  });
});
