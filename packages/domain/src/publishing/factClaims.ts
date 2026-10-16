/**
 * Detects sentences that state a project fact (SRS §11.4): a number, place, year, award,
 * brand or author, in Vietnamese (with or without diacritics) and English.
 *
 * The detector is deliberately eager: a false positive only asks the user to link a fact or
 * review the sentence, while a miss would let an unverified claim be published as fact.
 * Patterns run on the folded text (see `prepareText`) unless their folded form is
 * ambiguous ("quận" district vs "quán" café vs "quan" official), in which case they run on
 * the accented text.
 */
import { prepareText } from "../validation/phrases";

export const FACT_CLAIM_KINDS = ["year", "number", "place", "award", "brand", "author"] as const;
export type FactClaimKind = (typeof FACT_CLAIM_KINDS)[number];

export type FactClaim = { kind: FactClaimKind; index: number; text: string };

const word = (body: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "gu");

const YEAR = word("(?:1[5-9]\\d{2}|20\\d{2})");
const DIGITS = /\p{N}+(?:[.,]\p{N}+)*/gu;

type Rule = { kind: FactClaimKind; on: "folded" | "accented" | "raw"; pattern: RegExp };

const VI_NUMBER_WORDS = "hai|ba|bốn|tư|năm|sáu|bảy|tám|chín|mười|trăm|nghìn|ngàn";
const VI_UNITS = "tầng|lầu|phòng|mét|m2|m²|héc-ta|hécta|ha|căn|khối|năm";
const EN_NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|dozen";
const EN_UNITS =
  "storeys?|stor(?:y|ies)|floors?|levels?|bedrooms?|rooms?|met(?:er|re)s?|square|hectares?|units?|years?|apartments?|villas?";

/** Brands often named on Vietnamese architecture sheets (fixtures, finishes, systems). */
const BRANDS = [
  "an cuong",
  "blum",
  "bosch",
  "caesar",
  "daikin",
  "dulux",
  "egger",
  "grohe",
  "hafele",
  "hansgrohe",
  "hettich",
  "inax",
  "jotun",
  "kingspan",
  "knauf",
  "kohler",
  "laufen",
  "panasonic",
  "rehau",
  "saint-gobain",
  "schneider",
  "toto",
  "vicostone",
  "viglacera",
  "xingfa",
];

/** Places stated by name; matched folded so "Hà Nội", "Ha Noi" and "Hanoi" all count. */
const PLACES = [
  "viet nam",
  "vietnam",
  "ha noi",
  "hanoi",
  "sai gon",
  "saigon",
  "ho chi minh",
  "da nang",
  "hai phong",
  "nha trang",
  "da lat",
  "can tho",
  "vung tau",
  "phu quoc",
  "ha long",
  "hoi an",
  "quy nhon",
  "hue",
];

const RULES: readonly Rule[] = [
  { kind: "number", on: "accented", pattern: word(`(?:${VI_NUMBER_WORDS})\\s+(?:${VI_UNITS})`) },
  { kind: "number", on: "folded", pattern: word(`(?:${EN_NUMBER_WORDS})[-\\s]+(?:${EN_UNITS})`) },
  {
    kind: "award",
    on: "folded",
    pattern: word(
      "giai thuong|doat giai|dat giai|giai nhat|giai vang|vinh danh|award(?:s|ed|-winning)?|prizes?|winner|winning|shortlisted|laureate|honou?red",
    ),
  },
  {
    kind: "author",
    on: "folded",
    pattern: word(
      "kien truc su|kts|thiet ke boi|tac gia|nha thiet ke|chu dau tu|architects?|designed by|design by|authored by|author|developer|client",
    ),
  },
  {
    kind: "brand",
    on: "folded",
    pattern: word(
      `thuong hieu|nhan hieu|nha cung cap|brand(?:ed|s)?|manufactured by|supplied by|made by|${BRANDS.join("|")}`,
    ),
  },
  { kind: "brand", on: "accented", pattern: word("hãng") },
  { kind: "brand", on: "raw", pattern: /[®™]/gu },
  {
    kind: "place",
    on: "folded",
    pattern: word(
      `dia chi|toa lac|nam tai|located (?:in|at)|situated (?:in|at)|address|district|province|ward|city of|${PLACES.join("|")}`,
    ),
  },
  { kind: "place", on: "accented", pattern: word("quận|huyện|phường|tỉnh|thành phố|thị xã|tp\\.") },
  // A lower-case preposition followed by a capitalised name: "in Hanoi", "tại Đà Lạt".
  {
    kind: "place",
    on: "raw",
    pattern:
      /(?<![\p{L}\p{N}])(?:in|at|near|tại|ở|gần)\s+(?!(?:The|This|That|These|Those|A|An|Our|Its|Their|Night|Day|Spring|Summer|Autumn|Winter)(?![\p{L}]))\p{Lu}\p{L}+/gu,
  },
];

/** Every factual claim in `text`, ordered by position. */
export function detectFactClaims(text: string): FactClaim[] {
  const prepared = prepareText(text);
  const raw = text.normalize("NFC");
  const claims: FactClaim[] = [];
  const years = new Set<number>();

  for (const match of prepared.folded.matchAll(YEAR)) {
    years.add(match.index);
    claims.push({ kind: "year", index: match.index, text: match[0] });
  }
  for (const match of prepared.folded.matchAll(DIGITS)) {
    if (years.has(match.index) && match[0].length === 4) continue;
    claims.push({ kind: "number", index: match.index, text: match[0] });
  }
  for (const rule of RULES) {
    const source =
      rule.on === "folded" ? prepared.folded : rule.on === "accented" ? prepared.lower : raw;
    for (const match of source.matchAll(rule.pattern)) {
      claims.push({ kind: rule.kind, index: match.index, text: match[0] });
    }
  }
  return claims.sort((a, b) => a.index - b.index || a.kind.localeCompare(b.kind));
}

export function hasFactClaim(text: string): boolean {
  return detectFactClaims(text).length > 0;
}

/** Splits free text into sentences (., !, ?, … and line breaks), trimmed and non-empty. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}
