/**
 * ContentFitValidator (SRS §11.3–11.4, ADR-038), reporting with the single validator's
 * codes and severities (`validation/codes.ts`):
 *
 * - `PAGE_COUNT_MISMATCH` (BLOCK): the book does not have exactly `targetPageCount` pages.
 * - `REQUIRED_IMAGE_MISSING` (BLOCK): an `include_all` image is not placed, or a placed
 *   image is not pinned / its pinned version is not available.
 * - `PRINT_READABILITY_LOW` (WARN): effective PPI, frame too small, dense page, font below
 *   the minimum, text overflow or an unsafe crop.
 * - `UNVERIFIED_PUBLICATION_FACT` (BLOCK): a sentence states a number, place, year, award,
 *   brand or author without a confirmed `factRef` (AC-19).
 */
import { isConfirmed } from "../facts/evidence";
import {
  CONFLICT_CODES,
  VALIDATOR_VERSION,
  type ConflictCode,
  type ConflictSeverity,
} from "../validation/codes";
import {
  verdictOf,
  type ConflictIssue,
  type IssueParams,
  type ShotValidation,
} from "../validation/validateShot";
import { detectFactClaims } from "./factClaims";
import { PAPER_DIMENSIONS_PT } from "./layouts";
import { DENSE_PAGE_IMAGE_COUNT } from "./planner";
import {
  PublicationSchema,
  type ImageSlot,
  type NormalizedRect,
  type PaperSize,
  type Publication,
  type PublicationAsset,
  type PublicationFact,
} from "./schemas";
import { resolvePublicationStyle } from "./styles";

/** Minimum effective PPI: print papers at print resolution, 16:9 at screen resolution. */
export const MIN_EFFECTIVE_PPI: Record<PaperSize, number> = { A4: 150, A3: 150, "16:9": 96 };
/** Smallest readable image frame side, in points (≈ 20 mm). */
export const MIN_FRAME_SIDE_PT = 56;
/** No style may print text below this size, whatever its type scale says. */
export const ABSOLUTE_MIN_FONT_PT = 6;
/** A `cover` crop that keeps less than this share of the image's width or height. */
export const MIN_SAFE_CROP_KEEP = 0.6;

export type PublicationValidation = ShotValidation;

export type ValidatePublicationOptions = {
  /** Project facts captions may cite; only `verified`/`user_declared` ones confirm a claim. */
  facts?: readonly PublicationFact[];
  /** WARN codes the user accepted for this publication. BLOCK codes listed here are ignored. */
  approvedExceptions?: readonly ConflictCode[];
};

/** Asset dimensions as a validator input; `sourceHash` identifies the available version. */
export type PublicationAssetInfo = Pick<PublicationAsset, "assetId"> &
  Partial<Pick<PublicationAsset, "sourceHash" | "widthPx" | "heightPx">>;

type Draft = { code: ConflictCode; path: string; params: IssueParams };

const SEVERITY_RANK: Record<ConflictSeverity, number> = { BLOCK: 0, WARN: 1 };

/** Printed size of a normalized rectangle, in points. */
export function slotSizePt(
  paper: PaperSize,
  rect: NormalizedRect,
): { width: number; height: number } {
  const page = PAPER_DIMENSIONS_PT[paper];
  return { width: rect.w * page.width, height: rect.h * page.height };
}

/**
 * Effective PPI of an image in a frame: pixels per printed inch along the limiting axis.
 * `cover` scales the image to fill the frame (the smaller ratio limits), `contain` to fit
 * inside it (the larger ratio limits).
 */
export function effectivePpi(
  image: { widthPx: number; heightPx: number },
  frame: { width: number; height: number },
  fit: ImageSlot["fit"] = "cover",
): number {
  const ppiX = image.widthPx / (frame.width / 72);
  const ppiY = image.heightPx / (frame.height / 72);
  return fit === "cover" ? Math.min(ppiX, ppiY) : Math.max(ppiX, ppiY);
}

