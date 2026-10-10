const STYLE_PHRASES: ReadonlyArray<[string[], string]> = [
  [
    ["modern tropical"],
    "Contemporary tropical residential architecture: clean rectilinear massing, deep sun-shading overhangs, operable screens, restrained tropical planting",
  ],
  [
    ["tropical minimalist"],
    "Tropical minimalist architecture: simple geometric volumes, minimal trim, shaded glazing, warm natural timber accents; no resort-style ornament",
  ],
  [
    ["bali style"],
    "Balinese tropical material palette with carved timber accents and lush planting, keeping the reference massing and openings",
  ],
  [
    ["indochine"],
    "Indochine-inspired detailing: restrained dark timber screens, patterned cement tiles, fine brass accents; no added arches or colonial facade elements",
  ],
  [
    ["neo-classical", "neo classic", "tan co dien"],
    "Contemporary neoclassical facade with balanced symmetry, shallow pilasters and restrained mouldings",
  ],
  [
    ["minimalist"],
    "Minimalist architecture: undecorated planes, crisp junctions, few materials, no applied ornament",
  ],
  [
    ["contemporary farmhouse"],
    "Contemporary farmhouse: simple pitched roof, board-and-batten accents, muted natural finishes",
  ],
  [
    ["modern"],
    "Modern architecture: clean lines, flat planes, large glazing, restrained material palette",
  ],
  [
    ["contemporary"],
    "Contemporary architecture: refined proportions, restrained contrast, high-quality facade finishes",
  ],
  [
    ["industrial modern"],
    "Industrial modern: exposed steel frame, standing-seam metal cladding, large factory-style glazing",
  ],
  [
    ["japandi"],
    "Japandi: calm minimal forms, natural timber, soft neutral tones, fine craftsmanship",
  ],
  [
    ["scandinavian"],
    "Scandinavian: pale timber, white walls, simple functional forms, soft daylight",
  ],
  [
    ["mediterranean"],
    "Mediterranean: warm lime plaster, natural stone, terracotta roof tiles; do not add arches unless present in the reference",
  ],
];

const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

export function stylePhrase(style: string | undefined): string | undefined {
  if (!style) return undefined;
  const key = fold(style);
  return STYLE_PHRASES.find(([names]) => names.some((name) => fold(name) === key))?.[1] ?? style;
}
