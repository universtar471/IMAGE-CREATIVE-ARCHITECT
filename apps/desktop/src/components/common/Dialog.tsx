import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "../../i18n";

export function Dialog({
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md";
}) {
  // Escape and Tab belong to the topmost open dialog only: the last backdrop in document
  // order (a confirm nested inside a settings dialog renders after it).
  const t = useT();
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const open = document.querySelectorAll(".dialog-backdrop");
      if (open[open.length - 1] !== backdrop.current) return;
      if (e.key === "Escape") onClose();
      else if (e.key === "Tab" && panel.current) trapTab(e, panel.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Move focus into the dialog (unless an autoFocus element already took it) and give it back
  // to whatever had it when the dialog closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) {
      const body = el.querySelector<HTMLElement>(".dialog-body");
      (focusables(el, body)[0] ?? focusables(el)[0] ?? el).focus();
    }
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return (
    <div
      ref={backdrop}
      className="dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className={`dialog ${size === "sm" ? "dialog-sm" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dialog-header">
          <h2>{title}</h2>
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Focusable elements of dialog `root` (within `scope`), excluding nested dialogs. */
function focusables(root: HTMLElement, scope: HTMLElement | null = root): HTMLElement[] {
  if (!scope) return [];
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.closest("[role=dialog]") === root,
  );
}

/** Keep Tab / Shift+Tab cycling inside `root`. */
function trapTab(e: KeyboardEvent, root: HTMLElement) {
  const items = focusables(root);
  if (!items.length) {
    e.preventDefault();
    root.focus();
    return;
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** Safe confirmation for destructive / state-changing actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onCancel} autoFocus>
            {t("common.cancel")}
          </button>
          <button className={`btn ${danger ? "btn-danger" : "btn-primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div>{message}</div>
    </Dialog>
  );
}
