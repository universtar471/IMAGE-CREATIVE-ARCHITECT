import { useEffect, useState } from "react";
import { Ban, Images, Loader2, RefreshCw, RotateCcw, ShieldCheck, Star } from "lucide-react";
import type { GenerationDTO, JobDTO } from "@arch/domain";
import { attempt, selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { call } from "../../lib/bridge";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { t as tr, useT } from "../../i18n";
import { OutputThumbs } from "./OutputThumbs";
import { GenerationStatusBadge } from "./GenerationStatusBadge";
import { formatDuration, isActiveGeneration } from "./labels";
import { isMasterApproved } from "../camera/labels";

/** Current time, re-rendered every `intervalMs`. The clock lives in state, updated by a timer. */
export function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Ticking "mm:ss" since `startedAt` (epoch ms). */
export function useElapsed(startedAt: number): string {
  const now = useNow();
  return formatDuration(Math.max(0, now - startedAt));
}

/** "Retry in 0:12" for a retrying job, else null. */
export function retryCountdown(job: Pick<JobDTO, "status" | "nextAttemptAt">, now: number) {
  if (job.status !== "retrying" || !job.nextAttemptAt) return null;
  const ms = Date.parse(job.nextAttemptAt) - now;
  return ms > 0
    ? tr("result.retryIn", { time: formatDuration(ms + 999) })
    : tr("result.retryingNow");
}

/** Live line for a queued/running generation: status, attempt, retry countdown, elapsed. */
export function ActiveGenerationStatus({
  generation: g,
  compact = false,
}: {
  generation: GenerationDTO;
  compact?: boolean;
}) {
  const job = useStudio((s) => s.jobs.find((j) => j.generationId === g.id) ?? null);
  const now = useNow();
  const t = useT();
  const since = Date.parse(g.startedAt ?? g.createdAt);
  const elapsed = formatDuration(Math.max(0, now - since));
  const status = job?.status ?? g.status;
  const label =
    status === "running"
      ? t("result.generating", { elapsed })
      : status === "retrying"
        ? t("result.waitingRetry", { countdown: retryCountdown(job!, now) ?? "" })
        : t("result.queued", { elapsed });
  return (
    <span className="run-status" role="status" aria-live="polite">
      <Loader2 size={14} className={status === "running" ? "spin" : ""} />
      {label}
      {job && job.attempt > 0 && (
        <span className="field-hint">
          {t("result.attempt", { attempt: job.attempt, max: job.maxAttempts })}
        </span>
      )}
      {!compact && <span className="field-hint">{t("result.keepWorking")}</span>}
    </span>
  );
}

/**
 * Latest result for the open project: the generation this panel submitted (kept current by
 * events), otherwise the newest history entry. Queued/running → live status + Cancel;
 * completed → outputs + actions; failed/cancelled/interrupted → error + Retry.
 */
export function GenerationResult() {
  const run = useStudio((s) => s.run);
  const project = useStudio((s) => s.workspace!.project);
  const generations = useStudio((s) => s.workspace!.generations);
  const tracked =
    run?.status === "tracking" && run.projectId === project.id ? run.generation : null;
  // History is the fresher copy (events, reloads); the run snapshot is the fallback.
  const generation =
    (tracked && (generations.find((g) => g.id === tracked.id) ?? tracked)) ??
    generations.find((g) => g.purpose === "hero" || g.purpose === "variation") ??
    null;
  if (!generation) return null;
  if (isActiveGeneration(generation.status)) return <ActiveCard generation={generation} />;
  return <ResultCard key={generation.id} generation={generation} />;
}

function ActiveCard({ generation: g }: { generation: GenerationDTO }) {
  const cancelJob = useStudio((s) => s.cancelJob);
  // While a job waits to retry, the job (not the generation) carries the last error.
  const jobError = useStudio((s) => s.jobs.find((j) => j.generationId === g.id)?.error ?? null);
  const lastError = jobError ?? g.error;
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  return (
    <SectionPanel title={t("result.current")} aside={<GenerationStatusBadge status={g.status} />}>
      <ActiveGenerationStatus generation={g} />
      {lastError && (
        <span className="field-hint">
          {t("result.lastAttempt")}{" "}
          <ErrorMessage kind={lastError.kind} message={lastError.message} tone="warning" />
        </span>
      )}
      {g.jobId && (
        <div className="btn-row">
          <button
            className="btn btn-sm"
            disabled={readOnly}
            onClick={() => void cancelJob(g.jobId!)}
          >
            <Ban size={13} /> {t("common.cancel")}
          </button>
        </div>
      )}
    </SectionPanel>
  );
}

function ResultCard({ generation: g }: { generation: GenerationDTO }) {
  const project = useStudio((s) => s.workspace!.project);
  const assets = useStudio((s) => s.workspace!.assets);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const submitting = useStudio((s) => s.run?.status === "submitting");
  const readOnly = useStudio(selectReadOnly);
  const selectAsset = useStudio((s) => s.selectAsset);
  const setModule = useStudio((s) => s.setModule);
  const adoptAssets = useStudio((s) => s.adoptAssets);
  const adoptProject = useStudio((s) => s.adoptProject);
  const refreshWorkflow = useStudio((s) => s.refreshWorkflow);
  const notify = useStudio((s) => s.notify);
  const submit = useStudio((s) => s.submitGeneration);
  const retry = useStudio((s) => s.retryGeneration);
  const reuse = useStudio((s) => s.reuseGeneration);
  const [confirmMaster, setConfirmMaster] = useState(false);
  const t = useT();

  // Only outputs that still exist (an output may have been removed in References).
  const outputs = g.outputAssetIds.filter((id) => assets.some((a) => a.id === id));
  const current = outputs.includes(selectedId ?? "") ? selectedId! : (outputs[0] ?? null);
  const currentAsset = assets.find((a) => a.id === current) ?? null;
  const isMaster = current !== null && project.activeMasterAssetId === current;
  const replacesMaster = !!project.activeMasterAssetId && !isMaster;
  const awaitingApproval = isMaster && !isMasterApproved(project.status);

  const approveMaster = async (): Promise<boolean> => {
    const p = await attempt(() =>
      call("project_approve_master", { projectId: project.id, approved: true }),
    );
    if (!p) return false;
    adoptProject(p);
    void refreshWorkflow();
    return true;
  };

  // "Use as master" sets the master and approves it in one step: the user already picked this
  // image deliberately, and a separate approval in Overview was easy to miss.
  const promoteToMaster = async () => {
    setConfirmMaster(false);
    if (!current) return;
    const projectId = project.id;
    const list = await attempt(() => call("asset_set_master", { projectId, assetId: current }));
    if (!list) return;
    await adoptAssets(projectId, list);
    notify(
      "success",
      (await approveMaster()) ? t("result.nowMasterApproved") : t("result.nowMaster"),
    );
  };

  // Generate again: same settings, prompt recompiled from the current DNA.
  const again = () => {
    reuse(g);
    void submit({
      projectId: g.projectId,
      providerId: g.providerId,
      modelId: g.modelId,
      purpose: g.purpose,
      referenceAssetIds: g.referenceAssetIds,
      params: g.params,
      cameraId: g.cameraId,
    });
  };
  // A cancelled job can always run again; errors say whether a retry can help.
  const canRetry = g.status === "cancelled" || !!g.error?.retryable;

  return (
    <SectionPanel title={t("result.last")} aside={<GenerationStatusBadge status={g.status} />}>
      {g.status === "completed" ? (
        <>
          {outputs.length ? (
            <OutputThumbs ids={outputs} selectedId={current} onSelect={selectAsset} />
          ) : (
            <span className="field-hint">{t("result.outputsRemoved")}</span>
          )}
          <span className="field-hint">
            {g.durationMs !== null ? `${formatDuration(g.durationMs)} · ` : ""}
            {currentAsset?.originalName ?? ""}
          </span>
          <div className="btn-row">
            {awaitingApproval ? (
              <button
                className="btn btn-sm btn-primary"
                disabled={readOnly}
                onClick={() =>
                  void approveMaster().then(
                    (ok) => ok && notify("success", t("result.masterApproved")),
                  )
                }
              >
                <ShieldCheck size={13} /> {t("overview.approve")}
              </button>
            ) : (
              <button
                className="btn btn-sm btn-primary"
                disabled={!currentAsset || isMaster || readOnly}
                onClick={() => (replacesMaster ? setConfirmMaster(true) : void promoteToMaster())}
              >
                <Star size={13} /> {isMaster ? t("common.master") : t("result.useAsMaster")}
              </button>
            )}
            <button
              className="btn btn-sm"
              disabled={!currentAsset}
              onClick={() => {
                if (current) selectAsset(current);
                setModule("references");
              }}
            >
              <Images size={13} /> {t("result.showInReferences")}
            </button>
            <button
              className="btn btn-sm"
              disabled={submitting || readOnly}
              onClick={again}
              title={t("result.againTitle")}
            >
              <RefreshCw size={13} /> {t("result.again")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            className={`callout ${g.status === "cancelled" ? "callout-warning" : "callout-error"}`}
            role="alert"
          >
            <ErrorMessage
              kind={g.error?.kind ?? (g.status === "cancelled" ? "cancelled" : null)}
              tone={g.status === "cancelled" ? "warning" : "danger"}
              message={
                g.status === "cancelled"
                  ? t("result.cancelled")
                  : (g.error?.message ?? t("result.didNotFinish"))
              }
            />
          </div>
          {canRetry ? (
            <div className="btn-row">
              <button
                className="btn btn-sm btn-primary"
                disabled={submitting || readOnly}
                onClick={() => void retry(g)}
              >
                <RotateCcw size={13} /> {t("common.retry")}
              </button>
            </div>
          ) : (
            <span className="field-hint">{t("result.notRetryable")}</span>
          )}
        </>
      )}
      {confirmMaster && (
        <ConfirmDialog
          title={t("result.replaceTitle")}
          message={t("result.replaceMessage")}
          confirmLabel={t("result.useAsMaster")}
          onConfirm={() => void promoteToMaster()}
          onCancel={() => setConfirmMaster(false)}
        />
      )}
    </SectionPanel>
  );
}
