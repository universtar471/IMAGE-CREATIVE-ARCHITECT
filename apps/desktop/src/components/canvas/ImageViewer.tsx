/**
 * Reusable image viewer: fit, zoom (buttons / wheel around cursor), pan when zoomed.
 * Knows nothing about assets or persistence; future compare/mask/QC tools layer on top
 * through `overlay` and the toolbar `extraTools` slot.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Maximize, Minus, Plus, Scan } from "lucide-react";
import { clampZoom, fitScale, MAX_ZOOM, MIN_ZOOM, zoomAround, type View } from "./viewMath";
import { useT } from "../../i18n";

export type ImageDisplayRect = { left: number; top: number; width: number; height: number };
export type ImageViewerProps = {
  src: string;
  alt: string;
  /** Known pixel size (from asset metadata) so layout is right before the image decodes. */
  naturalWidth?: number | null;
  naturalHeight?: number | null;
  info?: ReactNode;
  overlay?: ReactNode | ((rect: ImageDisplayRect) => ReactNode);
  extraTools?: ReactNode;
  onError?: () => void;
};

export function ImageViewer({
  src,
  alt,
  naturalWidth,
  naturalHeight,
  info,
  overlay,
  extraTools,
  onError,
}: ImageViewerProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: naturalWidth ?? 0, h: naturalHeight ?? 0 });
  const [manualView, setManualView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [fitted, setFitted] = useState(true);
  const [panning, setPanning] = useState(false);
  const panStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Track container size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // In fit mode the view is derived from sizes (follows resizes); otherwise it is user state.
  // Parents remount the viewer (key) for a new image, so no reset effect is needed.
  const fitScaleValue = fitScale(natural.w, natural.h, box.w, box.h);
  const view: View = fitted
    ? {
        scale: fitScaleValue,
        x: (box.w - natural.w * fitScaleValue) / 2,
        y: (box.h - natural.h * fitScaleValue) / 2,
      }
    : manualView;

  const zoomTo = (scale: number, cx = box.w / 2, cy = box.h / 2) => {
    setFitted(false);
    setManualView(zoomAround(view, clampZoom(scale), cx, cy));
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomTo(view.scale * factor, e.clientX - rect.left, e.clientY - rect.top);
  };

  const pannable = natural.w * view.scale > box.w + 1 || natural.h * view.scale > box.h + 1;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pannable || e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    panStart.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = panStart.current;
    if (!s) return;
    setFitted(false);
    setManualView({ scale: view.scale, x: s.x + e.clientX - s.px, y: s.y + e.clientY - s.py });
  };
  const endPan = () => {
    panStart.current = null;
    setPanning(false);
  };

  return (
    <div
      ref={containerRef}
      className={`viewer ${pannable ? "is-pannable" : ""} ${panning ? "is-panning" : ""}`}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={() => setFitted(true)}
      data-testid="image-viewer"
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        style={{
          width: natural.w || undefined,
          height: natural.h || undefined,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          visibility: natural.w ? "visible" : "hidden",
        }}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth !== natural.w || img.naturalHeight !== natural.h) {
            setNatural({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
        onError={onError}
      />
      {typeof overlay === "function"
        ? overlay({
            left: view.x,
            top: view.y,
            width: natural.w * view.scale,
            height: natural.h * view.scale,
          })
        : overlay}
      {info && <div className="viewer-info">{info}</div>}
      <div className="viewer-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => zoomTo(view.scale / 1.25)}
          disabled={view.scale <= MIN_ZOOM}
          aria-label={t("canvas.zoomOut")}
          title={t("canvas.zoomOut")}
        >
          <Minus size={14} />
        </button>
        <span className="zoom-label" aria-label={t("canvas.zoomLevel")}>
          {Math.round(view.scale * 100)}%
        </span>
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={() => zoomTo(view.scale * 1.25)}
          disabled={view.scale >= MAX_ZOOM}
          aria-label={t("canvas.zoomIn")}
          title={t("canvas.zoomIn")}
        >
          <Plus size={14} />
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setFitted(true)}
          aria-label={t("canvas.fitLabel")}
          title={t("canvas.fitTitle")}
        >
          <Maximize size={14} /> {t("canvas.fit")}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => zoomTo(1)}
          aria-label={t("canvas.actualLabel")}
          title={t("canvas.actualTitle")}
        >
          <Scan size={14} /> 1:1
        </button>
        {extraTools}
      </div>
    </div>
  );
}
