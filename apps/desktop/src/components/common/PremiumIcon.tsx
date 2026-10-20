export const PREMIUM_ICON_IDS = [
  "atmosphere",
  "car",
  "closeup",
  "clouds",
  "color",
  "composite",
  "create-image",
  "day",
  "edit",
  "enhance",
  "export",
  "favorite",
  "fog",
  "hdr",
  "industrial",
  "isometric",
  "long-exposure",
  "night",
  "people",
  "pet",
  "portfolio",
  "preset-grid",
  "public-building",
  "rain",
  "resort",
  "settings",
  "share",
  "sharpen",
  "sunset",
  "sunstar",
  "townhouse",
  "tree",
  "video",
  "view",
  "villa",
  "volumetric",
  "waves",
  "wide-view",
] as const;

export type PremiumIconId = (typeof PREMIUM_ICON_IDS)[number];

/** Decorative premium duotone icon — display only, never influences preset semantics. */
export function PremiumIcon({
  id,
  size = 21,
  className = "",
}: {
  id: PremiumIconId;
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}preset-icons/premium/${id}.svg`}
      className={`premium-icon ${className}`.trim()}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
