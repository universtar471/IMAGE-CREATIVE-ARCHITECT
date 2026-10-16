/** Seeded randomness for the planner and `randomize` (same seed → same result). */

/** mulberry32: a small, fast PRNG with a 32-bit state. Returns values in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over a seed and a key: an independent stream per page or per purpose. */
export function subSeed(seed: number, key: string): number {
  let hash = 0x811c9dc5 ^ (seed >>> 0);
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** One deterministic pick from a non-empty list. */
export function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;
}
