import { useEffect, useRef, useState } from "react";
import {
  GRADE_LOOK_CATALOG,
  GRADE_LOOKS,
  type AssetDTO,
  type GradeLookCategory,
  type GradeLookDescriptor,
} from "@arch/domain";
import { assetPreview } from "../../lib/bridge";
import { applyGradeToImageData } from "../../lib/grade";
import { useLocale, useT } from "../../i18n";

const CATEGORIES: readonly (GradeLookCategory | "all")[] = [
  "all", "natural", "warm", "cool", "editorial", "cinematic", "special",
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
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !original) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = original.width;
    canvas.height = original.height;
    const pixels = new Uint8ClampedArray(original.data);
    applyGradeToImageData(pixels, GRADE_LOOKS[descriptor.id], pixels);
    ctx.putImageData(new ImageData(pixels, original.width, original.height), 0, 0);
  }, [descriptor.id, original]);
  return (
    <button
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

/**
 * The selected asset is fetched once at thumbnail resolution, then each preset runs through
 * the *same* ColorGrade pixel implementation used by the full-size GradeCanvas and Tauri.
 * Clicking a tile only updates the existing ColorGradeDNA; it never submits an AI job.
 */
export function GradeLookGallery({
  asset,
  value,
  disabled = false,
  onChange,
}: {
  asset: AssetDTO | null;
  value?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const [category, setCategory] = useState<GradeLookCategory | "all">("all");
  const [original, setOriginal] = useState<ImageData | null>(null);
  const [error, setError] = useState(false);
  const projectId = asset?.projectId;
  const assetId = asset?.id;
  const assetReady = asset?.status === "ready";

  useEffect(() => {
    let cancelled = false;
    setOriginal(null);
    setError(false);
    if (!projectId || !assetId || !assetReady) return;
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
          if (!cancelled) setOriginal(ctx.getImageData(0, 0, canvas.width, canvas.height));
        } finally {
          bitmap.close();
        }
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [assetId, assetReady, projectId]);

  const visible = GRADE_LOOK_CATALOG.filter((look) => category === "all" || look.category === category);
  return (
    <div className="grade-look-gallery" data-testid="grade-look-gallery">
      <div className="grade-look-categories" role="group" aria-label={t("moodGrade.gradeCategories")}>
        {CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            className={`btn btn-sm ${category === key ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={category === key}
            onClick={() => setCategory(key)}
          >
            {t(`moodGrade.gradeCategory.${key}`)}
          </button>
        ))}
      </div>
      {!assetReady && <p className="field-hint">{t("moodGrade.galleryNeedsImage")}</p>}
      {assetReady && !original && !error && <p className="field-hint">{t("moodGrade.galleryLoading")}</p>}
      {error && <p className="field-hint" role="alert">{t("moodGrade.previewError")}</p>}
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
    </div>
  );
}
