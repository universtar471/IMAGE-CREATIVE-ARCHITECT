import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("preset photos", () => {
  it("renders style-card photos and keeps the fallback when a style photo is missing", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: 1,
        items: {
          "style/modern": { src: "previews/style/modern.webp", w: 640, h: 438 },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { PhotoThumbnail } = await import("../src/features/previews/PhotoThumbnail");
    render(
      <>
        <button type="button">
          <PhotoThumbnail kind="style" presetId="modern" label="Modern">
            <span>Modern fallback</span>
          </PhotoThumbnail>
          <span>Modern</span>
        </button>
        <button type="button">
          <PhotoThumbnail kind="style" presetId="missing" label="Missing">
            <span>Missing fallback</span>
          </PhotoThumbnail>
          <span>Missing</span>
        </button>
      </>,
    );
    await waitFor(() => expect(screen.getByRole("img", { name: "Modern" })).toBeTruthy());
    const image = screen.getByRole("img", { name: "Modern" }) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/previews/style/modern.webp");
    expect(image.getAttribute("loading")).toBe("lazy");
    expect(image.alt).toBe("Modern");
    expect(screen.getByText("Missing fallback")).toBeTruthy();
    expect(image.style.objectFit).toBe("contain");
  });

  it("loads the manifest once and chooses interior photos before exterior ones", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        version: 1,
        items: {
          "lighting/morning": { src: "previews/lighting/morning.webp", w: 640, h: 438 },
          "lighting_interior/morning": {
            src: "previews/lighting_interior/morning.webp",
            w: 640,
            h: 438,
          },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { PhotoThumbnail } = await import("../src/features/previews/PhotoThumbnail");
    render(
      <>
        <PhotoThumbnail kind="lighting" presetId="morning" label="Morning" interior>
          <span>SVG</span>
        </PhotoThumbnail>
        <PhotoThumbnail kind="lighting" presetId="morning" label="Morning">
          <span>SVG</span>
        </PhotoThumbnail>
      </>,
    );
    await waitFor(() => expect(screen.getAllByRole("img", { name: "Morning" })).toHaveLength(2));
    expect(screen.getAllByRole("img", { name: "Morning" })[0]?.getAttribute("src")).toBe(
      "/previews/lighting_interior/morning.webp",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.error(screen.getAllByRole("img", { name: "Morning" })[0]!);
    expect(screen.getByText("SVG")).toBeTruthy();
  });

  it("uses the SVG on fetch failure or missing photos", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { PhotoThumbnail } = await import("../src/features/previews/PhotoThumbnail");
    const { loadPreviewPhotos } = await import("../src/lib/previewPhotos");
    expect(await loadPreviewPhotos()).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/previews/manifest.json");
    render(
      <PhotoThumbnail kind="context" presetId="unknown" label="Unknown">
        <span>SVG fallback</span>
      </PhotoThumbnail>,
    );
    expect(screen.getByText("SVG fallback")).toBeTruthy();
  });
});
