import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SHOT_PRESETS } from "@arch/domain";
import { PREMIUM_ICON_IDS, PremiumIcon } from "../src/components/common/PremiumIcon";
import { groupVisualId, presetVisualId } from "../src/features/presets/presetVisuals";

afterEach(cleanup);

const icons = import.meta.glob<string>("../public/preset-icons/premium/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("Premium duotone integration", () => {
  it("ships every registered SVG and resolves every catalog and group icon", () => {
    const files = Object.keys(icons).map((path) => path.split("/").at(-1)!);
    expect(files.sort()).toEqual(PREMIUM_ICON_IDS.map((id) => `${id}.svg`).sort());
    for (const id of [...Object.values(groupVisualId), ...SHOT_PRESETS.map(presetVisualId)]) {
      expect(files).toContain(`${id}.svg`);
    }
    for (const [path, source] of Object.entries(icons)) {
      const file = path.split("/").at(-1)!;
      const doc = new DOMParser().parseFromString(source, "image/svg+xml");
      expect(doc.querySelector("parsererror"), file).toBeNull();
      expect(doc.documentElement.getAttribute("viewBox"), file).toBeTruthy();
      expect(doc.querySelector("script, foreignObject, image"), file).toBeNull();
    }
  });

  it("keeps decorative art out of accessible button names and reserves its dimensions", () => {
    const { getByRole, container } = render(
      <button>
        <PremiumIcon id="view" size={27} />
        Front view
      </button>,
    );
    expect(getByRole("button", { name: "Front view" })).toBeTruthy();
    const icon = container.querySelector("img")!;
    expect(icon.getAttribute("src")).toBe(
      `${import.meta.env.BASE_URL}preset-icons/premium/view.svg`,
    );
    expect(icon.getAttribute("alt")).toBe("");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("width")).toBe("27");
    expect(icon.getAttribute("height")).toBe("27");
  });
});
