/**
 * "?" help (UX V6.1, ADR-044): long explanations move out of the always-visible panel text
 * into a popover opened by click, Enter or Space. Esc, a second click or a click outside
 * closes it and focus returns to the button. The popover lives in a portal and flips above or
 * clamps sideways so a container's `overflow: hidden` or the window edge never cuts it.
 */
import { HelpCircle } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";

const GAP = 6;
const EDGE = 8;

/** Where the popover goes: below the button when it fits, else above; clamped sideways. */
export function placePopover(
  button: { left: number; top: number; width: number; height: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number; side: "below" | "above" } {
  const left = Math.min(
    Math.max(EDGE, button.left + button.width / 2 - popover.width / 2),
    Math.max(EDGE, viewport.width - popover.width - EDGE),
  );
  const below = button.top + button.height + GAP;
  if (below + popover.height <= viewport.height - EDGE) return { left, top: below, side: "below" };
  const above = button.top - GAP - popover.height;
  return { left, top: Math.max(EDGE, above), side: "above" };
}

export function HelpPopover({ topic, children }: { topic: string; children: ReactNode }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !button.current || !pop.current) return;
    const b = button.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const place = placePopover(
      { left: b.left, top: b.top, width: b.width, height: b.height },
      { width: p.width, height: p.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setPos({ left: place.left, top: place.top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!pop.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const reposition = () => setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="help-button"
        aria-label={t("help.open", { topic })}
        title={t("help.open", { topic })}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-describedby={open ? id : undefined}
        onClick={(event) => {
          // Inside a section <summary> the click must not fold the section.
          event.preventDefault();
          setOpen((v) => !v);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        data-testid="help-button"
      >
        <HelpCircle size={14} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="note"
            className="help-popover"
            style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              }
            }}
            data-testid="help-popover"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
