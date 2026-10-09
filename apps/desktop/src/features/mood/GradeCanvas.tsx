import { useEffect, useRef, useState } from "react";
import type { AssetDTO, ColorGradeDNA } from "@arch/domain";
import { fileUrl } from "../../lib/files";
import { applyGradeToImageData } from "../../lib/grade";
import { useT } from "../../i18n";

export function GradeCanvas({ asset, grade }: { asset: AssetDTO | null; grade: ColorGradeDNA }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"before" | "after" | "split">("after");
  const [split, setSplit] = useState(50);
  const t = useT();
  useEffect(() => {
    if (!asset || asset.status !== "ready") return;
    const src = fileUrl(asset.absolutePath);
    if (!src) return;
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (!alive) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const w = Math.max(1, Math.round(image.naturalWidth * scale));
      const h = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(image, 0, 0, w, h);
      const original = ctx.getImageData(0, 0, w, h);
      if (mode === "before") {
        ctx.putImageData(original, 0, 0);
        return;
      }
      const graded = new Uint8ClampedArray(original.data);
      // Grade in small slices so moving a slider yields to painting and pointer events.
      const chunkSize = 256 * 256 * 4;
      let offset = 0;
      const schedule =
        globalThis.requestAnimationFrame ??
        ((callback: FrameRequestCallback) => setTimeout(callback, 0));
      const finish = () => {
        if (!alive) return;
        if (mode === "after") {
          ctx.putImageData(new ImageData(graded, w, h), 0, 0);
          return;
        }
        ctx.putImageData(new ImageData(graded, w, h), 0, 0);
        const cut = Math.round((w * split) / 100);
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, cut, h);
        ctx.clip();
        ctx.putImageData(original, 0, 0);
        ctx.restore();
        ctx.fillStyle = "rgba(255,255,255,.8)";
        ctx.fillRect(Math.max(0, cut - 1), 0, 2, h);
      };
      const process = () => {
        if (!alive) return;
        const end = Math.min(graded.length, offset + chunkSize);
        applyGradeToImageData(graded.subarray(offset, end), grade);
        offset = end;
        if (offset < graded.length) schedule(process);
        else finish();
      };
      process();
    };
    image.src = src;
    return () => {
      alive = false;
    };
  }, [asset, grade, mode, split]);
  if (!asset)
    return (
      <div className="state" data-testid="grade-preview-empty">
        {t("moodGrade.noImage")}
      </div>
    );
  return (
    <div className="grade-preview" data-testid="grade-preview">
      <canvas ref={canvasRef} aria-label={t("moodGrade.grade")} />
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