/** Share of the image's width or height kept by a `cover` crop (1 = no crop). */
export function coverCropKeep(
  image: { widthPx: number; heightPx: number },
  frame: { width: number; height: number },
): number {
  const imageAspect = image.widthPx / image.heightPx;
  const frameAspect = frame.width / frame.height;
  return Math.min(imageAspect, frameAspect) / Math.max(imageAspect, frameAspect);
}

/** Rough capacity of a text frame: an average glyph is half the font size wide. */
export function textCapacityChars(frame: { width: number; height: number }, fontSizePt: number) {
  const perLine = Math.floor(frame.width / (fontSizePt * 0.5));
  const lines = Math.floor(frame.height / (fontSizePt * 1.25));
  return Math.max(0, perLine) * Math.max(0, lines);
}

function claimDraft(
  path: string,
  text: string,
  factRef: string | null | undefined,
  facts: ReadonlyMap<string, PublicationFact>,
): Draft | null {
  const fact = factRef ? facts.get(factRef) : undefined;
  if (fact && isConfirmed(fact)) return null;
  const claims = detectFactClaims(text);
  if (claims.length === 0 && !factRef) return null;
  return {
    code: "UNVERIFIED_PUBLICATION_FACT",
    path,
    params: {
      kinds: [...new Set(claims.map((claim) => claim.kind))].join(","),
      reason: !factRef ? "no_fact_ref" : fact ? "fact_not_confirmed" : "unknown_fact_ref",
    },
  };
}

