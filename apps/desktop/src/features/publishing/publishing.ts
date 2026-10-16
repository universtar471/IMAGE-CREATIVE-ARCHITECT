/**
 * Publishing Studio helpers (SRS §11, §13.3, ADR-038): which project images may be
 * published, planning from the studio settings, page edits, the export gate and the
 * optional AI caption answer. Pure functions over the domain `Publication`; React and the
 * bridge live in the components and `store.ts`.
 */
import {
  CONFLICT_CODES,
  CaptionDraftResponseSchema,
  PUBLICATION_STYLES,
  PublicationSchema,
  VALIDATOR_VERSION,
  applyCaptionDrafts,
  planPublication,
  resolvePublicationStyle,
  reviewSentence,
  splitSentences,
  validatePublication,
  verdictOf,
  type AssetDTO,
  type AssetRole,
  type CaptionPageSlot,
  type ConflictCode,
  type ConflictIssue,
  type ImageSlot,
  type Page,
  type PageSlot,
  type PaperSize,
  type Publication,
  type PublicationAsset,
  type PublicationFact,
  type PublicationType,
  type PublicationValidation,
  type SelectionMode,
  type TextDensity,
  type TextSlot,
} from "@arch/domain";

/** Project images a book may use: the approved master and regular renders/photos. */
export const PUBLISHABLE_ROLES: readonly AssetRole[] = ["master_architecture", "regular_image"];

/**
 * Approved project images: ready files with a content hash (the pin) and known pixel size
 * (needed for the effective-PPI check). References, sketches and missing files are excluded.
 */
export function publishableAssets(assets: readonly AssetDTO[]): AssetDTO[] {
  return assets.filter(
    (asset) =>
      asset.status === "ready" &&
      !!asset.sha256 &&
      !!asset.widthPx &&
      !!asset.heightPx &&
      PUBLISHABLE_ROLES.includes(asset.role),
  );
}

export function toPublicationAsset(asset: AssetDTO): PublicationAsset {
  return {
    assetId: asset.id,
    sourceHash: asset.sha256!,
    widthPx: asset.widthPx ?? undefined,
    heightPx: asset.heightPx ?? undefined,
    label: asset.originalName?.trim() || undefined,
    // The approved master leads the hero frame and `ai_select`.
    importance: asset.role === "master_architecture" ? 1 : 0.5,
  };
}

export type PublishingSettings = {
  type: PublicationType;
  paper: PaperSize;
  targetPageCount: number;
  selectionMode: SelectionMode;
  textDensity: TextDensity;
  styleId: string;
  seed: number;
  title: string;
  allowImageRepeat: boolean;
  selectedImageIds: string[];
};

export const MAX_PAGE_COUNT = 200;

export function defaultSettings(assets: readonly AssetDTO[], title = ""): PublishingSettings {
  return {
    type: "concept_book",
    paper: "A3",
    targetPageCount: 1,
    selectionMode: "include_all",
    textDensity: "sparse",
    styleId: resolvePublicationStyle("concept_book", "").id,
    seed: 1,
    title,
    allowImageRepeat: false,
    selectedImageIds: publishableAssets(assets).map((asset) => asset.id),
  };
}

/** The style of `styleId` decides the type: picking a gallery card can switch the type. */
export function settingsForStyle(
  settings: PublishingSettings,
  styleId: string,
): PublishingSettings {
  const style = PUBLICATION_STYLES.find((item) => item.id === styleId);
  return style ? { ...settings, styleId: style.id, type: style.type } : settings;
}

export function settingsForType(settings: PublishingSettings, type: PublicationType) {
  return { ...settings, type, styleId: resolvePublicationStyle(type, settings.styleId).id };
}

/** Why "Plan" is disabled, as an i18n key; null when the book can be planned. */
export function planBlocker(settings: PublishingSettings, assets: readonly AssetDTO[]) {
  const usable = new Set(publishableAssets(assets).map((asset) => asset.id));
  if (!settings.selectedImageIds.some((id) => usable.has(id)))
    return "publishing.noImages" as const;
  const count = settings.targetPageCount;
  if (!Number.isInteger(count) || count < 1 || count > MAX_PAGE_COUNT)
    return "publishing.badPageCount" as const;
  return null;
}

