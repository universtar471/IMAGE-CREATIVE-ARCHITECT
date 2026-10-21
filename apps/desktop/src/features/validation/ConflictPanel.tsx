import { AlertTriangle, Check, Wrench } from "lucide-react";
import type { ConflictCode, ConflictIssue, ShotValidation } from "@arch/domain";
import { useStudio } from "../../app/store";
import { useT, type TKey } from "../../i18n";
import { pendingWarnings } from "./gate";

export type ConflictEntry = { label?: string | null; validation: ShotValidation };

/** Creative findings remain visible as optional guidance. They never disable submission
 * or skip batch items. Acknowledgements and suggested fixes are optional. */
export function ConflictPanel({
  entries,
  onApprove,
  onFix,
}: {
  entries: readonly ConflictEntry[];
  onApprove?: (codes: ConflictCode[]) => void;
  onFix?: (issue: ConflictIssue) => void;
  batch?: boolean;
}) {
  const t = useT();
  const rows = entries.flatMap((e) =>
    e.validation.issues.map((issue) => ({ label: e.label ?? null, issue })),
  );
  if (!rows.length) return null;
  const pending = [...new Set(entries.flatMap((e) => pendingWarnings(e.validation)))];
  const open = rows.find((r) => !r.issue.accepted)?.issue ?? null;
  const tone = rows.some((r) => !r.issue.accepted) ? "callout-warning" : "callout-success";
  const source = (issue: ConflictIssue) =>
    issue.path === "extraPrompt"
      ? t("conflictUi.fromExtraPrompt")
      : issue.path.startsWith("cameras")
        ? t("conflictUi.fromCamera")
        : issue.path.startsWith("spaceCatalog")
          ? t("conflictUi.fromSpace")
          : issue.path.startsWith("shotIntent.effects")
            ? t("modules.effects.label")
            : issue.path.startsWith("sceneObjects")
              ? t("modules.scene_objects.label")
              : issue.path.startsWith("lighting") || issue.path.startsWith("weather")
                ? t("modules.lighting.label")
                : t("modules.context.label");

  return (
    <div className={`callout conflict-panel ${tone}`} role="status" data-testid="conflict-panel">
      <AlertTriangle size={14} />
      <div className="conflict-panel-body">
        <strong>{t("conflictUi.title")}</strong>
        <ul className="conflict-list">
          {rows.map(({ label, issue }, index) => (
            <li key={`${label ?? ""}:${issue.code}:${issue.path}:${index}`}>
              <span className={`badge ${issue.accepted ? "badge-success" : "badge-warning"}`}>
                {issue.accepted ? t("conflictUi.accepted") : t("conflictUi.warn")}
              </span>{" "}
              {label && <strong>{label}: </strong>}
              {t(issue.messageKey as TKey)} <span className="field-hint">({source(issue)})</span>
            </li>
          ))}
        </ul>
        <span className="field-hint">{t("conflictUi.advisoryHint")}</span>
        {(open || pending.length > 0) && (
          <div className="btn-row">
            {onFix && open && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onFix(open)}
                data-testid="conflict-fix"
              >
                <Wrench size={13} /> {t("conflictUi.fix")}
              </button>
            )}
            {onApprove && pending.length > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onApprove(pending)}
                data-testid="conflict-approve"
              >
                <Check size={13} /> {t("conflictUi.approveException")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Sửa lựa chọn": take the user to what raised the issue. Text issues focus the field with
 * id `textFieldId` (when given); camera issues open the Camera module, the rest Context.
 */
export function useConflictFix(textFieldId?: string, before?: () => void) {
  const setModule = useStudio((s) => s.setModule);
  return (issue: ConflictIssue) => {
    if (issue.path === "extraPrompt" && textFieldId) {
      document.getElementById(textFieldId)?.focus();
      return;
    }
    before?.();
    setModule(
      issue.path.startsWith("cameras")
        ? "camera"
        : issue.path.startsWith("spaceCatalog")
          ? "design_dna"
          : "context",
    );
  };
}
