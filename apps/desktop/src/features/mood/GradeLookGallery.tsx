import { useEffect, useRef, useState } from "react";
import {
  GRADE_LOOK_CATALOG,
  GRADE_LOOKS,
  GRADE_STYLE_PRESETS,
  type AssetDTO,
  type GradeLookCategory,
  type GradeLookDescriptor,
  type GradeStylePresetId,
} from "@arch/domain";
import { assetPreview, gradePreview } from "../../lib/bridge";
import { applyGradeToImageData } from "../../lib/grade";
import { useLocale, useT } from "../../i18n";
import { LutLibrary } from "../luts/LutLibrary";
import { THUMB_SIZE } from "../luts/lutApi";
import { useInView, useLazyThumbnail } from "../luts/useLazyThumbnail";
import { STYLE_PRESET_IDS, stylePresetGrade } from "./gradePresets";

export type GalleryCategory = GradeLookCategory | "all" | "style" | "lut";

const LOOK_CATEGORIES: readonly (GradeLookCategory | "all")[] = [
  "all",
  "natural",
  "warm",
  "cool",
  "editorial",
  "cinematic",
  "special",
];

/** A tile is graded from real pixels of the selected image, never from a decorative stock image. */
function GradeLookTile({
  descriptor,
  original,
  selected,
  disabled,
  locale,
  onSelect,
}: {
  descriptor: GradeLookDescriptor;
  original: ImageData | null;
  selected: boolean;
  disabled: boolean;
  locale: "vi" | "en";
  onSelect: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const visible = useInView(button);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !original || !visible) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = original.width;
    canvas.height = original.height;
    const pixels = new Uint8ClampedArray(original.data);
    applyGradeToImageData(pixels, GRADE_LOOKS[descriptor.id], pixels);
    ctx.putImageData(new ImageData(pixels, original.width, original.height), 0, 0);
  }, [descriptor.id, original, visible]);
  return (
    <button
      ref={button}
      type="button"
      className={`grade-look-tile ${selected ? "grade-look-tile-selected" : ""}`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      data-testid={`grade-look-${descriptor.id}`}
      title={locale === "vi" ? descriptor.descriptionVi : descriptor.descriptionEn}
    >
      <canvas ref={ref} className="grade-look-thumb" aria-hidden="true" />
      <span className="grade-look-name">
        {locale === "vi" ? descriptor.labelVi : descriptor.labelEn}
      </span>
    </button>
  );
}

