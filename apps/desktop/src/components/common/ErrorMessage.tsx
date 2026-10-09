import { errorHeadline, errorKindLabel } from "../../i18n/domain";
import { useT } from "../../i18n";

/**
 * A backend / provider error: a translated headline, then the original message (English
 * from the backend, often quoting the gateway) as detail. Pass `code` for an AppError or
 * `kind` for a generation/job error.
 */
export function ErrorMessage({
  code,
  kind,
  details,
  message,
  tone = "danger",
}: {
  code?: string;
  kind?: string | null;
  details?: unknown;
  message?: string | null;
  tone?: "danger" | "warning";
}) {
  const t = useT();
  const headline = code ? errorHeadline({ code, details }, t) : errorKindLabel(kind, t);
  return (
    <span className="error-message" data-testid="error-message">
      <span className={`badge badge-${tone}`} title={kind ?? code}>
        {headline}
      </span>
      {message && <span className="error-detail">{message}</span>}
    </span>
  );
}
