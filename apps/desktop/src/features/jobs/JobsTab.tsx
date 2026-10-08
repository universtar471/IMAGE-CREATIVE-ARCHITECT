import { useEffect, useState } from "react";
import { Ban, ListChecks, RotateCcw } from "lucide-react";
import type { JobDTO } from "@arch/domain";
import { isTerminalJob, useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { call } from "../../lib/bridge";
import { formatRelativeTime } from "../../lib/format";
import { retryCountdown, useNow } from "../generate/GenerationResult";
import { JOB_STATUS_LABELS, JOB_STATUS_TONE, formatDuration } from "../generate/labels";

export type JobsScope = "project" | "all";

/** Active jobs first (newest first), then finished ones (newest first). */
export function visibleJobs(
  jobs: readonly JobDTO[],
  scope: JobsScope,
  projectId: string | null,
): JobDTO[] {
  const inScope = jobs.filter((j) => scope === "all" || j.projectId === projectId);
  return [...inScope.filter((j) => !isTerminalJob(j)), ...inScope.filter((j) => isTerminalJob(j))];
}

/** Elapsed time of a job: running → since start; finished → start to finish. */
export function jobElapsedMs(job: JobDTO, now: number): number | null {
  if (!job.startedAt) return null;
  const end = job.finishedAt ? Date.parse(job.finishedAt) : now;
  return Math.max(0, end - Date.parse(job.startedAt));
}

/** The job queue of every project, filterable to the open one (ADR-017). */
export function JobsTab() {
  const jobs = useStudio((s) => s.jobs);
  const projectId = useStudio((s) => s.workspace?.project.id ?? null);
  const refreshJobs = useStudio((s) => s.refreshJobs);
  const [scope, setScope] = useState<JobsScope>("project");
  const names = useProjectNames(jobs);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  const rows = visibleJobs(jobs, scope, projectId);
  return (
    <div className="jobs-tab">
      <div className="jobs-toolbar">
        <div className="segmented" role="group" aria-label="Jobs scope">
          <button
            type="button"
            aria-pressed={scope === "project"}
            onClick={() => setScope("project")}
          >
            This project
          </button>
          <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
            All projects
          </button>
        </div>
        <span className="field-hint">
          Remote providers run one job at a time, local ones two. Retryable errors retry
          automatically.
        </span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={<ListChecks size={24} />} title="No jobs">
          {scope === "project"
            ? "Generations and batches of this project appear here while they run."
            : "No jobs in any project yet."}
        </EmptyState>
      ) : (
        <ul className="job-list" aria-label="Jobs">
          {rows.map((j) => (
            <JobRow key={j.id} job={j} projectName={names[j.projectId] ?? j.projectId} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Project names for the rows (loaded once per set of project IDs). */
function useProjectNames(jobs: readonly JobDTO[]): Record<string, string> {
  const ids = [...new Set(jobs.map((j) => j.projectId))].sort().join(",");
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    call("project_list", { includeArchived: true }).then(
      (list) => alive && setNames(Object.fromEntries(list.map((p) => [p.id, p.name]))),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [ids]);
  return names;
}

function JobRow({ job: j, projectName }: { job: JobDTO; projectName: string }) {
  const providers = useStudio((s) => s.providers);
  const cancelJob = useStudio((s) => s.cancelJob);
  const retryJob = useStudio((s) => s.retryJob);
  const now = useNow(1000);
  const provider = providers?.find((p) => p.id === j.providerId);
  const model = provider?.models.find((m) => m.id === j.modelId);
  const elapsed = jobElapsedMs(j, now);
  const countdown = retryCountdown(j, now);
  const terminal = isTerminalJob(j);
  const canRetry = j.status === "failed" || j.status === "cancelled" || j.status === "interrupted";

  return (
    <li className="job-row" data-testid="job-row" data-status={j.status}>
      <span className={`badge ${JOB_STATUS_TONE[j.status]}`}>{JOB_STATUS_LABELS[j.status]}</span>
      <div className="job-main">
        <div className="job-head">
          <strong title={j.label}>{j.label}</strong>
          <span className="field-hint">{projectName}</span>
          <span className="field-hint" title={`${j.providerId} / ${j.modelId}`}>
            {provider?.label ?? j.providerId} · {model?.label ?? j.modelId}
          </span>
        </div>
        <div className="job-meta">
          <span>
            attempt {j.attempt}/{j.maxAttempts}
          </span>
          {countdown && <span className="badge badge-warning">{countdown}</span>}
          {elapsed !== null && <span>{formatDuration(elapsed)}</span>}
          <span title={new Date(j.createdAt).toLocaleString()}>
            {formatRelativeTime(j.createdAt, now)}
          </span>
        </div>
        {j.error && (
          <div className="history-error">
            <span className={`badge ${terminal ? "badge-danger" : "badge-warning"}`}>
              {j.error.kind}
            </span>{" "}
            {j.error.message}
          </div>
        )}
      </div>
      <div className="btn-row">
        {!terminal && (
          <button className="btn btn-sm" onClick={() => void cancelJob(j.id)}>
            <Ban size={13} /> Cancel
          </button>
        )}
        {canRetry && (
          <button className="btn btn-sm" onClick={() => void retryJob(j.id)}>
            <RotateCcw size={13} /> Retry
          </button>
        )}
      </div>
    </li>
  );
}