/** Plans a book from the settings (exactly `targetPageCount` pages, ADR-038). */
export function planFromSettings(
  settings: PublishingSettings,
  assets: readonly AssetDTO[],
): Publication {
  const usable = new Map(publishableAssets(assets).map((asset) => [asset.id, asset]));
  const selected = settings.selectedImageIds.filter((id) => usable.has(id));
  return planPublication({
    selectedImageIds: selected,
    assets: selected.map((id) => toPublicationAsset(usable.get(id)!)),
    targetPageCount: settings.targetPageCount,
    selectionMode: settings.selectionMode,
    type: settings.type,
    paper: settings.paper,
    textDensity: settings.textDensity,
    styleId: settings.styleId,
    layoutMode: "auto",
    seed: settings.seed,
    lockedPageIds: [],
    allowImageRepeat: settings.allowImageRepeat,
    title: settings.title,
  });
}

/** The settings a stored book was planned with (for reopening it). */
export function settingsOf(publication: Publication): PublishingSettings {
  return {
    type: publication.type,
    paper: publication.paper,
    targetPageCount: publication.targetPageCount,
    selectionMode: publication.selectionMode,
    textDensity: publication.textDensity,
    styleId: publication.styleId,
    seed: publication.seed,
    title: publication.title,
    allowImageRepeat: publication.allowImageRepeat,
    selectedImageIds: [...publication.selectedImageIds],
  };
}

/** Validator inputs for the project's current files (a re-rendered asset changes its hash). */
export function assetInfos(assets: readonly AssetDTO[]) {
  return assets
    .filter((asset) => asset.status === "ready")
    .map((asset) => ({
      assetId: asset.id,
      sourceHash: asset.sha256 ?? undefined,
      widthPx: asset.widthPx ?? undefined,
      heightPx: asset.heightPx ?? undefined,
    }));
}

const SEVERITY_RANK = { BLOCK: 0, WARN: 1 } as const;

/**
 * The publishing validator plus one Studio rule: a caption sentence still marked
 * `needs_review` (an AI draft the user has not approved) is reported as
 * `UNVERIFIED_PUBLICATION_FACT` with `reason: "needs_review"`, so it blocks export too.
 */
export function publicationIssues(
  publication: Publication,
  assets: readonly AssetDTO[],
  facts: readonly PublicationFact[],
  acceptedWarnings: readonly ConflictCode[],
): PublicationValidation {
  const base = validatePublication(publication, assetInfos(assets), {
    facts,
    approvedExceptions: acceptedWarnings,
  });
  const flagged = new Set(
    base.issues.filter((i) => i.code === "UNVERIFIED_PUBLICATION_FACT").map((i) => i.path),
  );
  const extra: ConflictIssue[] = [];
  publication.pages.forEach((page, pageIndex) =>
    page.slots.forEach((slot, slotIndex) => {
      if (slot.type !== "caption") return;
      slot.caption.sentences.forEach((sentence, sentenceIndex) => {
        const path = `pages[${pageIndex}].slots[${slotIndex}].caption.sentences[${sentenceIndex}]`;
        if (!sentence.needs_review || flagged.has(path)) return;
        extra.push({
          code: "UNVERIFIED_PUBLICATION_FACT",
          severity: CONFLICT_CODES.UNVERIFIED_PUBLICATION_FACT.defaultSeverity,
          path,
          messageKey: "conflicts.UNVERIFIED_PUBLICATION_FACT",
          params: { reason: "needs_review" },
          exceptionAllowed: false,
          accepted: false,
        });
      });
    }),
  );
  if (extra.length === 0) return base;
  const issues = [...base.issues, ...extra].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.path.localeCompare(b.path),
  );
  return { verdict: verdictOf(issues), issues, validatorVersion: VALIDATOR_VERSION };
}

