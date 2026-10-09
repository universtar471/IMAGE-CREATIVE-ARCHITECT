/**
 * Guard against untranslated UI text: JSX text nodes and user-facing attributes in the
 * desktop components must come from the i18n dictionaries. A heuristic (regex over the
 * sources), so it catches the obvious leftovers, not every string built in code.
 */
import { describe, expect, it } from "vitest";

/** Every component source (raw text), keyed by path; the dictionaries are excluded. */
const SOURCES = Object.entries(
  import.meta.glob<string>(["../src/**/*.tsx", "!../src/i18n/**"], {
    query: "?raw",
    import: "default",
    eager: true,
  }),
);

/** Text that is the same in every language (units, formats, product names). */
const ALLOWED = new Set(["JPEG · PNG · WebP", "SHA-256", "Arch AI Studio", "1:1"]);

function leftovers(source: string): string[] {
  const found: string[] = [];
  // Text between a JSX tag end and the next tag: "<b>Hello</b>" (not `=>` or comparisons).
  for (const m of source.matchAll(/[^=\s]>([^<>{}]*)</g)) {
    const text = m[1]!.replace(/\s+/g, " ").trim();
    if (/[A-Za-z]{2,}/.test(text) && !/[;=()&|]/.test(text) && !ALLOWED.has(text)) found.push(text);
  }
  // User-facing attributes written as string literals.
  for (const m of source.matchAll(
    /\s(title|aria-label|placeholder|label|confirmLabel|hint|message|alt|emptyMessage)="([^"]*)"/g,
  )) {
    if (/[A-Za-z]{2,}/.test(m[2]!) && !ALLOWED.has(m[2]!)) found.push(`${m[1]}="${m[2]}"`);
  }
  return found;
}

describe("hard-coded UI strings", () => {
  it("scans the component sources", () => {
    expect(SOURCES.length).toBeGreaterThan(30);
  });

  it("finds no English text outside the dictionaries", () => {
    const report = SOURCES.flatMap(([file, source]) =>
      leftovers(source).map((s) => `${file.replace("../src/", "")}: ${s}`),
    );
    expect(report).toEqual([]);
  });

  it("would flag a leftover (self-check)", () => {
    expect(leftovers(`<p>Hello world</p>`)).toEqual(["Hello world"]);
    expect(leftovers(`<b title="Open project">{t("x")}</b>`)).toEqual([`title="Open project"`]);
    expect(leftovers(`const ok = (a) => a < b && c > d;`)).toEqual([]);
  });
});
