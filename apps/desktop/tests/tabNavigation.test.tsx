import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { navigateTabs } from "../src/components/common/tabNavigation";

afterEach(cleanup);

it("wraps tabs, supports Home/End and leaves toolbar and modified keys alone", () => {
  const activate = vi.fn();
  const { getAllByRole, getByRole } = render(
    <div role="tablist" onKeyDown={navigateTabs}>
      <button role="tab" onClick={() => activate(0)}>
        First
      </button>
      <button role="tab" disabled>
        Unavailable
      </button>
      <button role="tab" onClick={() => activate(2)}>
        Last
      </button>
      <button>Toolbar</button>
    </div>,
  );
  const [first, , last] = getAllByRole("tab");
  fireEvent.keyDown(first!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(last);
  expect(activate).toHaveBeenLastCalledWith(2);
  fireEvent.keyDown(last!, { key: "ArrowRight" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: "ArrowLeft" });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last!, { key: "Home" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first!, { key: "End" });
  expect(document.activeElement).toBe(last);
  activate.mockClear();
  fireEvent.keyDown(last!, { key: "ArrowLeft", ctrlKey: true });
  fireEvent.keyDown(getByRole("button", { name: "Toolbar" }), { key: "Home" });
  expect(activate).not.toHaveBeenCalled();
});
