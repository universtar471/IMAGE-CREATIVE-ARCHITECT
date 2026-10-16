import { describe, expect, it } from "vitest";
import {
  CONFLICT_CODES,
  EDITORIAL_CAPTION_PROMPT,
  LAYOUT_TEMPLATES,
  PAPER_SIZES,
  PUBLICATION_STYLES,
  PUBLICATION_TYPES,
  PublicationPlanError,
  PublicationSchema,
  annotateCaptionReview,
  applyCaptionDrafts,
  buildCaptionPrompt,
  detectFactClaims,
  effectivePpi,
  fitRects,
  hasFactClaim,
  planPublication,
  randomize,
  stylesForPublicationType,
  validatePublication,
  type ImageGroup,
  type ImageSlot,
  type Page,
  type Publication,
  type PublicationAsset,
  type PublicationFact,
  type PublicationInput,
  type PublicationType,
  type SelectionMode,
} from "../src";

const GROUPS: ImageGroup[] = ["context", "massing", "space", "detail"];

function makeAssets(count: number, withGroups = true): PublicationAsset[] {
  return Array.from({ length: count }, (_, index) => ({
    assetId: `IMG_${index + 1}`,
    sourceHash: `sha256:${index + 1}`,
    widthPx: 6000,
    heightPx: 4000,
    importance: index === 3 ? 0.9 : 0.5,
    ...(withGroups ? { group: GROUPS[index % 4]! } : {}),
  }));
}

function input(overrides: Partial<PublicationInput> = {}, count = 10): PublicationInput {
  const assets = makeAssets(count);
  return {
    selectedImageIds: assets.map((asset) => asset.assetId),
    assets,
    targetPageCount: 1,
    selectionMode: "include_all",
    type: "concept_book",
    paper: "A4",
    styleId: "concept_blueprint_blue",
    seed: 42,
    ...overrides,
  };
}

const imagesOf = (pub: Publication) =>
  pub.pages.flatMap((page) =>
    page.slots.filter((slot): slot is ImageSlot => slot.type === "image"),
  );
const imagesOn = (page: Page) => page.slots.filter((s): s is ImageSlot => s.type === "image");
const area = (slot: ImageSlot) => slot.rect.w * slot.rect.h;

