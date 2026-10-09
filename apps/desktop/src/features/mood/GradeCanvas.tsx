import { useEffect, useRef, useState } from "react";
import type { AssetDTO, ColorGradeDNA } from "@arch/domain";
import { assetPreview } from "../../lib/bridge";
import { applyGradeToImageData } from "../../lib/grade";
import { useT } from "../../i18n";

export function GradeCanvas({ asset, grade }: { asset: AssetDTO | null; grade: ColorGradeDNA }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<ImageData | null>(null);
  const loadEpoch = useRef(0);
  const renderEpoch = useRef(0);
  const [mode, setMode] = useState<"before" | "after" | "split">("after");
  const [split, setSplit] = useState(50);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [errorAssetKey, setErrorAssetKey] = useState<string | null>(null);
  const t = useT();
  const assetId = asset?.id;
  const projectId = asset?.projectId;
  const assetStatus = asset?.status;
  const assetKey = projectId && assetId ? `${projectId}:${assetId}` : null;
  const previewError = errorAssetKey === assetKey;

  useEffect(() => {
    const epoch = ++loadEpoch.current;
    originalRef.current = null;
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
      const graded = new Uint8ClampedArray(original.data);
      // Grade in small slices so moving a slider yields to painting and pointer events.
      const chunkSize = 256 * 256 * 4;
      let offset = 0;
      const schedule =
        globalThis.requestAnimationFrame ??
        ((callback: FrameRequestCallback) => setTimeout(callback, 0));
      const finish = () => {
        if (cancelled || renderEpoch.current !== epoch) return;
        context.putImageData(new ImageData(graded, width, height), 0, 0);
        if (mode !== "split") return;
        const cut = Math.round((width * split) / 100);
        context.save();
        context.beginPath();
        context.rect(0, 0, cut, height);
        context.clip();
        context.putImageData(original, 0, 0);
        context.restore();
        context.fillStyle = "rgba(255,255,255,.8)";
        context.fillRect(Math.max(0, cut - 1), 0, 2, height);
      };
      const process = () => {
        if (cancelled || renderEpoch.current !== epoch) return;
        const end = Math.min(graded.length, offset + chunkSize);
        const chunk = graded.subarray(offset, end);
        applyGradeToImageData(chunk, grade, chunk);
        offset = end;
        if (offset < graded.length) schedule(process);
        else finish();
      };
      process();
    } catch {
      setErrorAssetKey(assetKey);
    }
    return () => {
      cancelled = true;
    };
  }, [assetKey, grade, mode, previewVersion, split]);

  if (!asset)
    return (
      <div className="state" data-testid="grade-preview-empty">
        {t("moodGrade.noImage")}
      </div>
    );
  return (
    <div className="grade-preview" data-testid="grade-preview">
      <canvas ref={canvasRef} aria-label={t("moodGrade.grade")} />
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
      </div>
    </div>
  );
}
