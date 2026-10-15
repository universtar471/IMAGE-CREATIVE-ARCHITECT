/**
 * Intent detection in the free-text extra prompt (vi with and without diacritics, en).
 *
 * Text is lower-cased (NFC) and folded: diacritics stripped and "đ" → "d". Folding keeps
 * every character position, so a match index is valid in both forms. Most patterns are
 * written folded and therefore match accented and unaccented Vietnamese alike; a pattern is
 * kept accent-only when its folded form is ambiguous ("đêm" night vs "đem" bring).
 *
 * A match preceded within three words by a negation ("do not", "không", "đừng", "never" …)
 * is ignored, so "không xóa nhà bên cạnh" does not read as a request to remove the
 * neighbour.
 */

export type PreparedText = { lower: string; folded: string };

export function prepareText(text: string): PreparedText {
  const lower = text.normalize("NFC").toLowerCase();
  const folded = lower.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC").replace(/đ/g, "d");
  // Safety net: if folding ever changed the length, use the folded text for both.
  return folded.length === lower.length ? { lower, folded } : { lower: folded, folded };
}

export type PhraseSet = {
  /** Patterns matched against the folded text (plain ASCII words). */
  folded: readonly string[];
  /** Patterns matched against the accented, lower-cased text. */
  accented?: readonly string[];
};

const bounded = (body: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "gu");