/** Index of the page an issue path points at (`pages[2].slots[0]` → 2), or null. */
export function issuePageIndex(issue: Pick<ConflictIssue, "path">): number | null {
  const match = /^pages\[(\d+)\]/.exec(issue.path);
  return match ? Number(match[1]) : null;
}

/** Slot id an issue path points at, when it names a slot. */
export function issueSlotId(publication: Publication, issue: Pick<ConflictIssue, "path">) {
  const match = /^pages\[(\d+)\]\.slots\[(\d+)\]/.exec(issue.path);
  if (!match) return null;
  return publication.pages[Number(match[1])]?.slots[Number(match[2])]?.id ?? null;
}

export type ExportGate =
  | { status: "blocked"; issues: ConflictIssue[] }
  | { status: "confirm"; issues: ConflictIssue[] }
  | { status: "ready" };

/**
 * Export refuses every BLOCK issue: `UNVERIFIED_PUBLICATION_FACT` and `PAGE_COUNT_MISMATCH`
 * (ADR-038), and `REQUIRED_IMAGE_MISSING`, since a missing pinned file cannot be drawn.
 * Pending `PRINT_READABILITY_LOW` warnings ask for confirmation first.
 */
export function exportGate(validation: PublicationValidation): ExportGate {
  const blocked = validation.issues.filter((issue) => issue.severity === "BLOCK");
  if (blocked.length > 0) return { status: "blocked", issues: blocked };
  const pending = validation.issues.filter((issue) => issue.severity === "WARN" && !issue.accepted);
  return pending.length > 0 ? { status: "confirm", issues: pending } : { status: "ready" };
}

// ---------------------------------------------------------------- page edits

export type SlotRef = { pageId: string; slotId: string };

const isLocked = (publication: Publication, pageId: string) =>
  publication.lockedPageIds.includes(pageId);

function findSlot(publication: Publication, ref: SlotRef): PageSlot | undefined {
  return publication.pages
    .find((page) => page.id === ref.pageId)
    ?.slots.find((s) => s.id === ref.slotId);
}

function edit(publication: Publication, mutate: (draft: Publication) => void): Publication {
  const draft = structuredClone(publication);
  mutate(draft);
  return PublicationSchema.parse(draft);
}

export function toggleLock(publication: Publication, pageId: string): Publication {
  return edit(publication, (draft) => {
    draft.lockedPageIds = isLocked(draft, pageId)
      ? draft.lockedPageIds.filter((id) => id !== pageId)
      : [...draft.lockedPageIds, pageId];
  });
}

type ImageContent = Pick<ImageSlot, "assetId" | "sourceHash" | "label" | "group">;
const contentOf = (slot: ImageSlot): ImageContent => ({
  assetId: slot.assetId,
  sourceHash: slot.sourceHash,
  label: slot.label,
  group: slot.group,
});

/** Captions follow the image they describe when it moves to another frame. */
function renameCaptionImage(page: Page, from: string, to: string) {
  for (const slot of page.slots) {
    if (slot.type !== "caption") continue;
    slot.caption.imageAssetIds = slot.caption.imageAssetIds.map((id) => (id === from ? to : id));
  }
}

/**
 * Swaps the images of two frames (drag and drop), on the same page or across pages. Frames
 * keep their place, size and role; only the pinned image moves. Locked pages never change.
 */
export function swapImages(publication: Publication, a: SlotRef, b: SlotRef): Publication {
  if (a.pageId === b.pageId && a.slotId === b.slotId) return publication;
  if (isLocked(publication, a.pageId) || isLocked(publication, b.pageId)) return publication;
  const first = findSlot(publication, a);
  const second = findSlot(publication, b);
  if (first?.type !== "image" || second?.type !== "image") return publication;
  return edit(publication, (draft) => {
    const x = findSlot(draft, a) as ImageSlot;
    const y = findSlot(draft, b) as ImageSlot;
    const cx = contentOf(x);
    const cy = contentOf(y);
    Object.assign(x, cy);
    Object.assign(y, cx);
    if (a.pageId !== b.pageId) {
      const pageA = draft.pages.find((page) => page.id === a.pageId)!;
      const pageB = draft.pages.find((page) => page.id === b.pageId)!;
      renameCaptionImage(pageA, cx.assetId, cy.assetId);
      renameCaptionImage(pageB, cy.assetId, cx.assetId);
    }
  });
}

