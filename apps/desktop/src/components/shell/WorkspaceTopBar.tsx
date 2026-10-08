import { useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ListChecks,
  Loader2,
  PencilLine,
} from "lucide-react";
import { PROJECT_TYPE_LABELS } from "@arch/domain";
import { useShallow } from "zustand/react/shallow";
import { attempt, selectQueueCounts, useStudio, type SaveState } from "../../app/store";
import { call } from "../../lib/bridge";
import { ProviderChip } from "../../features/providers/ProviderChip";
import { ConfirmDialog } from "../common/Dialog";
import { StatusBadge } from "../common/StatusBadge";

export function WorkspaceTopBar() {
  const project = useStudio((s) => s.workspace!.project);
  const save = useStudio((s) => s.save);
  const goToHub = useStudio((s) => s.goToHub);
  const flushDna = useStudio((s) => s.flushDna);
  const adoptProject = useStudio((s) => s.adoptProject);
  const notify = useStudio((s) => s.notify);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archived = !!project.archivedAt;

  const setArchived = async (value: boolean) => {
    setConfirmArchive(false);
    if (value) await flushDna();
    const p = await attempt(() =>
      call("project_set_archived", { projectId: project.id, archived: value }),
    );
    if (p) {
      adoptProject(p);
      notify("success", value ? "Project archived. It is now read-only." : "Project restored.");
    }
  };

  return (
    <header className="topbar">
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => void goToHub()}
        title="Back to Project Hub"
      >
        <ArrowLeft size={15} /> Projects
      </button>
      <span className="topbar-sep" />
      <div className="topbar-title">
        <strong title={project.name}>{project.name}</strong>
        <span className="badge badge-neutral">
          {PROJECT_TYPE_LABELS[project.projectType]}
          {project.subtype ? ` · ${project.subtype.replace(/_/g, " ")}` : ""}
        </span>
        <StatusBadge status={project.status} />
      </div>
      <span className="spacer" />
      <QueueIndicator />
      <ProviderChip />
      <span className="topbar-sep" />
      <SaveIndicator save={save} onRetry={() => void flushDna()} />
      <span className="topbar-sep" />
      {archived ? (
        <button className="btn btn-sm" onClick={() => void setArchived(false)}>
          <ArchiveRestore size={14} /> Restore
        </button>
      ) : (
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmArchive(true)}>
          <Archive size={14} /> Archive
        </button>
      )}
      {confirmArchive && (
        <ConfirmDialog
          title="Archive project?"
          message="Archived projects become read-only and move to the Archived filter in the Project Hub. All data is kept and you can restore it at any time."
          confirmLabel="Archive"
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
  const busy = running + queued > 0;
  return (
    <button
      className={`btn btn-ghost btn-sm queue-indicator ${busy ? "is-busy" : ""}`}
      onClick={() => setTrayTab("jobs")}
      title="Job queue — open the Jobs tray"
      data-testid="queue-indicator"
    >
      {running > 0 ? <Loader2 size={14} className="spin" /> : <ListChecks size={14} />}
      {busy ? `${running} running · ${queued} queued` : "Queue idle"}
    </button>
  );
}

function SaveIndicator({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  switch (save.status) {
    case "saved":
      return (
        <span className="save-indicator" role="status">
          <Check size={14} /> Saved
        </span>
      );
    case "dirty":
      return (
        <span className="save-indicator" role="status">
          <PencilLine size={14} /> Unsaved changes
        </span>
      );
    case "saving":
      return (
        <span className="save-indicator" role="status">
          <Loader2 size={14} className="spin" /> Saving…
        </span>
      );
    case "invalid":
      return (
        <span className="save-indicator is-invalid" role="status" title={save.message}>
          <AlertCircle size={14} /> Fix {Object.keys(save.fieldErrors).length} field(s) to save
        </span>
      );
    case "error":
      return (
        <span className="save-indicator is-error" role="alert" title={save.message}>
          <AlertCircle size={14} /> Save failed
          <button className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </span>
      );
  }
}
