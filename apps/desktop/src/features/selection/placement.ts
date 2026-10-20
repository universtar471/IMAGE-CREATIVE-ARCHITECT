/**
 * Where the floating toolbar goes (ADR-044): above the selected node when there is room,
 * otherwise below it, always clamped inside its container so it never leaves the canvas or
 * covers the canvas controls. Pure: rectangles in container CSS px.
 */
export type Rect = { left: number; top: number; width: number; height: number };
export type Size = { width: number; height: number };
export type ToolbarPlacement = { left: number; top: number; side: "above" | "below" | "inside" };

export const TOOLBAR_GAP = 10;
export const EDGE_PADDING = 8;

export function placeToolbar(anchor: Rect, toolbar: Size, container: Size): ToolbarPlacement {
  const maxLeft = Math.max(EDGE_PADDING, container.width - toolbar.width - EDGE_PADDING);
  const left = Math.min(
    maxLeft,
    Math.max(EDGE_PADDING, anchor.left + anchor.width / 2 - toolbar.width / 2),
  );
  const above = anchor.top - TOOLBAR_GAP - toolbar.height;
  if (above >= EDGE_PADDING) return { left, top: above, side: "above" };
  const below = anchor.top + anchor.height + TOOLBAR_GAP;
  if (below + toolbar.height <= container.height - EDGE_PADDING)
    return { left, top: below, side: "below" };
  // Node fills the view (zoomed in): keep the toolbar inside the top edge.
  return { left, top: EDGE_PADDING, side: "inside" };
}

/** Screen rectangle of a flow node: flow coordinates × zoom + pan. */
export function nodeScreenRect(
  position: { x: number; y: number },
  size: Size,
  transform: readonly [number, number, number],
): Rect {
  const [tx, ty, zoom] = transform;
  return {
    left: position.x * zoom + tx,
    top: position.y * zoom + ty,
    width: size.width * zoom,
    height: size.height * zoom,
  };
}
