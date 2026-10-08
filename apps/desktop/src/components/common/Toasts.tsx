import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useStudio } from "../../app/store";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  const dismiss = useStudio((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`toast toast-${t.kind}`}
            role={t.kind === "error" ? "alert" : "status"}
          >
            <Icon size={16} />
            <p>{t.message}</p>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
