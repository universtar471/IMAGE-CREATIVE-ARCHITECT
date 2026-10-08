/** Pure viewport math for the image viewer (unit-tested). */
export type View = { scale: number; x: number; y: number };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 16;
export const FIT_PADDING = 24;

export const clampZoom = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));

/** Largest scale that fits the image inside the box (with padding), never upscaling past 100%. */
export function fitScale(imgW: number, imgH: number, boxW: number, boxH: number): number {
  if (!imgW || !imgH || !boxW || !boxH) return 1;
  const s = Math.min((boxW - FIT_PADDING * 2) / imgW, (boxH - FIT_PADDING * 2) / imgH, 1);
  return clampZoom(Math.max(s, MIN_ZOOM));
}

/** Zoom to `scale` keeping the image point under (cx, cy) fixed on screen. */
export function zoomAround(v: View, scale: number, cx: number, cy: number): View {
  const k = scale / v.scale;
  return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}
