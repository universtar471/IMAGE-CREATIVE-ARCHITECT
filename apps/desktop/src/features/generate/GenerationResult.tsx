import { useEffect, useState } from "react";
import { Images, Loader2, RefreshCw, RotateCcw, Star } from "lucide-react";
import type { GenerationDTO } from "@arch/domain";
import { attempt, selectReadOnly, useStudio } from "../../app/store";
import { ConfirmDialog } from "../../components/common/Dialog";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { call } from "../../lib/bridge";
import { OutputThumbs } from "./OutputThumbs";
import { GenerationStatusBadge } from "./GenerationStatusBadge";
import { formatDuration } from "./labels";

/** Ticking "mm:ss" since `startedAt` (epoch ms). The clock lives in state, updated by a timer. */
export function useElapsed(startedAt: number): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  return formatDuration(Math.max(0, now - startedAt));
}

/** Spinner + elapsed time of the running generation (any project). */
export function RunningStatus({ compact = false }: { compact?: boolean }) {
  const run = useStudio((s) => s.run);
  if (run?.status !== "running") return null;
  return <RunningClock startedAt={run.startedAt} compact={compact} />;
}

function RunningClock({ startedAt, compact }: { startedAt: number; compact: boolean }) {
  const elapsed = useElapsed(startedAt);
  return (
    <span className="run-status" role="status" aria-live="polite">
      <Loader2 size={14} className="spin" />
      {compact ? `Generating ${elapsed}` : `Generating… ${elapsed}`}
      {!compact && <span className="field-hint">You can keep working; the result lands here.</span>}
    </span>
  );
}

/**
 * Latest result for the open project: the run that just finished here, otherwise the newest
 * history entry. Completed → outputs + actions; failed/interrupted → error + Retry.
 */
export function GenerationResult() {
  const run = useStudio((s) => s.run);
  const project = useStudio((s) => s.workspace!.project);
  const latest = useStudio((s) => s.workspace!.generations[0] ?? null);
  const fromRun = run?.projectId === project.id && run.status === "done" ? run.generation : null;
  const generation = fromRun ?? (run?.status === "running" ? null : latest);
  if (!generation || generation.status === "running") return null;
  return <ResultCard generation={generation} />;
}

function ResultCard({ generation: g }: { generation: GenerationDTO }) {
  const project = useStudio((s) => s.workspace!.project);
  const assets = useStudio((s) => s.workspace!.assets);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const running = useStudio((s) => s.run?.status === "running");
  const readOnly = useStudio(selectReadOnly);
  const selectAsset = useStudio((s) => s.selectAsset);
  const setModule = useStudio((s) => s.setModule);
  const adoptAssets = useStudio((s) => s.adoptAssets);
  const notify = useStudio((s) => s.notify);
  const submit = useStudio((s) => s.submitGeneration);
  const reuse = useStudio((s) => s.reuseGeneration);
  const [confirmMaster, setConfirmMaster] = useState(false);

  const outputs = g.outputAssetIds;
  const current = outputs.includes(selectedId ?? "") ? selectedId! : (outputs[0] ?? null);
  const currentAsset = assets.find((a) => a.id === current) ?? null;
  const isMaster = current !== null && project.activeMasterAssetId === current;
  const replacesMaster = !!project.activeMasterAssetId && !isMaster;

  const promoteToMaster = async () => {
    setConfirmMaster(false);
    if (!current) return;
    const list = await attempt(() =>
      call("asset_set_master", { projectId: project.id, assetId: current }),
    );
    if (list) {
      await adoptAssets(list);
      notify("success", "Generated image is now the master architecture image.");
    }
  };

  const input = {
    projectId: g.projectId,
    providerId: g.providerId,
    modelId: g.modelId,
    purpose: g.purpose,
    referenceAssetIds: g.referenceAssetIds,
    params: g.params,
  };
  // Retry resends the stored request snapshot unchanged.
  const retry = () => void submit(input, g.prompt);
  // Generate again: same settings, prompt recompiled from the current DNA.
  const again = () => {
    reuse(g);
    void submit(input);
  };

  return (
    <SectionPanel title="Last result" aside={<GenerationStatusBadge status={g.status} />}>
      {g.status === "completed" ? (
        <>
          {outputs.length ? (
            <OutputThumbs ids={outputs} selectedId={current} onSelect={selectAsset} />
          ) : (
            <span className="field-hint">The outputs of this generation were removed.</span>
          )}
          <span className="field-hint">
            {g.durationMs !== null ? `${formatDuration(g.durationMs)} · ` : ""}
            {currentAsset?.originalName ?? ""}
          </span>
          <div className="btn-row">
            <button
              className="btn btn-sm btn-primary"
              disabled={!current || isMaster || readOnly}
              onClick={() => (replacesMaster ? setConfirmMaster(true) : void promoteToMaster())}
            >
              <Star size={13} /> {isMaster ? "Master" : "Use as master"}
            </button>
            <button
              className="btn btn-sm"
              disabled={!current}
              onClick={() => {
                if (current) selectAsset(current);
                setModule("references");
              }}
            >
              <Images size={13} /> Show in References
            </button>
            <button
              className="btn btn-sm"
              disabled={running || readOnly}
              onClick={again}
              title="Run again with the same settings (prompt recompiled from the current DNA)"
            >
              <RefreshCw size={13} /> Generate again
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="callout callout-error" role="alert">
            <div>
              <span className="badge badge-danger">{g.error?.kind ?? g.status}</span>{" "}
              {g.error?.message ?? "The generation did not finish."}
            </div>
          </div>
          <div className="btn-row">
            <button
              className="btn btn-sm btn-primary"
              disabled={running || readOnly}
              onClick={retry}
            >
              <RotateCcw size={13} /> Retry
            </button>
            {g.error && !g.error.retryable && (
              <span className="field-hint">
                Retrying the same request will probably fail again.
              </span>
            )}
          </div>
        </>
      )}
      {confirmMaster && (
        <ConfirmDialog
          title="Replace the master image?"
          message="The current master becomes an architecture reference and project approval is reset. The generated image becomes the new master."
          confirmLabel="Use as master"
          onConfirm={() => void promoteToMaster()}
          onCancel={() => setConfirmMaster(false)}
        />
      )}
    </SectionPanel>
  );
}
