export const ARCH_LUT_FILTER = {
  exclude: [
    "food",
    "wedding",
    "portrait",
    "nude",
    "boho",
    "insta",
    "men",
    "rose gold",
    "peach",
    "royal",
    "majestic",
    "bright wedding",
    "rover",
  ],
  prefer: [
    "aerial",
    "drone",
    "urban",
    "city",
    "landscape",
    "scenery",
    "natural",
    "earthy",
    "gray",
    "kodak",
    "film",
    "japan",
    "night",
    "cinematic",
    "moody",
    "teal",
    "travel",
  ],
};

export function isLogLut(name: string): boolean {
  return /\b(d-?log|s-?log|v-?log|log)\b/i.test(name);
}