// Checked on the accented text: unaccented "dung" is ambiguous (đừng / đúng / dùng).
const NEGATION =
  /(?:^|[^\p{L}\p{N}'])(?:don'?t|do not|does not|never|not|no|without|avoid|không|khong|ko|đừng|chẳng|chang|cấm)(?:\s+[\p{L}\p{N}'-]+){0,3}\s*$/u;

export type PhraseMatch = { index: number; text: string };

const compiled = new WeakMap<PhraseSet, { folded: RegExp[]; accented: RegExp[] }>();

function regexes(set: PhraseSet) {
  let entry = compiled.get(set);
  if (!entry) {
    entry = {
      folded: set.folded.map(bounded),
      accented: (set.accented ?? []).map(bounded),
    };
    compiled.set(set, entry);
  }
  return entry;
}

/** Every non-negated match, ordered by position (ties: longer first). */
export function findPhrases(text: PreparedText, set: PhraseSet): PhraseMatch[] {
  const { folded, accented } = regexes(set);
  const found: PhraseMatch[] = [];
  const scan = (source: string, list: readonly RegExp[]) => {
    for (const re of list) {
      for (const m of source.matchAll(re)) {
        const index = m.index;
        if (NEGATION.test(text.lower.slice(Math.max(0, index - 40), index))) continue;
        found.push({ index, text: text.lower.slice(index, index + m[0].length) });
      }
    }
  };
  scan(text.folded, folded);
  scan(text.lower, accented);
  return found.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
}

export function firstPhrase(text: PreparedText, set: PhraseSet): PhraseMatch | null {
  return findPhrases(text, set)[0] ?? null;
}

// ---------------------------------------------------------------- phrase sets

const NEIGHBOUR_EN =
  "(?:neighbou?r(?:ing)?|adjacent|adjoining|next[- ]door|surrounding|attached)(?: (?:houses?|buildings?|townhouses?|structures?|homes?|blocks?))?|neighbou?rs";
const NEIGHBOUR_VI =
  "(?:(?:cac|nhung|2|hai) )?(?:(?:can |toa |day )?nha |cong trinh )?(?:ben canh|hang xom|ke ben|ke canh|lien ke|sat vach|xung quanh|hai ben|2 ben)";

/** Requests to remove or clear the neighbouring buildings. */
export const REMOVE_NEIGHBOUR_PHRASES: PhraseSet = {
  folded: [
    `(?:remove|delete|erase|clear|demolish|get rid of|take away|take out|eliminate|cut out)(?: all)?(?: of)?(?: the| any)? (?:${NEIGHBOUR_EN})`,
    `without(?: the| any)? (?:${NEIGHBOUR_EN})`,
    "no (?:neighbou?rs|neighbou?ring (?:houses|buildings))",
    "(?:make|render|show)(?: it| the (?:house|building|townhouse))? (?:as )?(?:a )?(?:detached|freestanding|free-standing|standalone|stand-alone)",
    "(?:isolated|detached|freestanding|standalone) (?:house|building|townhouse)",
    // Not "do" (also "because of") nor "che" ("cây che nhà bên cạnh" is planting).
    `(?:xoa|xoa bo|xoa di|bo|bo di|loai bo|do bo|pha|pha bo|giai toa|an|an di) (?:${NEIGHBOUR_VI})`,
    `khong co (?:${NEIGHBOUR_VI})`,
    "tach (?:rieng|roi)(?: (?:khoi|voi) (?:nha )?(?:ben canh|hang xom|lien ke))?",
    "nha (?:doc lap|dung rieng|dung doc lap)",
  ],
};

/** Requests to show or open up a side elevation. */
export const SHOW_SIDE_PHRASES: PhraseSet = {
  folded: [
    "(?:(?:left|right) )?side (?:facades?|elevations?|walls?|faces?|windows?)",
    "(?:show|reveal|open|open up|expose|display|see|view)(?: up)?(?: the| both)?(?: (?:left|right))? sides?(?: of the (?:house|building|townhouse))?",
    "exposed (?:side|sides|side wall|side facade)",
    "(?:two|both|2) (?:street )?(?:facades|elevations|frontages|street fronts)",
    "two[- ]sided (?:view|facade|building)",
    "mat (?:hong|ben|dung ben)(?: (?:trai|phai))?",
    "hong nha",
    "(?:mo|mo ra|nhin thay) (?:mat )?hong",
    "(?:hai|2) mat tien",
    "cua so (?:ben )?hong",
  ],
  // Folded "lo hong" is also "lỗ hổng" (a hole), so "lộ hông" is matched accented only.
  accented: ["(?:làm |để )?lộ (?:ra )?(?:mặt )?hông"],
};

/** Requests to turn the plot into a corner condition. */
export const CORNER_PHRASES: PhraseSet = {
  folded: [
    "corner (?:lot|plot|house|building|site|view|townhouse|condition)",
    "(?:street|road) corner",
    "(?:street )?intersection",
    "lo goc",
    "nha goc",
    "can goc",
    "nga (?:tu|ba)",
  ],
};

/** Requests to show the rear elevation. */
export const REAR_FACADE_PHRASES: PhraseSet = {
  folded: [
    "(?:rear|back) (?:facades?|elevations?|views?|sides?|of the (?:house|building|townhouse))",
    // Not bare "phía sau" / "mặt sau": "cây phía sau" is only "trees behind".
    "mat (?:dung )?(?:sau|hau) (?:nha|cong trinh|ngoi nha)",
    "mat (?:dung )?hau",
    "mat dung sau",
  ],
};

export const LEFT_SIDE_PHRASES: PhraseSet = {
  folded: ["left(?:[- ]hand)?", "(?:ben|phia|hong|mat|canh|tuong) trai"],
  accented: ["trái"],
};

export const RIGHT_SIDE_PHRASES: PhraseSet = {
  // "phải" alone also means "must", so only the compound forms count.
  folded: ["right(?:[- ]hand)?", "(?:ben|phia|hong|mat|canh|tuong) phai"],
};

/** Night or dusk lighting. Bare "tối" is left out: "tối giản" is minimalist. */
export const NIGHT_PHRASES: PhraseSet = {
  folded: [
    "night(?:time|[- ]time|fall)?",
    "at night",
    "dusk",
    "twilight",
    "blue hour",
    "evening",
    "sunset",
    "after dark",
    "nocturnal",
    "moon ?lit",
    "moonlight",
    "ban dem",
    "ve dem",
    "canh dem",
    "dem khuya",
    "buoi toi",
    "hoang hon",
    "chang vang",
    "gio xanh",
    "len den",
  ],
  // Folded "chieu toi" / "troi toi" / "toi muon" are also "chiếu tới" / "trôi tới" / "tôi muốn".
  accented: ["đêm", "chiều tối", "trời tối", "tối muộn"],
};

/** Exact measurements: a number with a length or area unit, or an explicit "exact size". */
export const EXACT_DIMENSION_PHRASES: PhraseSet = {
  folded: [
    // A focal length ("24mm lens", "35mm film") is not a dimension.
    "\\d+(?:[.,]\\d+)?\\s?(?:mm|cm|m2|m²|m|met|metres?|meters?|ft|feet|foot|inch(?:es)?|met vuong|square met(?:er|re)s?)(?!\\s?(?:lens|ong kinh|focal|film))",
    "\\d+(?:[.,]\\d+)?\\s?(?:x|×|by)\\s?\\d+(?:[.,]\\d+)?",
    "exact (?:dimensions?|sizes?|measurements?|width|depth|height|length|area|proportions?)",
    "to scale",
    "kich thuoc chinh xac",
    "chinh xac kich thuoc",
    "dung kich thuoc",
    "(?:chieu )?(?:rong|dai|cao|sau) chinh xac",
    "dung ti le",
    "dung ty le",
  ],
};
