/** Dictionaries, translate(), the locale store and the domain-message translator. */
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../src/i18n/en";
import { vi } from "../src/i18n/vi";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  reloadLocale,
  t,
  translate,
  useLocale,
} from "../src/i18n";
import { errorHeadline, errorKindLabel, translateDomainMessage } from "../src/i18n/domain";
import { formatBytes, formatRelativeTime } from "../src/lib/format";

type Leaf = { key: string; value: string };

function leaves(node: unknown, prefix = ""): Leaf[] {
  if (typeof node === "string") return [{ key: prefix, value: node }];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

afterEach(() => {
  localStorage.removeItem(LOCALE_STORAGE_KEY);
});

describe("dictionaries", () => {
  const enLeaves = leaves(en);
  const viLeaves = new Map(leaves(vi).map((l) => [l.key, l.value]));

  it("have the same keys", () => {
    expect([...viLeaves.keys()].sort()).toEqual(enLeaves.map((l) => l.key).sort());
  });

  it("have no empty strings", () => {
    for (const l of enLeaves) expect(l.value.trim(), `en ${l.key}`).not.toBe("");
    for (const [key, value] of viLeaves) expect(value.trim(), `vi ${key}`).not.toBe("");
  });

  it("contains no common mojibake sequences in Vietnamese strings", () => {
    for (const { key, value } of leaves(vi)) {
      expect(value, `vi ${key}`).not.toMatch(/Ã|Æ°|áº|á»/);
    }
  });

  it("keeps QC Vietnamese labels accented", () => {
    for (const { key, value } of leaves(vi.qc)) {
      if (/[A-Za-zÀ-ỹ]/.test(value)) {
        expect(value, `vi qc.${key}`).toMatch(/[À-ỹ]/);
      }
    }
  });

  it("keep every {placeholder} of English in Vietnamese", () => {
    for (const l of enLeaves) {
      const want = placeholders(l.value);
      const got = placeholders(viLeaves.get(l.key) ?? "");
      for (const p of want) expect(got, `vi ${l.key} lacks {${p}}`).toContain(p);
    }
  });

  it("never use a dot inside a key (keys are dotted paths)", () => {
    for (const l of enLeaves) {
      const own = l.key.split(".");
      expect(own.every((part) => part.length > 0)).toBe(true);
    }
  });
});

describe("translate", () => {
  it("uses the architecture label for the first DNA step in both locales", () => {
    expect(translate("en", "modules.design_dna.label")).toBe("Architecture");
    expect(translate("vi", "modules.design_dna.label")).toBe("Kiến trúc");
    expect(translate("en", "workflow.stage.dna")).toBe("Design DNA");
    expect(translate("vi", "workflow.stage.dna")).toBe("DNA thiết kế");
  });

  it("fills placeholders and picks plural forms by count", () => {
    expect(translate("en", "common.images", { count: 1 })).toBe("1 image");
    expect(translate("en", "common.images", { count: 3 })).toBe("3 images");
    expect(translate("vi", "common.images", { count: 3 })).toBe("3 ảnh");
    expect(translate("en", "hub.openProject", { name: "Villa A" })).toBe("Open Villa A");
    expect(translate("vi", "hub.openProject", { name: "Villa A" })).toBe("Mở Villa A");
  });

  it("leaves an unknown placeholder visible instead of dropping it", () => {
    expect(translate("en", "hub.openProject")).toBe("Open {name}");
  });
});

describe("locale store", () => {
  it("defaults to Vietnamese on first run", () => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    reloadLocale();
    expect(DEFAULT_LOCALE).toBe("vi");
    expect(useLocale.getState().locale).toBe("vi");
  });

  it("persists the choice in localStorage and restores it", () => {
    useLocale.getState().setLocale("en");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    useLocale.setState({ locale: "vi" });
    reloadLocale();
    expect(useLocale.getState().locale).toBe("en");
  });

  it("falls back to Vietnamese on a junk value", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    reloadLocale();
    expect(useLocale.getState().locale).toBe("vi");
  });

  it("t() follows the current language", () => {
    useLocale.setState({ locale: "vi" });
    expect(t("common.cancel")).toBe("Hủy");
    useLocale.setState({ locale: "en" });
    expect(t("common.cancel")).toBe("Cancel");
  });
});

describe("domain and backend text", () => {
  it("translates domain validation messages and keeps unknown ones", () => {
    useLocale.setState({ locale: "vi" });
    expect(translateDomainMessage("Enter a valid number.")).toBe("Nhập một số hợp lệ.");
    expect(translateDomainMessage("Must be greater than 0.")).toBe("Phải lớn hơn 0.");
    expect(
      translateDomainMessage(
        "Gemini 2.5 Flash Image accepts at most 3 reference image(s); 4 selected.",
      ),
    ).toBe("Gemini 2.5 Flash Image nhận tối đa 3 ảnh tham chiếu; đang chọn 4.");
    expect(translateDomainMessage("Some brand new backend text.")).toBe(
      "Some brand new backend text.",
    );
  });

  it("gives a headline per error code and provider error kind", () => {
    useLocale.setState({ locale: "vi" });
    expect(errorHeadline({ code: "NOT_FOUND" })).toBe("Không tìm thấy");
    expect(errorHeadline({ code: "PROVIDER_ERROR", details: { kind: "timeout" } })).toBe(
      "Hết thời gian chờ",
    );
    expect(errorKindLabel("rate_limited")).toMatch(/giới hạn/);
    expect(errorKindLabel("something_new")).toBe("something_new");
    expect(errorKindLabel(null)).toBe("Tạo ảnh thất bại");
  });

  it("formats numbers and relative times in the active language", () => {
    useLocale.setState({ locale: "vi" });
    expect(formatBytes(1536)).toBe("1,5 KB");
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(formatRelativeTime("2026-10-09T11:55:00Z", now)).toBe("5 phút trước");
    useLocale.setState({ locale: "en" });
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatRelativeTime("2026-10-09T11:55:00Z", now)).toBe("5 min ago");
  });
});
