import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorBoundary } from "../src/components/common/ErrorBoundary";

afterEach(cleanup);

function Broken(): never {
  throw new Error("b.materials.map is not a function");
}

describe("ErrorBoundary", () => {
  it("shows a message and a reload button instead of a blank window", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("b.materials.map is not a function");
    expect(screen.getByRole("button")).toBeTruthy();
    spy.mockRestore();
  });

  it("renders the children when nothing fails", () => {
    render(
      <ErrorBoundary>
        <p>ok</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeTruthy();
  });
});
