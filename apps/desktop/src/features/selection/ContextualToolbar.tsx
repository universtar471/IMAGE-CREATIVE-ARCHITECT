/**
 * Contextual toolbar (UX V6.1, ADR-044): the actions the registry offers for the current
 * selection, the first few as buttons and the rest in a `…` menu. Disabled actions stay
 * visible with their reason as tooltip. The caller positions it (floating over the node
 * canvas, or pinned above the Studio preview).
 */
import { MoreHorizontal } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useT } from "../../i18n";
import { splitActions, type ResolvedAction } from "./actions";
import type { Selection } from "./selection";
import { useSelectionActions } from "./useSelectionActions";

/** Viewing actions that stay visible regardless of the button budget. */
const PINNED = new Set(["expand", "play"]);

type Props = {
  selection: Selection;
  /** Buttons before the `…` menu (pinned view actions not counted). */
  maxVisible?: number;
  /** Open the menu upwards (toolbar placed below its anchor near the bottom). */
  menuUp?: boolean;
  style?: CSSProperties;
  className?: string;
};

export const ContextualToolbar = forwardRef<HTMLDivElement, Props>(function ContextualToolbar(
  { selection, maxVisible = 4, menuUp = false, style, className = "" },
  ref,
) {
  const t = useT();
  const { actions, env, dialogs } = useSelectionActions(selection);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pinned = actions.filter((a) => PINNED.has(a.action.id));
  const rest = actions.filter((a) => !PINNED.has(a.action.id));
  const { shown, more } = splitActions(rest, maxVisible);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !moreRef.current?.contains(event.target as Node)
      )
        setMenuOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menuOpen]);

  // A new selection closes a menu that listed the old one's actions.
  const key = actions.map((a) => a.action.id).join(",");
  useEffect(() => setMenuOpen(false), [key]);

  if (actions.length === 0) return <>{dialogs}</>;

  const label = (a: ResolvedAction) => t(a.action.labelFor?.(selection) ?? a.action.labelKey);
  const run = (a: ResolvedAction) => {
    setMenuOpen(false);
    if (!a.disabledReason) void a.action.run(selection, env);
  };

  return (
    <>
      <div
        ref={ref}
        className={`context-toolbar ${className}`.trim()}
        role="toolbar"
        aria-label={t("selectionActions.toolbar")}
        data-testid="context-toolbar"
        data-selection={selection.kind}
        style={style}
        // Clicks on the toolbar never reach the canvas below (no deselect, no drag).
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {[...shown, ...pinned].map((a, i) => {
          const Icon = a.action.icon;
          const text = label(a);
          const withLabel = i === 0;
          return (
            <button
              key={a.action.id}
              type="button"
              className={`btn btn-sm context-toolbar-btn ${withLabel ? "" : "btn-icon"}`}
              data-action={a.action.id}
              aria-label={withLabel ? undefined : text}
              title={a.disabledReason ? t(a.disabledReason) : text}
              aria-disabled={a.disabledReason ? true : undefined}
              disabled={!!a.disabledReason}
              onClick={() => run(a)}
            >
              <Icon size={15} aria-hidden="true" />
              {withLabel && <span>{text}</span>}
            </button>
          );
        })}
        {more.length > 0 && (
          <span className="context-toolbar-more">
            <button
              ref={moreRef}
              type="button"
              className="btn btn-sm btn-icon"
              aria-label={t("selectionActions.more")}
              title={t("selectionActions.more")}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              onClick={() => setMenuOpen((open) => !open)}
              data-testid="context-toolbar-more"
            >
              <MoreHorizontal size={15} />
            </button>
            {menuOpen && (
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                className={`context-menu ${menuUp ? "is-up" : ""}`}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setMenuOpen(false);
                    moreRef.current?.focus();
                  }
                }}
              >
                {more.map((a) => {
                  const Icon = a.action.icon;
                  return (
                    <button
                      key={a.action.id}
                      type="button"
                      role="menuitem"
                      className="context-menu-item"
                      data-action={a.action.id}
                      disabled={!!a.disabledReason}
                      title={a.disabledReason ? t(a.disabledReason) : undefined}
                      onClick={() => run(a)}
                    >
                      <Icon size={14} aria-hidden="true" /> {label(a)}
                    </button>
                  );
                })}
              </div>
            )}
          </span>
        )}
      </div>
      {dialogs}
    </>
  );
});
