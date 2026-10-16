import { useState } from "react";
import type { ConflictCode } from "@arch/domain";
import { useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { useT } from "../../i18n";
import { ConflictPanel, useConflictFix } from "./ConflictPanel";

/**
 * Retries the conflict gate refused (ADR-034): every retry path (jobs tray, failed batch
 * items, enhance "retry failed", history) re-validates the stored snapshot against the
 * current DNA. BLOCK items need "Sửa lựa chọn"; "Duyệt ngoại lệ" resends the WARN items with
 * the newly accepted codes. Renders nothing while no retry is waiting.
 */
export function RetryConflictDialog() {
  const t = useT();
  const conflicts = useStudio((s) => s.retryConflicts);
  const retryJob = useStudio((s) => s.retryJob);
  const dismiss = useStudio((s) => s.dismissRetryConflicts);
  const hasWorkspace = useStudio((s) => s.workspace !== null);
  const fix = useConflictFix(undefined, dismiss);
  const [busy, setBusy] = useState(false);
  if (!conflicts.length) return null;

  const approve = async (codes: ConflictCode[]) => {
    setBusy(true);
    try {
      for (const conflict of conflicts)
        if (conflict.validation.verdict === "WARN")
          await retryJob(conflict.jobId, { approvedExceptions: codes });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t("conflictUi.retryTitle")}
      onClose={dismiss}
      footer={
        <button className="btn" onClick={dismiss}>
          {t("common.close")}
        </button>
      }
    >
      <div data-testid="retry-conflict-dialog">
        <p className="field-hint" style={{ marginTop: 0 }}>
          {t("conflictUi.retryIntro")}
        </p>
        <ConflictPanel
          batch={conflicts.length > 1}
          entries={conflicts.map((c) => ({ label: c.label, validation: c.validation }))}
          onApprove={busy ? undefined : (codes) => void approve(codes)}
          onFix={hasWorkspace ? fix : undefined}
        />
      </div>
    </Dialog>
  );
}
