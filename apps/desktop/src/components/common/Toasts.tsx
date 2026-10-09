import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  const dismiss = useStudio((s) => s.dismissToast);
  const t = useT();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind];
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <Icon size={16} />
            <p>
              {toast.title && <strong className="toast-title">{toast.title}</strong>}
              {toast.message}
            </p>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              onClick={() => dismiss(toast.id)}
              aria-label={t("common.dismiss")}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