describe("publishing library", () => {
  it("has four styles per type, with palette, fonts, scale, spacing and rules", () => {
    expect(PUBLICATION_STYLES).toHaveLength(16);
    for (const type of PUBLICATION_TYPES) expect(stylesForPublicationType(type)).toHaveLength(4);
    expect(stylesForPublicationType("concept_book").map((s) => s.name)).toEqual([
      "Architectural Red",
      "Blueprint Blue",
      "Concrete Grey",
      "Natural Green",
    ]);
  });

  it("stores every ADR-038 template for A4, A3 and 16:9, inside the page", () => {
    expect(LAYOUT_TEMPLATES.map((t) => t.id)).toEqual([
      "hero_full_page",
      "hero_plus_secondary",
      "grid_2x2",
      "grid_2x3",
      "flexible_grid",
      "split",
      "asymmetric_editorial",
      "diagram_sheet",
      "dense_contact",
    ]);
    for (const template of LAYOUT_TEMPLATES) {
      for (const paper of PAPER_SIZES) {
        expect(template.slotRects[paper].length).toBeGreaterThan(0);
        for (const count of [1, 3, 10, 20]) {
          const rects = fitRects(template, paper, count);
          expect(rects).toHaveLength(count);
          for (const r of rects) {
            expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
            expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
      }
    }
    // 16:9 is landscape: the dense contact main frame sits beside the thumbnails.
    const dense = LAYOUT_TEMPLATES.find((t) => t.id === "dense_contact")!;
    expect(dense.slotRects["16:9"][0]!.w).toBeLessThan(dense.slotRects.A4[0]!.w);
  });
});

describe("planPublication — exact page budget", () => {
  const modes: SelectionMode[] = ["include_all", "ai_select"];
  for (const type of PUBLICATION_TYPES) {
    for (const selectionMode of modes) {
      for (const targetPageCount of [1, 3, 10]) {
        it(`${type} ${selectionMode}: 10 images → exactly ${targetPageCount} pages`, () => {
          const pub = planPublication(input({ type, selectionMode, targetPageCount }));
          expect(pub.pages).toHaveLength(targetPageCount);
          expect(pub.pages.map((p) => p.index)).toEqual([...Array(targetPageCount).keys()]);
          const placed = imagesOf(pub).map((s) => s.assetId);
          expect(new Set(placed).size).toBe(placed.length);
          for (const id of placed) expect(pub.selectedImageIds).toContain(id);
          if (selectionMode === "include_all")
            expect(placed.sort()).toEqual([...pub.selectedImageIds].sort());
          for (const id of pub.selectedImageIds) expect(pub.selectionReasons[id]).toBeTruthy();
          expect(
            validatePublication(pub, makeAssets(10)).issues.filter((i) => i.severity === "BLOCK"),
          ).toEqual([]);
        });
      }
    }
  }

  it("ai_select keeps a subset with reasons and still the exact page count", () => {
    const pub = planPublication(
      input({ type: "portfolio", selectionMode: "ai_select", styleId: "portfolio_minimal_white" }),
    );
    const placed = imagesOf(pub).map((s) => s.assetId);
    expect(pub.pages).toHaveLength(1);
    expect(placed).toHaveLength(5);
    expect(placed).toContain("IMG_4"); // highest importance
    const omitted = pub.selectedImageIds.filter((id) => !placed.includes(id));
    for (const id of omitted) expect(pub.selectionReasons[id]).toMatch(/omitted/);
    for (const id of placed) expect(pub.selectionReasons[id]).toMatch(/kept/);
  });

  it("more pages than images: cover/text/diagram pages and no invented image", () => {
    for (const type of PUBLICATION_TYPES) {
      const pub = planPublication(input({ type, targetPageCount: 6 }, 2));
      expect(pub.pages).toHaveLength(6);
      expect(
        imagesOf(pub)
          .map((s) => s.assetId)
          .sort(),
      ).toEqual(["IMG_1", "IMG_2"]);
      expect(pub.pages[0]!.kind).toBe("cover");
      const extraKind = type === "concept_book" ? "diagram" : "text";
      expect(pub.pages.slice(3).every((p) => p.kind === extraKind)).toBe(true);
    }
    const none = planPublication(input({ targetPageCount: 3 }, 0));
    expect(none.pages.map((p) => p.kind)).toEqual(["cover", "diagram", "diagram"]);
    expect(imagesOf(none)).toEqual([]);
  });

  it("repeats the hero on the cover only when repeating is enabled", () => {
    const pub = planPublication(
      input({ type: "portfolio", targetPageCount: 4, allowImageRepeat: true }, 2),
    );
    expect(imagesOn(pub.pages[0]!)).toHaveLength(1);
    expect(imagesOf(pub)).toHaveLength(3);
  });

  it("is reproducible for a seed and pins assets by sourceHash", () => {
    const a = planPublication(
      input({ selectionMode: "ai_select", type: "magazine", styleId: "magazine_retro_modern" }),
    );
    const b = planPublication(
      input({ selectionMode: "ai_select", type: "magazine", styleId: "magazine_retro_modern" }),
    );
    expect(a).toEqual(b);
    for (const slot of imagesOf(a)) expect(slot.sourceHash).toBe(`sha256:${slot.assetId.slice(4)}`);
    expect(PublicationSchema.parse(JSON.parse(JSON.stringify(a)))).toEqual(a);
  });

  it("rejects a selected image without an asset record", () => {
    expect(() => planPublication({ ...input(), selectedImageIds: ["IMG_1", "GHOST"] })).toThrow(
      PublicationPlanError,
    );
  });
});

describe("layout by publication type (AC-16, AC-17)", () => {
  it("AC-16: 10 images, Concept, include_all, 1 page → dense contact grouped by evidence", () => {
    const pub = planPublication(input());
    expect(pub.pages).toHaveLength(1);
    const page = pub.pages[0]!;
    expect(page.layoutTemplateId).toBe("dense_contact");
    const images = imagesOn(page);
    expect(images).toHaveLength(10);
    expect(images[0]!.assetId).toBe("IMG_4"); // main frame = most important
    expect(images[0]!.primary).toBe(true);
    const thumbGroups = images.slice(1).map((s) => s.group);
    const rank = (g: ImageGroup) => GROUPS.indexOf(g);
    expect([...thumbGroups].sort((x, y) => rank(x) - rank(y))).toEqual(thumbGroups);
    const captions = page.slots.filter((s) => s.type === "caption");
    expect(captions.map((s) => s.type === "caption" && s.caption.group)).toEqual(GROUPS);
    expect(page.warnings).toContain("dense_page_suggest_a3_or_digital");
    const validation = validatePublication(pub, makeAssets(10));
    expect(
      validation.issues.some(
        (i) => i.code === "PRINT_READABILITY_LOW" && i.params.reason === "dense_page",
      ),
    ).toBe(true);
    expect(validation.verdict).toBe("WARN");
  });

  it("does not invent groups without evidence", () => {
    const assets = makeAssets(10, false);
    const pub = planPublication({ ...input(), assets });
    expect(imagesOf(pub).every((s) => s.group === "general")).toBe(true);
    expect(pub.pages[0]!.slots.filter((s) => s.type === "caption")).toHaveLength(1);
  });

  it("AC-17: 10 images, Portfolio, 1 page → hero-led, not the Concept layout", () => {
    const concept = planPublication(input());
    const portfolio = planPublication(
      input({ type: "portfolio", styleId: "portfolio_dark_luxury" }),
    );
    const page = portfolio.pages[0]!;
    expect(page.layoutTemplateId).toBe("hero_plus_secondary");
    expect(page.layoutTemplateId).not.toBe(concept.pages[0]!.layoutTemplateId);
    const images = imagesOn(page);
    expect(images).toHaveLength(10);
    const hero = images[0]!;
    expect(area(hero)).toBeGreaterThan(area(imagesOn(concept.pages[0]!)[0]!));
    for (const thumb of images.slice(1)) expect(area(hero)).toBeGreaterThan(area(thumb) * 4);
    expect(page.slots.filter((s) => s.type === "text")).toHaveLength(0); // less text
  });

  it("catalog uses a labelled grid and magazine an editorial headline with a dominant image", () => {
    const catalog = planPublication(input({ type: "catalog", styleId: "catalog_modern_grid" }));
    expect(catalog.pages[0]!.layoutTemplateId).toBe("flexible_grid");
    expect(imagesOf(catalog).every((s) => typeof s.label === "string")).toBe(true);

    const magazine = planPublication(
      input({
        type: "magazine",
        styleId: "magazine_editorial_black",
        title: "Ánh sáng và khoảng lặng",
      }),
    );
    const page = magazine.pages[0]!;
    expect(page.layoutTemplateId).toBe("asymmetric_editorial");
    const headline = page.slots.find((s) => s.type === "text" && s.role === "headline");
    expect(headline && headline.type === "text" && headline.text).toBe("Ánh sáng và khoảng lặng");
    const images = imagesOn(page);
    for (const other of images.slice(1)) expect(area(images[0]!)).toBeGreaterThan(area(other));
  });
});

describe("randomize (AC-18)", () => {
  const base = () =>
    planPublication(input({ targetPageCount: 5, lockedPageIds: ["PAGE_2", "PAGE_4"] }, 20));

  it("locked pages never change; the same seed restores the same result", () => {
    const pub = base();
    let current = pub;
    for (let seed = 1; seed <= 6; seed += 1) {
      current = randomize(current, seed % 2 ? "layout" : "smart", seed);
      expect(current.pages[1]).toEqual(pub.pages[1]);
      expect(current.pages[3]).toEqual(pub.pages[3]);
      expect(current.pages).toHaveLength(5);
    }
    const first = randomize(pub, "smart", 7);
    expect(randomize(current, "smart", 7)).toEqual(first);
    expect(randomize(pub, "smart", 7)).toEqual(first);
  });

  it("never reshuffles content or facts", () => {
    const pub = base();
    const strip = (p: Publication) =>
      p.pages.map((page) =>
        page.slots.map((slot) =>
          slot.type === "image"
            ? [slot.id, slot.assetId, slot.sourceHash]
            : [slot.id, slot.rect, JSON.stringify(slot)],
        ),
      );
    for (const level of ["style", "layout", "smart"] as const) {
      const out = randomize(pub, level, 99);
      expect(strip(out)).toEqual(strip(pub));
      expect(out.selectionReasons).toEqual(pub.selectionReasons);
      expect(out.assetPins).toEqual(pub.assetPins);
    }
  });

  it("style level changes only the book style, within the type", () => {
    const pub = base();
    const styles = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => randomize(pub, "style", seed).styleId),
    );
    expect(styles.size).toBeGreaterThan(1);
    for (const id of styles) expect(id.startsWith("concept_")).toBe(true);
    expect(randomize(pub, "style", 3).pages).toEqual(pub.pages);
  });

  it("layout level actually changes some unlocked layout across seeds", () => {
    const pub = base();
    const layouts = new Set(
      [1, 2, 3, 4, 5].map((seed) => randomize(pub, "layout", seed).pages[0]!.layoutTemplateId),
    );
    expect(layouts.size).toBeGreaterThan(1);
  });
});