export function validatePublication(
  publication: Publication,
  assets: readonly PublicationAssetInfo[],
  options: ValidatePublicationOptions = {},
): PublicationValidation {
  const pub = PublicationSchema.parse(publication);
  const style = resolvePublicationStyle(pub.type, pub.styleId);
  const facts = new Map((options.facts ?? []).map((fact) => [fact.id, fact]));
  const drafts: Draft[] = [];
  const add = (code: ConflictCode, path: string, params: IssueParams) =>
    drafts.push({ code, path, params });

  // Exact page budget.
  if (pub.pages.length !== pub.targetPageCount) {
    add("PAGE_COUNT_MISMATCH", "pages", {
      expected: pub.targetPageCount,
      actual: pub.pages.length,
    });
  }
  pub.pages.forEach((page, index) => {
    if (page.index !== index) {
      add("PAGE_COUNT_MISMATCH", `pages[${index}].index`, { expected: index, actual: page.index });
    }
  });

  // Required images and pins.
  const pins = new Map(pub.assetPins.map((pin) => [pin.assetId, pin.sourceHash]));
  const placed = new Set<string>();
  pub.pages.forEach((page, pageIndex) =>
    page.slots.forEach((slot, slotIndex) => {
      if (slot.type !== "image") return;
      placed.add(slot.assetId);
      const path = `pages[${pageIndex}].slots[${slotIndex}]`;
      const pinned = pins.get(slot.assetId);
      if (pinned !== slot.sourceHash) {
        add("REQUIRED_IMAGE_MISSING", path, {
          assetId: slot.assetId,
          reason: pinned ? "pin_mismatch" : "unpinned",
        });
        return;
      }
      const versions = assets.filter((asset) => asset.assetId === slot.assetId);
      if (versions.length === 0) {
        add("REQUIRED_IMAGE_MISSING", path, { assetId: slot.assetId, reason: "asset_unavailable" });
      } else if (
        !versions.some((asset) => !asset.sourceHash || asset.sourceHash === slot.sourceHash)
      ) {
        add("REQUIRED_IMAGE_MISSING", path, {
          assetId: slot.assetId,
          reason: "pinned_version_unavailable",
        });
      }
    }),
  );
  if (pub.selectionMode === "include_all") {
    pub.selectedImageIds.forEach((assetId, index) => {
      if (!placed.has(assetId)) {
        add("REQUIRED_IMAGE_MISSING", `selectedImageIds[${index}]`, {
          assetId,
          reason: "not_placed",
        });
      }
    });
  }

  // Content fit and readability.
  const minPpi = MIN_EFFECTIVE_PPI[pub.paper];
  const minFont = Math.max(ABSOLUTE_MIN_FONT_PT, style.typeScale.minimum);
  pub.pages.forEach((page, pageIndex) => {
    const imageCount = page.slots.filter((slot) => slot.type === "image").length;
    if (imageCount >= DENSE_PAGE_IMAGE_COUNT[pub.paper]) {
      add("PRINT_READABILITY_LOW", `pages[${pageIndex}]`, {
        reason: "dense_page",
        images: imageCount,
        suggestion: pub.paper === "A4" ? "A3_or_digital" : "split_pages",
      });
    }
    page.slots.forEach((slot, slotIndex) => {
      const path = `pages[${pageIndex}].slots[${slotIndex}]`;
      const frame = slotSizePt(pub.paper, slot.rect);
      if (slot.type === "image") {
        if (Math.min(frame.width, frame.height) < MIN_FRAME_SIDE_PT) {
          add("PRINT_READABILITY_LOW", path, {
            reason: "image_too_small",
            minSidePt: Math.round(Math.min(frame.width, frame.height)),
          });
        }
        const asset =
          assets.find(
            (item) => item.assetId === slot.assetId && item.sourceHash === slot.sourceHash,
          ) ?? assets.find((item) => item.assetId === slot.assetId);
        if (!asset?.widthPx || !asset.heightPx) return;
        const image = { widthPx: asset.widthPx, heightPx: asset.heightPx };
        const ppi = effectivePpi(image, frame, slot.fit);
        if (ppi < minPpi) {
          add("PRINT_READABILITY_LOW", path, {
            reason: "low_ppi",
            ppi: Math.round(ppi),
            minimum: minPpi,
          });
        }
        if (slot.fit === "cover") {
          const keep = coverCropKeep(image, frame);
          if (keep < MIN_SAFE_CROP_KEEP) {
            add("PRINT_READABILITY_LOW", path, {
              reason: "unsafe_crop",
              keptPercent: Math.round(keep * 100),
            });
          }
        }
        return;
      }

      const fontSize =
        slot.fontSizePt ??
        (slot.type === "caption" ? style.typeScale.caption : style.typeScale.body);
      if (fontSize < minFont) {
        add("PRINT_READABILITY_LOW", path, {
          reason: "font_too_small",
          fontSizePt: fontSize,
          minimum: minFont,
        });
      }
      const text =
        slot.type === "text" ? slot.text : slot.caption.sentences.map((s) => s.text).join(" ");
      const capacity = textCapacityChars(frame, fontSize);
      if (text.trim().length > capacity) {
        add("PRINT_READABILITY_LOW", path, {
          reason: "text_overflow",
          chars: text.trim().length,
          capacityChars: capacity,
        });
      }

      if (slot.type === "text") {
        const draft = claimDraft(path, slot.text, slot.factRef, facts);
        if (draft) drafts.push(draft);
      } else {
        slot.caption.sentences.forEach((sentence, sentenceIndex) => {
          const draft = claimDraft(
            `${path}.caption.sentences[${sentenceIndex}]`,
            sentence.text,
            sentence.factRef,
            facts,
          );
          if (draft) drafts.push(draft);
        });
      }
    });
  });

  const approved = new Set(options.approvedExceptions ?? []);
  const issues: ConflictIssue[] = drafts.map((draft) => {
    const severity = CONFLICT_CODES[draft.code].defaultSeverity;
    const exceptionAllowed = severity === "WARN";
    return {
      code: draft.code,
      severity,
      path: draft.path,
      messageKey: `conflicts.${draft.code}`,
      params: draft.params,
      exceptionAllowed,
      accepted: exceptionAllowed && approved.has(draft.code),
    };
  });
  issues.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compare(a.code, b.code) ||
      compare(a.path, b.path),
  );
  return { verdict: verdictOf(issues), issues, validatorVersion: VALIDATOR_VERSION };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
