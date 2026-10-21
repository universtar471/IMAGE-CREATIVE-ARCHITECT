import { useEffect, useRef, useState } from "react";
import { isGradeV2, type AssetDTO, type ColorGradeDNA } from "@arch/domain";
import { assetPreview, gradePreview } from "../../lib/bridge";
import { applyGradeToImageData } from "../../lib/grade";
import { useT } from "../../i18n";

/** Live v2 preview debounce (ADR-031). */
export const GRADE_PREVIEW_DEBOUNCE_MS = 120;
/** Largest edge `grade_preview` renders (API §21.2). */
const V2_PREVIEW_SIZE = 640;

/**
 * Before / After / Split preview of a grade on the real asset.
 * - v1 grades run through the TypeScript pixel path on a 1600 px copy (fast, exact).
 * - Grades with v2 fields or a LUT (`isGradeV2`) are rendered by the backend engine via
 *   `grade_preview`, debounced; an answer for an older grade never replaces a newer one.
 */
export function GradeCanvas({ asset, grade }: { asset: AssetDTO | null; grade: ColorGradeDNA }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<ImageData | null>(null);
  const loadEpoch = useRef(0);
  const renderEpoch = useRef(0);
  const v2Seq = useRef(0);
  const v2Ref = useRef<{ assetKey: string; image: ImageData } | null>(null);
  const [mode, setMode] = useState<"before" | "after" | "split">("after");
  const [split, setSplit] = useState(50);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [v2Version, setV2Version] = useState(0);
  // The request (asset + grade) whose backend render last finished; anything else is pending.
  const [v2Settled, setV2Settled] = useState<string | null>(null);
  const [errorAssetKey, setErrorAssetKey] = useState<string | null>(null);
  const t = useT();
  const assetId = asset?.id;
  const projectId = asset?.projectId;
  const assetStatus = asset?.status;
  const assetKey = projectId && assetId ? `${projectId}:${assetId}` : null;
  const previewError = errorAssetKey === assetKey;
  const v2 = isGradeV2(grade);
  // Value identity for effects: a re-created but equal grade object must not refetch.
  const gradeKey = JSON.stringify(grade);
  const v2Pending = v2 && !!assetKey && v2Settled !== `${assetKey}|${gradeKey}`;

  useEffect(() => {
    const epoch = ++loadEpoch.current;
    originalRef.current = null;
    v2Ref.current = null;
    if (!assetId || !projectId || assetStatus !== "ready") return;
    let cancelled = false;
    void (async () => {
      try {
        const blob = await assetPreview({ projectId, assetId, maxEdge: 1600 });
        if (cancelled || loadEpoch.current !== epoch) return;
        const bitmap = await createImageBitmap(blob);
        try {
          if (cancelled || loadEpoch.current !== epoch) return;
          const offscreen = document.createElement("canvas");
          const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
          const width = Math.max(1, Math.round(bitmap.width * scale));
          const height = Math.max(1, Math.round(bitmap.height * scale));
          offscreen.width = width;
          offscreen.height = height;
          const context = offscreen.getContext("2d");
          if (!context) throw new Error("The preview canvas is unavailable.");
          context.drawImage(bitmap, 0, 0, width, height);
          const original = context.getImageData(0, 0, width, height);
          const canvas = canvasRef.current;
          if (!canvas || cancelled || loadEpoch.current !== epoch) return;
          canvas.width = width;
          canvas.height = height;
          originalRef.current = original;
          setErrorAssetKey(null);
          setPreviewVersion((version) => version + 1);
        } finally {
          bitmap.close();
        }
      } catch {
        if (!cancelled && loadEpoch.current === epoch) setErrorAssetKey(assetKey);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId, assetKey, assetStatus, projectId]);

  // v2: debounced backend render, scaled onto the original's pixel grid.
  useEffect(() => {
    const seq = ++v2Seq.current;
    if (!v2 || !assetId || !projectId || !assetKey || assetStatus !== "ready") return;
    if (!originalRef.current) return; // re-runs once the original is loaded
    const settledKey = `${assetKey}|${gradeKey}`;
    const request = { projectId, assetId, grade: JSON.parse(gradeKey) as ColorGradeDNA };
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const blob = await gradePreview({ ...request, size: V2_PREVIEW_SIZE });
          if (seq !== v2Seq.current) return;
          const original = originalRef.current;
          if (!original) return;
          const bitmap = await createImageBitmap(blob);
          try {
            if (seq !== v2Seq.current) return;
            const offscreen = document.createElement("canvas");
            offscreen.width = original.width;
            offscreen.height = original.height;
            const context = offscreen.getContext("2d");
            if (!context) throw new Error("The preview canvas is unavailable.");
            context.drawImage(bitmap, 0, 0, original.width, original.height);
            v2Ref.current = {
              assetKey,
              image: context.getImageData(0, 0, original.width, original.height),
            };
          } finally {
            bitmap.close();
          }
          setErrorAssetKey(null);
          setV2Settled(settledKey);
          setV2Version((version) => version + 1);
        } catch {
          if (seq !== v2Seq.current) return;
          setV2Settled(settledKey);
          setErrorAssetKey(assetKey);
        }
      })();
    }, GRADE_PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [assetId, assetKey, assetStatus, gradeKey, previewVersion, projectId, v2]);

  useEffect(() => {
    const original = originalRef.current;
    const canvas = canvasRef.current;
    if (!original || !canvas) return;
    const epoch = ++renderEpoch.current;
    let cancelled = false;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The preview canvas is unavailable.");
      const { width, height } = original;
      if (mode === "before") {
        context.putImageData(original, 0, 0);
        return () => {
          cancelled = true;
        };
      }
      const paint = (graded: ImageData) => {
        if (cancelled || renderEpoch.current !== epoch) return;
        context.putImageData(graded, 0, 0);
        if (mode !== "split") return;
        const cut = Math.round((width * split) / 100);
        // putImageData ignores canvas clipping paths. Use its dirty-rectangle
        // overload to restore exactly the left section of the original image.
        context.putImageData(original, 0, 0, 0, 0, cut, height);
        context.fillStyle = "rgba(255,255,255,.8)";
        // Keep the divider visible even when a high-resolution portrait is fitted small.
        const scale = Math.min(canvas.clientWidth / width, canvas.clientHeight / height) || 1;
        const divider = Math.max(2, Math.ceil(2 / scale));
        context.fillRect(Math.max(0, cut - divider / 2), 0, divider, height);
      };
      if (v2) {
        // Until the first backend render for this asset arrives, show the original.
        const rendered = v2Ref.current?.assetKey === assetKey ? v2Ref.current.image : original;
        paint(rendered);
        return () => {
          cancelled = true;
        };
      }
      const graded = new Uint8ClampedArray(original.data);
      // Grade in small slices so moving a slider yields to painting and pointer events.
      const chunkSize = 256 * 256 * 4;
      let offset = 0;
      const schedule =
        globalThis.requestAnimationFrame ??
        ((callback: FrameRequestCallback) => setTimeout(callback, 0));
      const process = () => {
        if (cancelled || renderEpoch.current !== epoch) return;
        const end = Math.min(graded.length, offset + chunkSize);
        const chunk = graded.subarray(offset, end);
        applyGradeToImageData(chunk, grade, chunk);
        offset = end;
        if (offset < graded.length) schedule(process);
        else paint(new ImageData(graded, width, height));
      };
      process();
    } catch {
      setErrorAssetKey(assetKey);
    }
    return () => {
      cancelled = true;
    };
  }, [assetKey, grade, mode, previewVersion, split, v2, v2Version]);

  if (!asset)
    return (
      <div className="state" data-testid="grade-preview-empty">
        {t("moodGrade.noImage")}
      </div>
    );
  return (
    <div
      className="grade-preview"
      data-testid="grade-preview"
      data-engine={v2 ? "v2" : "v1"}
      data-mode={mode}
      aria-busy={v2Pending}
    >
      <div className="grade-preview-image">
        <canvas ref={canvasRef} aria-label={t("moodGrade.grade")} />
        {mode === "split" && (
          <div className="grade-split-labels">
            <span>{t("moodGrade.before")}</span>
            <span>{t("moodGrade.after")}</span>
          </div>
        )}
      </div>
      {previewError && (
        <div className="state" data-testid="grade-preview-error">
          {t("moodGrade.previewError")}
        </div>
      )}
      <div className="grade-preview-toolbar" role="group" aria-label={t("moodGrade.grade")}>
        {(["before", "after", "split"] as const).map((v) => (
          <button
            key={v}
            className={`btn btn-sm ${mode === v ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={mode === v}
            onClick={() => setMode(v)}
          >
            {t(`moodGrade.${v}` as never)}
          </button>
        ))}
        {mode === "split" && (
          <input
            aria-label={t("moodGrade.split")}
            type="range"
            min="0"
            max="100"
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
          />
        )}
        {v2 && (
          <span className="grade-preview-engine" data-testid="grade-preview-engine">
            {t(v2Pending ? "moodGrade.v2Rendering" : "moodGrade.v2Engine")}
          </span>
        )}
      </div>
    </div>
  );
}
