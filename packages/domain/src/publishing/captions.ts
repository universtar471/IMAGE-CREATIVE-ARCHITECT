/**
 * Caption writing (SRS §11.4, ADR-038): the editorial prompt and the fact rule.
 *
 * `buildCaptionPrompt` only builds the request for an optional paid text call; it never
 * calls a provider. Its facts are the confirmed ones only (`verified`/`user_declared`).
 * `applyCaptionDrafts` writes a provider answer back into the existing caption slots and
 * runs the same rule as `validatePublication`: a sentence that states a claim without a
 * confirmed `factRef` is marked `needs_review`.
 */
import { z } from "zod";

import { isConfirmed } from "../facts/evidence";
import { detectFactClaims } from "./factClaims";
import {
  PublicationSchema,
  type CaptionSentence,
  type ImageGroup,
  type Publication,
  type PublicationFact,
  type TextKind,
} from "./schemas";

/** The SRS §11.4 editorial prompt, verbatim. */
export const EDITORIAL_CAPTION_PROMPT = [
  "You are an architectural editor. Write concise Vietnamese captions for the",
  "selected approved images and the chosen publication type.",
  "Use only VERIFIED project facts. Distinguish visible features from inferred intent.",
  "Do not invent areas, project address, architect, construction year, awards,",
  "material brands or client quotations. Return structured text for existing page slots.",
  "Stay within the supplied word and page budget; do not add pages or images.",
].join("\n");

export const CAPTION_PROMPT_VERSION = "pub-caption-1";

export type CaptionPromptSlot = {
  pageId: string;
  slotId: string;
  textKind: TextKind;
  wordLimit: number | null;
  group: ImageGroup | null;
  imageAssetIds: string[];
};

export type CaptionPromptRequest = {
  promptVersion: typeof CAPTION_PROMPT_VERSION;
  prompt: string;
  facts: { id: string; text: string }[];
  slots: CaptionPromptSlot[];
};

export const CaptionDraftResponseSchema = z.object({
  slots: z.array(
    z.object({
      slotId: z.string().trim().min(1),
      sentences: z.array(
        z.object({ text: z.string(), factRef: z.string().trim().min(1).nullable().default(null) }),
      ),
    }),
  ),
});
export type CaptionDraftResponse = z.input<typeof CaptionDraftResponseSchema>;

/** The caption slots a text call may fill: every caption slot on an unlocked page. */
function openCaptionSlots(pub: Publication): CaptionPromptSlot[] {
  const locked = new Set(pub.lockedPageIds);
  return pub.pages.flatMap((page) =>
    locked.has(page.id)
      ? []
      : page.slots.flatMap((slot) =>
          slot.type === "caption"
            ? [
                {
                  pageId: page.id,
                  slotId: slot.id,
                  textKind: slot.caption.textKind,
                  wordLimit: slot.caption.wordLimit ?? null,
                  group: slot.caption.group ?? null,
                  imageAssetIds: [...slot.caption.imageAssetIds],
                },
              ]
            : [],
        ),
  );
}

export function buildCaptionPrompt(
  publication: Publication,
  facts: readonly PublicationFact[],
): CaptionPromptRequest {
  const pub = PublicationSchema.parse(publication);
  const confirmed = facts
    .filter((fact) => isConfirmed(fact))
    .map((fact) => ({ id: fact.id, text: fact.text }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const slots = openCaptionSlots(pub);

  const lines = [
    EDITORIAL_CAPTION_PROMPT,
    "",
    `Publication type: ${pub.type}. Paper: ${pub.paper}. Text density: ${pub.textDensity}. Pages: ${pub.targetPageCount}.`,
    "Text kinds: technical = function and sourced materials/details; editorial = story of space and light, no invented quotes or awards; commercial = benefits and features, figures only from verified data.",
    "",
    "VERIFIED facts (cite the id in factRef for every sentence that uses one):",
    ...(confirmed.length > 0
      ? confirmed.map((fact) => `- [${fact.id}] ${fact.text}`)
      : [
          "- (none: write only about visible features, with no numbers, places, years, awards, brands or authors)",
        ]),
    "",
    "Caption slots to fill:",
    ...slots.map(
      (slot) =>
        `- ${slot.slotId} (page ${slot.pageId}, ${slot.textKind}${slot.group ? `, group ${slot.group}` : ""}, max ${slot.wordLimit ?? "n/a"} words, images ${slot.imageAssetIds.join(", ") || "none"})`,
    ),
    "",
    'Return JSON only: {"slots":[{"slotId":"…","sentences":[{"text":"…","factRef":"fact id or null"}]}]}.',
    "Use only the slot ids listed above.",
  ];
  return {
    promptVersion: CAPTION_PROMPT_VERSION,
    prompt: lines.join("\n"),
    facts: confirmed,
    slots,
  };
}

/** Applies the fact rule to one sentence: unknown/unconfirmed refs are dropped. */
export function reviewSentence(
  sentence: { text: string; factRef?: string | null },
  facts: ReadonlyMap<string, PublicationFact>,
): CaptionSentence {
  const fact = sentence.factRef ? facts.get(sentence.factRef) : undefined;
  const factRef = fact && isConfirmed(fact) ? fact.id : null;
  const claims = detectFactClaims(sentence.text);
  return { text: sentence.text, factRef, needs_review: claims.length > 0 && factRef === null };
}

const factMap = (facts: readonly PublicationFact[]) => new Map(facts.map((f) => [f.id, f]));

/** Recomputes `needs_review` for every caption sentence (locked pages included). */
export function annotateCaptionReview(
  publication: Publication,
  facts: readonly PublicationFact[],
): Publication {
  const pub = PublicationSchema.parse(publication);
  const byId = factMap(facts);
  for (const page of pub.pages) {
    for (const slot of page.slots) {
      if (slot.type !== "caption") continue;
      slot.caption.sentences = slot.caption.sentences.map((s) => reviewSentence(s, byId));
      slot.caption.needs_review = slot.caption.sentences.some((s) => s.needs_review);
    }
  }
  return pub;
}

/**
 * Writes drafted captions into existing caption slots of unlocked pages. Slots that do not
 * exist (or sit on locked pages) are reported and ignored: a text call never adds slots.
 */
export function applyCaptionDrafts(
  publication: Publication,
  response: CaptionDraftResponse,
  facts: readonly PublicationFact[],
): { publication: Publication; ignoredSlotIds: string[] } {
  const pub = PublicationSchema.parse(publication);
  const drafts = CaptionDraftResponseSchema.parse(response);
  const byId = factMap(facts);
  const open = new Set(openCaptionSlots(pub).map((slot) => slot.slotId));
  const ignoredSlotIds: string[] = [];
  for (const draft of drafts.slots) {
    if (!open.has(draft.slotId)) {
      ignoredSlotIds.push(draft.slotId);
      continue;
    }
    for (const page of pub.pages) {
      for (const slot of page.slots) {
        if (slot.type !== "caption" || slot.id !== draft.slotId) continue;
        slot.caption.sentences = draft.sentences.map((s) => reviewSentence(s, byId));
        slot.caption.needs_review = slot.caption.sentences.some((s) => s.needs_review);
      }
    }
  }
  return { publication: PublicationSchema.parse(pub), ignoredSlotIds };
}