/**
 * Puts `asset` in a frame. An image already placed elsewhere is swapped instead (no
 * duplicates). A new image is pinned and selected; the image it replaces is unselected when
 * it no longer appears anywhere, so `include_all` stays truthful about the book.
 */
export function replaceImage(
  publication: Publication,
  ref: SlotRef,
  asset: PublicationAsset,
): Publication {
  if (isLocked(publication, ref.pageId)) return publication;
  const target = findSlot(publication, ref);
  if (target?.type !== "image" || target.assetId === asset.assetId) return publication;
  for (const page of publication.pages) {
    const other = page.slots.find(
      (slot) => slot.type === "image" && slot.assetId === asset.assetId,
    );
    if (other) return swapImages(publication, ref, { pageId: page.id, slotId: other.id });
  }
  return edit(publication, (draft) => {
    const slot = findSlot(draft, ref) as ImageSlot;
    const previous = slot.assetId;
    Object.assign(slot, {
      assetId: asset.assetId,
      sourceHash: asset.sourceHash,
      label: asset.label,
      group: asset.group ?? "general",
    });
    renameCaptionImage(
      draft.pages.find((page) => page.id === ref.pageId)!,
      previous,
      asset.assetId,
    );
    if (!draft.selectedImageIds.includes(asset.assetId)) {
      draft.selectedImageIds.push(asset.assetId);
      draft.assetPins.push({ assetId: asset.assetId, sourceHash: asset.sourceHash });
    } else {
      draft.assetPins = draft.assetPins.map((pin) =>
        pin.assetId === asset.assetId ? { ...pin, sourceHash: asset.sourceHash } : pin,
      );
    }
    draft.selectionReasons[asset.assetId] = `Placed by the user on ${ref.pageId}.`;
    const stillPlaced = draft.pages.some((page) =>
      page.slots.some((s) => s.type === "image" && s.assetId === previous),
    );
    if (!stillPlaced) {
      draft.selectedImageIds = draft.selectedImageIds.filter((id) => id !== previous);
      draft.assetPins = draft.assetPins.filter((pin) => pin.assetId !== previous);
      draft.selectionReasons[previous] = `Replaced by the user on ${ref.pageId}.`;
    }
  });
}

const factMap = (facts: readonly PublicationFact[]) => new Map(facts.map((f) => [f.id, f]));

/**
 * The user's caption text, split into sentences. A sentence keeps the fact link of the
 * sentence it replaces at the same position; the fact rule then decides `needs_review`
 * (the user wrote it, so only an unbacked claim needs review).
 */
export function setCaptionText(
  publication: Publication,
  ref: SlotRef,
  text: string,
  facts: readonly PublicationFact[],
): Publication {
  if (isLocked(publication, ref.pageId) || findSlot(publication, ref)?.type !== "caption")
    return publication;
  const byId = factMap(facts);
  return edit(publication, (draft) => {
    const slot = findSlot(draft, ref) as CaptionPageSlot;
    const previous = slot.caption.sentences;
    slot.caption.sentences = splitSentences(text).map((sentence, index) =>
      reviewSentence({ text: sentence, factRef: previous[index]?.factRef ?? null }, byId),
    );
    slot.caption.needs_review = slot.caption.sentences.some((s) => s.needs_review);
  });
}