describe("fact claims (vi + en)", () => {
  it.each([
    ["Công trình hoàn thành năm 2021.", "year"],
    ["Diện tích sàn 120 m².", "number"],
    ["Nhà gồm ba tầng và sân thượng.", "number"],
    ["Toạ lạc tại Quận 7, TP. Hồ Chí Minh.", "place"],
    ["Ngôi nhà ở Đà Lạt đón nắng sớm.", "place"],
    ["Dự án đoạt giải thưởng kiến trúc quốc gia.", "award"],
    ["Thiết kế bởi KTS Nguyễn Văn A.", "author"],
    ["Gạch ốp lát của hãng Viglacera.", "brand"],
    ["Toa lac tai Ha Noi.", "place"],
    ["The villa was completed in 2019.", "year"],
    ["A three-storey house of 240 sqm.", "number"],
    ["The project is located in Hanoi.", "place"],
    ["An award-winning courtyard house.", "award"],
    ["Designed by Studio North.", "author"],
    ["Fittings by Hafele® throughout.", "brand"],
  ])("%s → %s", (text, kind) => {
    expect(detectFactClaims(text).map((c) => c.kind)).toContain(kind);
  });

  it.each([
    "Ánh sáng chiều lướt nhẹ trên bức tường đá.",
    "Khoảng thông tầng nối các không gian sinh hoạt.",
    "Morning light washes over the timber screen.",
    "The facade faces the street with a deep overhang.",
    "In the courtyard, a single tree anchors the view.",
  ])("no claim: %s", (text) => {
    expect(hasFactClaim(text)).toBe(false);
  });
});

