import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelpPopover, placePopover } from "../src/components/common/HelpPopover";

afterEach(cleanup);

describe("help popover (ADR-044)", () => {
  it("opens below, flips above near the bottom and stays inside the window", () => {
    const viewport = { width: 800, height: 600 };
    const pop = { width: 300, height: 120 };
    expect(placePopover({ left: 100, top: 100, width: 28, height: 28 }, pop, viewport)).toEqual({
      left: 8,
      top: 134,
      side: "below",
    });
    expect(placePopover({ left: 700, top: 560, width: 28, height: 28 }, pop, viewport)).toEqual({
      left: 800 - 300 - 8,
      top: 560 - 6 - 120,
      side: "above",
    });
  });

  it("opens on click, describes the button, and Esc closes it with focus back", () => {
    render(<HelpPopover topic="Source image">Pick a viewport, sketch or render.</HelpPopover>);
    const button = screen.getByRole("button", { name: "Help: Source image" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    const popover = screen.getByTestId("help-popover");
    expect(popover.textContent).toBe("Pick a viewport, sketch or render.");
    expect(button.getAttribute("aria-describedby")).toBe(popover.id);
    fireEvent.keyDown(popover, { key: "Escape" });
    expect(screen.queryByTestId("help-popover")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
