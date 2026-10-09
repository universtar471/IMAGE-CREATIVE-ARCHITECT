import type { ReactNode } from "react";
import { AlertTriangle, Construction, Inbox } from "lucide-react";
import { useT } from "../../i18n";

export function LoadingState({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="state" role="status" aria-live="polite">
      <div className="spinner" />
      <p>{label ?? t("common.loading")}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state">
      <div className="state-icon">{icon ?? <Inbox size={28} />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  const t = useT();
  return (
    <div className="state state-error" role="alert">
      <div className="state-icon">
        <AlertTriangle size={28} />
      </div>
      <h3>{title ?? t("common.somethingWrong")}</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          {t("common.tryAgain")}
        </button>
      )}
    </div>
  );
}

/** Explicit "not implemented yet" state for reserved modules. Never fakes functionality. */
export function FutureModulePlaceholder({
  title,
  phase,
  description,
  compact = false,
}: {
  title: string;
  phase: number;
  description: string;
  compact?: boolean;
}) {
  const t = useT();
  return (
    <div className="state" data-testid="future-module">
      <div className="state-icon">
        <Construction size={compact ? 22 : 32} />
      </div>
      <h3>{t("states.futureTitle", { title, phase })}</h3>
      <p>{description}</p>
      {!compact && <p className="field-hint">{t("states.futureNote")}</p>}
    </div>
  );
}