describe("validatePublication", () => {
  const facts: PublicationFact[] = [
    { id: "F_YEAR", text: "Completed in 2021", status: "verified", sourceAssetIds: [] },
    { id: "F_AWARD", text: "Award X", status: "inferred", sourceAssetIds: [] },
  ];

  function withCaption(text: string, factRef: string | null): Publication {
    const pub = planPublication(input({ targetPageCount: 1 }, 4));
    const slot = pub.pages[0]!.slots.find((s) => s.type === "caption")!;
    if (slot.type === "caption") slot.caption.sentences = [{ text, factRef, needs_review: false }];
    return pub;
  }

  it("AC-19: an unverified size or award blocks; a verified factRef clears it", () => {
    const assets = makeAssets(4);
    const award = validatePublication(
      withCaption("Dự án đoạt giải thưởng kiến trúc.", null),
      assets,
      { facts },
    );
    expect(award.verdict).toBe("BLOCK");
    expect(award.issues[0]!.code).toBe("UNVERIFIED_PUBLICATION_FACT");
    expect(CONFLICT_CODES.UNVERIFIED_PUBLICATION_FACT.defaultSeverity).toBe("BLOCK");

    const inferred = validatePublication(
      withCaption("Dự án đoạt giải thưởng kiến trúc.", "F_AWARD"),
      assets,
      { facts },
    );
    expect(
      inferred.issues.find((i) => i.code === "UNVERIFIED_PUBLICATION_FACT")?.params.reason,
    ).toBe("fact_not_confirmed");

    const size = validatePublication(withCaption("Diện tích 250 m2.", null), assets, { facts });
    expect(size.verdict).toBe("BLOCK");

    const ok = validatePublication(withCaption("Hoàn thành năm 2021.", "F_YEAR"), assets, {
      facts,
    });
    expect(ok.issues.filter((i) => i.code === "UNVERIFIED_PUBLICATION_FACT")).toEqual([]);
  });

  it("reports page count mismatch and missing required images", () => {
    const pub = planPublication(input({ targetPageCount: 2 }));
    const broken = structuredClone(pub);
    broken.pages.pop();
    const removed = imagesOn(pub.pages[1]!).map((s) => s.assetId);
    const v = validatePublication(broken, makeAssets(10));
    expect(v.verdict).toBe("BLOCK");
    expect(v.issues.some((i) => i.code === "PAGE_COUNT_MISMATCH")).toBe(true);
    const missing = v.issues
      .filter((i) => i.code === "REQUIRED_IMAGE_MISSING")
      .map((i) => i.params.assetId);
    expect(missing.sort()).toEqual(removed.sort());

    const unavailable = validatePublication(pub, makeAssets(10).slice(1));
    expect(unavailable.issues.find((i) => i.code === "REQUIRED_IMAGE_MISSING")?.params.reason).toBe(
      "asset_unavailable",
    );
    const rerendered = makeAssets(10).map((a) => ({ ...a, sourceHash: `${a.sourceHash}-v2` }));
    expect(validatePublication(pub, rerendered).issues[0]!.params.reason).toBe(
      "pinned_version_unavailable",
    );
  });

  it("computes effective PPI and warns below 150 for print", () => {
    // 6000 px over a 10 in frame = 600 PPI; over 40 in = 150.
    expect(effectivePpi({ widthPx: 6000, heightPx: 4000 }, { width: 720, height: 480 })).toBe(600);
    expect(
      effectivePpi({ widthPx: 3000, heightPx: 3000 }, { width: 720, height: 360 }, "cover"),
    ).toBe(300);
    expect(
      effectivePpi({ widthPx: 3000, heightPx: 3000 }, { width: 720, height: 360 }, "contain"),
    ).toBe(600);

    const pub = planPublication(
      input({ type: "portfolio", styleId: "portfolio_minimal_white", paper: "A3" }, 1),
    );
    const small = [{ assetId: "IMG_1", sourceHash: "sha256:1", widthPx: 1200, heightPx: 800 }];
    const low = validatePublication(pub, small).issues.find((i) => i.params.reason === "low_ppi");
    expect(low?.code).toBe("PRINT_READABILITY_LOW");
    expect(low?.severity).toBe("WARN");
    expect(Number(low?.params.ppi)).toBeLessThan(150);
    const big = [{ assetId: "IMG_1", sourceHash: "sha256:1", widthPx: 8000, heightPx: 11314 }];
    expect(validatePublication(pub, big).verdict).toBe("ALLOW");
    expect(
      validatePublication(pub, small, { approvedExceptions: ["PRINT_READABILITY_LOW"] }).verdict,
    ).toBe("ALLOW");
  });

  it("warns on small fonts, overflow and unsafe crops", () => {
    const pub = withCaption("Ánh sáng ".repeat(400), null);
    const slot = pub.pages[0]!.slots.find((s) => s.type === "caption")!;
    if (slot.type === "caption") slot.fontSizePt = 4;
    const panorama = makeAssets(4).map((a) => ({ ...a, widthPx: 12000, heightPx: 1000 }));
    const reasons = validatePublication(pub, panorama).issues.map((i) => i.params.reason);
    expect(reasons).toContain("font_too_small");
    expect(reasons).toContain("text_overflow");
    expect(reasons).toContain("unsafe_crop");
  });
});

