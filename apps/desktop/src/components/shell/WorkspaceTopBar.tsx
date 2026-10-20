import { useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ListChecks,
  Loader2,
  PanelRight,
  PencilLine,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { attempt, selectQueueCounts, useStudio, type SaveState } from "../../app/store";
import { call } from "../../lib/bridge";
import { ProviderChip } from "../../features/providers/ProviderChip";
import { useT } from "../../i18n";
import { subtypeLabel } from "../../i18n/knowledge";
import { ConfirmDialog } from "../common/Dialog";
import { StatusBadge } from "../common/StatusBadge";
import { LocaleSwitch } from "./LocaleSwitch";
import { ModeSwitch } from "./ModeSwitch";
import { useWorkspaceLayout } from "../../features/workspace/layout";

export function WorkspaceTopBar() {
  const project = useStudio((s) => s.workspace!.project);
  const save = useStudio((s) => s.save);
  const goToHub = useStudio((s) => s.goToHub);
  const flushDna = useStudio((s) => s.flushDna);
  const adoptProject = useStudio((s) => s.adoptProject);
  const notify = useStudio((s) => s.notify);
  const setModule = useStudio((s) => s.setModule);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const layout = useWorkspaceLayout();
  const inspectorOpen = useStudio((s) => s.inspectorOpen);
  const setInspectorOpen = useStudio((s) => s.setInspectorOpen);
  const t = useT();
  const archived = !!project.archivedAt;

  const setArchived = async (value: boolean) => {
    setConfirmArchive(false);
    if (value) await flushDna();
    const p = await attempt(() =>
      call("project_set_archived", { projectId: project.id, archived: value }),
    );
    if (p) {
      adoptProject(p);
      notify("success", value ? t("topbar.archived") : t("topbar.restored"));
    }
  };

  return (
    <header className="topbar">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => void goToHub()}
        title={t("topbar.backToHub")}
      >
        <ArrowLeft size={15} /> <span className="topbar-label">{t("topbar.projects")}</span>
      </button>
      <span className="topbar-sep" />
      <div className="topbar-title">
        <strong title={project.name}>{project.name}</strong>
        <span className="badge badge-neutral topbar-type">
          {t(`labels.projectType.${project.projectType}`)}
          {project.subtype ? ` · ${subtypeLabel(project.projectType, project.subtype)}` : ""}
        </span>
        {project.status === "master_pending" ? (
          // The approve button lives in Overview; the pending badge is the shortcut to it.
          <button
            type="button"
            className="badge-button"
            title={t("workflow.goApproveMaster")}
            onClick={() => setModule("overview")}
          >
            <StatusBadge status={project.status} />
          </button>
        ) : (
          <StatusBadge status={project.status} />
        )}
      </div>
      <span className="topbar-sep" />
      <ModeSwitch />
      <span className="spacer" />
      <QueueIndicator />
      <ProviderChip />
      <span className="topbar-sep" />
      <SaveIndicator save={save} onRetry={() => void flushDna()} />
      <span className="topbar-sep" />
      <LocaleSwitch />
      <span className="topbar-sep" />
      {archived ? (
        <button
          className="btn btn-sm"
          onClick={() => void setArchived(false)}
          title={t("common.restore")}
        >
          <ArchiveRestore size={14} /> <span className="topbar-label">{t("common.restore")}</span>
        </button>
      ) : (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setConfirmArchive(true)}
          title={t("common.archive")}
        >
          <Archive size={14} /> <span className="topbar-label">{t("common.archive")}</span>
        </button>
      )}
      {layout.drawer && (
        <button
          className="btn btn-sm topbar-inspector"
          aria-pressed={inspectorOpen}
          aria-label={t("workspace.toggleInspector")}
          title={t("workspace.toggleInspector")}
          onClick={() => setInspectorOpen(!inspectorOpen)}
          data-testid="toggle-inspector"
        >
          <PanelRight size={15} />
        </button>
      )}
      {confirmArchive && (
        <ConfirmDialog
          title={t("topbar.archiveTitle")}
          message={t("topbar.archiveMessage")}
          confirmLabel={t("common.archive")}
          onConfirm={() => void setArchived(true)}
          onCancel={() => setConfirmArchive(false)}
        />
      )}
    </header>
  );
}

/** Running and waiting jobs of every project; opens the Jobs tray. */
function QueueIndicator() {
  const { running, queued } = useStudio(useShallow(selectQueueCounts));
  const setTrayTab = useStudio((s) => s.setTrayTab);
  const t = useT();
  const busy = running + queued > 0;
  return (
    <button
      className={`btn btn-ghost btn-sm queue-indicator ${busy ? "is-busy" : ""}`}
      onClick={() => setTrayTab("jobs")}
      title={t("topbar.queueTitle")}
      data-testid="queue-indicator"
    >
      {running > 0 ? <Loader2 size={14} className="spin" /> : <ListChecks size={14} />}
      <span className="topbar-label">
        {busy ? t("topbar.queueBusy", { running, queued }) : t("topbar.queueIdle")}
      </span>
    </button>
  );
}

function SaveIndicator({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  const t = useT();
  switch (save.status) {
    case "saved":
      return (
        <span className="save-indicator" role="status">
          <Check size={14} /> {t("topbar.saved")}
        </span>
      );
    case "dirty":
      return (
        <span className="save-indicator" role="status">
          <PencilLine size={14} /> {t("topbar.dirty")}
        </span>
      );
    case "saving":
      return (
        <span className="save-indicator" role="status">
          <Loader2 size={14} className="spin" /> {t("topbar.saving")}
        </span>
      );
    case "invalid":
      return (
        <span className="save-indicator is-invalid" role="status" title={save.message}>
          <AlertCircle size={14} />{" "}
          {t("topbar.invalid", { count: Object.keys(save.fieldErrors).length })}
        </span>
      );
    case "error":
      return (
        <span className="save-indicator is-error" role="alert" title={save.message}>
          <AlertCircle size={14} /> {t("topbar.saveFailed")}
          <button className="btn btn-sm" onClick={onRetry}>
            {t("common.retry")}
          </button>
        </span>
      );
  }
}
