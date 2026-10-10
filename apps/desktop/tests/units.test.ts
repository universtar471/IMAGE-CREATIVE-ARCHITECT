import { describe, expect, it } from "vitest";
import { clampZoom, fitScale, MAX_ZOOM, zoomAround } from "../src/components/canvas/viewMath";
import { parseNumberInput } from "../src/components/panels/fields";
import { WORKSPACE_MODULES, TRAY_TABS } from "../src/features/workspace/modules";
import { BridgeError, toBridgeError } from "../src/lib/bridge";
import { formatBytes } from "../src/lib/format";
import { knowledge } from "../src/lib/knowledge";
import { getIn, setIn } from "../src/lib/path";

describe("workspace information architecture", () => {
  it("keeps the required left-navigation order", () => {
    expect(WORKSPACE_MODULES.map((m) => m.label)).toEqual([
      "Overview",
      "Design DNA",
      "Context",
      "References",
      "Camera",
      "Lighting",
      "Generate",
      "Mood / Grade",
      "Enhance",
      "QC",
      "Region edit",
      "Export",
    ]);
  });

  it("marks the implemented modules as functional", () => {
    expect(WORKSPACE_MODULES.filter((m) => m.availableIn === null).map((m) => m.id)).toEqual([
      "overview",
      "design_dna",
      "context",
      "references",
      "camera",
      "lighting",
      "generate",
      "mood_grade",
      "enhance",
      "qc",
      "regions",
    ]);
  });

  it("keeps navigation groups explicit", () => {
    expect(WORKSPACE_MODULES.map((m) => m.group)).toEqual([
      "overview",
      "dna",
      "dna",
      "dna",
      "dna",
      "dna",
      "generate",
      "post",
      "post",
      "post",
      "post",
      "export",
    ]);
  });

  it("reserves the bottom tray tabs", () => {
    expect(TRAY_TABS.map((t) => t.label)).toEqual(["Assets", "Versions", "Jobs", "History"]);
    expect(TRAY_TABS.find((t) => t.id === "jobs")?.availableIn).toBeNull();
    expect(TRAY_TABS.find((t) => t.id === "history")?.availableIn).toBeNull();
  });
});

describe("bundled knowledge packs", () => {
  it("loads every seed pack without issues", () => {
    expect(knowledge.issues).toEqual([]);
    expect(knowledge.size).toBeGreaterThanOrEqual(7);
    expect(knowledge.resolve("townhouse").match).toBe("type_default");
  });
});

describe("number input parsing", () => {
  it.each([
    ["", undefined],
    ["  ", undefined],
    ["12", 12],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["-3", -3],
    [".5", 0.5],
  ])("parses %j", (text, expected) => {
    expect(parseNumberInput(text)).toBe(expected);
  });

  it.each(["abc", "1e3", "12m", "1.2.3"])("returns NaN for %j so validation rejects it", (text) => {
    expect(parseNumberInput(text)).toBeNaN();
  });
});

describe("path helpers", () => {
  it("sets nested values immutably", () => {
    const src = { a: { b: { c: 1 } }, x: [1] };
    const out = setIn(src, "a.b.c", 2);
    expect(out.a.b.c).toBe(2);
    expect(src.a.b.c).toBe(1);
    expect(out.x).toBe(src.x);
    expect(getIn(out, "a.b.c")).toBe(2);
  });

  it("removes a key when set to undefined", () => {
    const out = setIn({ a: { b: 1, c: 2 } }, "a.b", undefined);
    expect(out.a).toEqual({ c: 2 });
  });
});

describe("viewer math", () => {
  it("fits large images inside the box and never upscales small ones", () => {
    expect(fitScale(4000, 2000, 1048, 548)).toBeCloseTo(0.25);
    expect(fitScale(100, 100, 1000, 1000)).toBe(1);
  });

  it("keeps the point under the cursor fixed when zooming", () => {
    const v = { scale: 1, x: 10, y: 20 };
    const z = zoomAround(v, 2, 110, 120);
    // image point under cursor before: (100, 100) → after: same screen position
    expect(z.x + 100 * z.scale).toBe(110);
    expect(z.y + 100 * z.scale).toBe(120);
  });

  it("clamps zoom", () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
  });
});

describe("bridge errors", () => {
  it("keeps typed backend errors", () => {
    const e = toBridgeError({ code: "UNSUPPORTED_FILE", message: "Nope", details: { a: 1 } });
    expect(e).toBeInstanceOf(BridgeError);
    expect(e.code).toBe("UNSUPPORTED_FILE");
    expect(e.details).toEqual({ a: 1 });
  });

  it("wraps unknown failures without leaking internals", () => {
    expect(toBridgeError("plain string").message).toBe("plain string");
    expect(toBridgeError(new Error("boom")).code).toBe("IO_ERROR");
    expect(toBridgeError(42).message).toBe("Unexpected error.");
  });
});

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(null)).toBe("—");
  });
});