/** Links (or unlinks, with null) one caption sentence to a confirmed fact. */
export function setSentenceFact(
  publication: Publication,
  ref: SlotRef,
  sentenceIndex: number,
  factRef: string | null,
  facts: readonly PublicationFact[],
): Publication {
  const slot = findSlot(publication, ref);
  if (isLocked(publication, ref.pageId) || slot?.type !== "caption") return publication;
  if (!slot.caption.sentences[sentenceIndex]) return publication;
  const byId = factMap(facts);
  return edit(publication, (draft) => {
    const caption = (findSlot(draft, ref) as CaptionPageSlot).caption;
    const sentence = caption.sentences[sentenceIndex]!;
    caption.sentences[sentenceIndex] = reviewSentence({ text: sentence.text, factRef }, byId);
    caption.needs_review = caption.sentences.some((s) => s.needs_review);
  });
}

/**
 * "Duyệt": the user approves the caption as written. Sentences without a factual claim lose
 * `needs_review`; a sentence that states a number, place, year, award, brand or author keeps
 * it until it is linked to a confirmed fact.
 */
export function approveCaption(
  publication: Publication,
  ref: SlotRef,
  facts: readonly PublicationFact[],
): Publication {
  if (isLocked(publication, ref.pageId) || findSlot(publication, ref)?.type !== "caption")
    return publication;
  const byId = factMap(facts);
  return edit(publication, (draft) => {
    const caption = (findSlot(draft, ref) as CaptionPageSlot).caption;
    caption.sentences = caption.sentences.map((s) => reviewSentence(s, byId));
    caption.needs_review = caption.sentences.some((s) => s.needs_review);
  });
}

export function setText(publication: Publication, ref: SlotRef, text: string): Publication {
  if (isLocked(publication, ref.pageId) || findSlot(publication, ref)?.type !== "text")
    return publication;
  return edit(publication, (draft) => {
    const slot = findSlot(draft, ref) as TextSlot;
    slot.text = text;
    slot.placeholder = text.trim().length === 0;
    // The book title lives on the first headline.
    if (slot.role === "headline" && ref.pageId === draft.pages[0]?.id) draft.title = text;
  });
}

export function setTextFact(
  publication: Publication,
  ref: SlotRef,
  factRef: string | null,
): Publication {
  if (isLocked(publication, ref.pageId) || findSlot(publication, ref)?.type !== "text")
    return publication;
  return edit(publication, (draft) => {
    (findSlot(draft, ref) as TextSlot).factRef = factRef;
  });
}

// ---------------------------------------------------------------- AI captions

/** The first JSON object in a model answer (models sometimes wrap it in a code fence). */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Writes an AI caption answer into the existing caption slots of unlocked pages. Every
 * drafted sentence lands as `needs_review` until the user approves it, whatever the fact
 * rule says; unknown or unconfirmed fact ids are dropped. Returns null when the answer is
 * not the requested JSON.
 */
export function applyAiCaptions(
  publication: Publication,
  raw: string,
  facts: readonly PublicationFact[],
): { publication: Publication; filled: number; ignoredSlotIds: string[] } | null {
  let parsed;
  try {
    parsed = CaptionDraftResponseSchema.safeParse(extractJson(raw));
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  const result = applyCaptionDrafts(publication, parsed.data, facts);
  const drafted = new Set(
    parsed.data.slots
      .map((slot) => slot.slotId)
      .filter((id) => !result.ignoredSlotIds.includes(id)),
  );
  const marked = edit(result.publication, (draft) => {
    for (const page of draft.pages) {
      for (const slot of page.slots) {
        if (slot.type !== "caption" || !drafted.has(slot.id)) continue;
        slot.caption.sentences = slot.caption.sentences.map((s) => ({ ...s, needs_review: true }));
        slot.caption.needs_review = true;
      }
    }
  });
  return { publication: marked, filled: drafted.size, ignoredSlotIds: result.ignoredSlotIds };
}

/** Next free id for a user-declared fact (`FACT_1`, `FACT_2`, …). */
export function nextFactId(facts: readonly PublicationFact[]): string {
  let n = facts.length + 1;
  while (facts.some((fact) => fact.id === `FACT_${n}`)) n += 1;
  return `FACT_${n}`;
}

/** A positive 31-bit seed (shown to the user, reproducible with the same book). */
export function newSeed(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 0x7ffffffe);
}