describe("captions", () => {
  const facts: PublicationFact[] = [
    { id: "F_AREA", text: "Floor area 180 m²", status: "verified", sourceAssetIds: [] },
    { id: "F_ARCH", text: "Architect: unknown studio", status: "inferred", sourceAssetIds: [] },
  ];

  it("builds the §11.4 prompt with verified facts only and the existing slots", () => {
    const pub = planPublication(input({ targetPageCount: 2, lockedPageIds: ["PAGE_2"] }));
    const request = buildCaptionPrompt(pub, facts);
    expect(request.prompt.startsWith(EDITORIAL_CAPTION_PROMPT)).toBe(true);
    expect(request.facts.map((f) => f.id)).toEqual(["F_AREA"]);
    expect(request.prompt).not.toContain("unknown studio");
    expect(request.slots.length).toBeGreaterThan(0);
    expect(request.slots.every((s) => s.pageId === "PAGE_1")).toBe(true);
  });

  it("applies drafts through the same fact rule", () => {
    const pub = planPublication(input({ targetPageCount: 1 }, 4));
    const slotId = buildCaptionPrompt(pub, facts).slots[0]!.slotId;
    const { publication, ignoredSlotIds } = applyCaptionDrafts(
      pub,
      {
        slots: [
          {
            slotId,
            sentences: [
              { text: "Sàn rộng 180 m².", factRef: "F_AREA" },
              { text: "Thiết kế bởi một studio trẻ.", factRef: "F_ARCH" },
              { text: "Ánh sáng tràn qua giếng trời.", factRef: null },
            ],
          },
          { slotId: "NEW_SLOT", sentences: [{ text: "x", factRef: null }] },
        ],
      },
      facts,
    );
    expect(ignoredSlotIds).toEqual(["NEW_SLOT"]);
    const slot = publication.pages[0]!.slots.find((s) => s.id === slotId)!;
    expect(
      slot.type === "caption" && slot.caption.sentences.map((s) => [s.factRef, s.needs_review]),
    ).toEqual([
      ["F_AREA", false],
      [null, true],
      [null, false],
    ]);
    expect(slot.type === "caption" && slot.caption.needs_review).toBe(true);
    expect(validatePublication(publication, makeAssets(4), { facts }).verdict).toBe("BLOCK");
    expect(annotateCaptionReview(publication, facts)).toEqual(publication);
  });
});

describe("type coverage helper", () => {
  it("every type has an auto layout for 1..20 images", () => {
    for (const type of PUBLICATION_TYPES as readonly PublicationType[]) {
      for (let n = 1; n <= 20; n += 1) {
        const pub = planPublication(
          input({ type, styleId: stylesForPublicationType(type)[0]!.id }, n),
        );
        expect(imagesOf(pub)).toHaveLength(n);
      }
    }
  });
});
