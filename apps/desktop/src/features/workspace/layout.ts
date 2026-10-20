/**
 * Responsive workspace layout (UX V6.1-R1, ADR-044). Pure functions of the workspace's own
 * measured size in CSS px — never `window.innerWidth` — so maximize/restore, panel drags and
 * Windows display scale (which shrinks the CSS viewport: 1920 px at 150% is 1280 CSS px) all
 * resolve the same way. The tiers are layout targets; CSS reads them from `data-tier`.
 */
import { createContext, useContext } from "react";

export type LayoutTier = "wide" | "regular" | "compact" | "narrow" | "tight";

export type WorkspaceLayout = {
  tier: LayoutTier;
  /** Height below 760 CSS px: one-row tray, scrolling inspector, sticky CTA. */
  short: boolean;
  width: number;
  height: number;
  /** Navigation shows icons only (labels in tooltips and accessible names). */
  iconNav: boolean;
  /** The inspector is a drawer over the canvas instead of a permanent column. */
  drawer: boolean;
};

export const SHORT_HEIGHT = 760;
/** The canvas keeps at least this width next to a docked inspector. */
export const MIN_CANVAS_WIDTH = 480;
export const MIN_PANEL_WIDTH = 300;
export const MAX_PANEL_WIDTH = 720;

export function layoutTier(width: number): LayoutTier {
  if (width >= 1600) return "wide";
  if (width >= 1280) return "regular";
  if (width >= 1000) return "compact";
  if (width >= 800) return "narrow";
  return "tight";
}

/** Navigation width per tier; must match `.workspace[data-tier]` in app.css. */
export const NAV_WIDTH: Record<LayoutTier, number> = {
  wide: 196,
  regular: 176,
  compact: 64,
  narrow: 56,
  tight: 52,
};

/** Largest docked inspector per tier (the user's own width is kept and restored later). */
const PANEL_CAP: Record<LayoutTier, number> = {
  wide: MAX_PANEL_WIDTH,
  regular: 480,
  compact: 360,
  narrow: 380,
  tight: 360,
};

export function workspaceLayout(width: number, height: number): WorkspaceLayout {
  // Before the first measurement (0×0, tests without layout) assume a regular window.
  const tier = width > 0 ? layoutTier(width) : "regular";
  return {
    tier,
    short: height > 0 && height < SHORT_HEIGHT,
    width,
    height,
    iconNav: tier === "compact" || tier === "narrow" || tier === "tight",
    drawer: tier === "narrow" || tier === "tight",
  };
}

/**
 * Width the inspector actually gets: the user's stored width, capped by the tier and by the
 * room left for the canvas. A drawer is capped by the window instead.
 */
export function effectivePanelWidth(stored: number, layout: WorkspaceLayout): number {
  const cap = PANEL_CAP[layout.tier];
  if (layout.drawer) {
    const room = layout.width > 0 ? layout.width - NAV_WIDTH[layout.tier] - 16 : cap;
    return Math.max(260, Math.min(stored, cap, room));
  }
  const room =
    layout.width > 0 ? layout.width - NAV_WIDTH[layout.tier] - MIN_CANVAS_WIDTH : MAX_PANEL_WIDTH;
  return Math.max(MIN_PANEL_WIDTH, Math.min(stored, cap, room));
}

export const WorkspaceLayoutContext = createContext<WorkspaceLayout>(workspaceLayout(0, 0));
export const useWorkspaceLayout = () => useContext(WorkspaceLayoutContext);