/** A v2 style preset tile: a real 256 px `grade_preview` of the current asset. */
function StylePresetTile({
  id,
  asset,
  selected,
  matches,
  disabled,
  locale,
  onSelect,
}: {
  id: GradeStylePresetId;
  asset: AssetDTO | null;
  selected: boolean;
  matches: boolean;
  disabled: boolean;
  locale: "vi" | "en";
  onSelect: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const visible = useInView(ref);
  const ready = asset?.status === "ready";
  const projectId = asset?.projectId ?? "";
  const assetId = asset?.id ?? "";
  const key = ready ? `${projectId}:${assetId}:${id}` : null;
  const thumb = useLazyThumbnail(key, visible, () =>
    gradePreview({ projectId, assetId, grade: stylePresetGrade(id), size: THUMB_SIZE }),
  );
  const preset = GRADE_STYLE_PRESETS[id];
  return (
    <button
      ref={ref}
      type="button"
      className={`grade-look-tile ${selected ? "grade-look-tile-selected" : ""}`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      data-testid={`grade-style-${id}`}
      title={matches ? t("moodGrade.styleMatchHint") : undefined}
    >
      {thumb.url ? (
        <img src={thumb.url} alt="" className="grade-look-thumb" onError={thumb.onImageError} />
      ) : (
        <span className="grade-look-thumb grade-look-thumb-state" aria-hidden="true" />
      )}
      <span className="grade-look-name">{locale === "vi" ? preset.vi : preset.en}</span>
      {matches && (
        <span className="grade-style-badge" data-testid={`grade-style-badge-${id}`}>
          {t("moodGrade.styleMatch")}
        </span>
      )}
    </button>
  );
}

/**
 * The selected asset is fetched once at thumbnail resolution, then each preset runs through
 * the *same* ColorGrade pixel implementation used by the full-size GradeCanvas and Tauri.
 * Style presets (v2) and LUTs use backend previews of the same asset instead.
 * Clicking a tile only updates the existing ColorGradeDNA; it never submits an AI job.
 */
export function GradeLookGallery({
  asset,
  value,
  disabled = false,
  styleMatches,
  lutId,
  lutStrength,
  onChange,
  onLut,
  onLutStrength,
}: {
  asset: AssetDTO | null;
  /** Selected v1 look id or style preset id. */
  value?: string;
  disabled?: boolean;
  /** Style presets that fit the project style (they get a badge). */
  styleMatches?: ReadonlySet<string>;
  lutId?: string;
  lutStrength?: number;
  /** Called with a v1 look id or a style preset id. */
  onChange: (id: string) => void;
  /** When given, the LUT tab is offered; null clears the LUT. */
  onLut?: (lutId: string | null) => void;
  onLutStrength?: (value: number) => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const [category, setCategory] = useState<GalleryCategory>("all");
  const categories: GalleryCategory[] = onLut
    ? [...LOOK_CATEGORIES, "style", "lut"]
    : [...LOOK_CATEGORIES, "style"];
  const lookCategory = category !== "style" && category !== "lut";
  // Keyed by asset so a response for a previous asset can never show for the current one.
  const [loaded, setLoaded] = useState<{ key: string; image: ImageData | null; error: boolean }>({
    key: "",
    image: null,
    error: false,
  });
  const projectId = asset?.projectId;
  const assetId = asset?.id;
  const assetReady = asset?.status === "ready";
  const assetKey = projectId && assetId && assetReady ? `${projectId}:${assetId}` : "";
  const original = loaded.key === assetKey ? loaded.image : null;
  const error = loaded.key === assetKey && loaded.error;
  const needsOriginal = lookCategory && loaded.key !== assetKey;

  useEffect(() => {
    if (!projectId || !assetId || !assetKey || !needsOriginal) return;
    let cancelled = false;
    void (async () => {
      try {
        const blob = await assetPreview({ projectId, assetId, maxEdge: 384 });
        if (cancelled) return;
        const bitmap = await createImageBitmap(blob);
        try {
          if (cancelled) return;
          const canvas = document.createElement("canvas");
          const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Canvas unavailable");
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (!cancelled) setLoaded({ key: assetKey, image, error: false });
        } finally {
          bitmap.close();
        }
      } catch {
        if (!cancelled) setLoaded({ key: assetKey, image: null, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, assetKey, projectId, needsOriginal]);

  const visible = lookCategory
    ? GRADE_LOOK_CATALOG.filter((look) => category === "all" || look.category === category)
    : [];
  return (
    <div className="grade-look-gallery" data-testid="grade-look-gallery">
      <div
        className="grade-look-categories"
        role="group"
        aria-label={t("moodGrade.gradeCategories")}
      >
        {categories.map((key) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${category === key ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={category === key}
            data-testid={`grade-category-${key}`}
            onClick={() => setCategory(key)}
          >
            {t(`moodGrade.gradeCategory.${key}`)}
          </button>
        ))}
      </div>
      {!assetReady && category !== "lut" && (
        <p className="field-hint">{t("moodGrade.galleryNeedsImage")}</p>
      )}
      {lookCategory && assetReady && !original && !error && (
        <p className="field-hint">{t("moodGrade.galleryLoading")}</p>
      )}
      {lookCategory && error && (
        <p className="field-hint" role="alert">
          {t("moodGrade.previewError")}
        </p>
      )}
      {category === "style" && (
        <>
          <p className="field-hint">{t("moodGrade.styleGroupHint")}</p>
          <div className="grade-look-grid" data-testid="grade-style-grid">
            {STYLE_PRESET_IDS.map((id) => (
              <StylePresetTile
                key={id}
                id={id}
                asset={asset}
                locale={locale}
                matches={!!styleMatches?.has(id)}
                selected={value === id}
                disabled={disabled}
                onSelect={() => onChange(id)}
              />
            ))}
          </div>
        </>
      )}
      {category === "lut" && onLut && (
        <LutLibrary
          asset={asset}
          selectedLutId={lutId}
          strength={lutStrength}
          disabled={disabled}
          onSelect={onLut}
          onStrength={(next) => onLutStrength?.(next)}
        />
      )}
      {lookCategory && (
        <>
          <div className="grade-look-grid">
            {visible.map((look) => (
              <GradeLookTile
                key={look.id}
                descriptor={look}
                original={original}
                locale={locale}
                selected={value === look.id}
                disabled={disabled}
                onSelect={() => onChange(look.id)}
              />
            ))}
          </div>
          <p className="field-hint">{t("moodGrade.galleryNotice")}</p>
        </>
      )}
    </div>
  );
}
