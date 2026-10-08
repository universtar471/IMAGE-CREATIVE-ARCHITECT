import { History, RotateCw } from "lucide-react";
import type { GenerationDTO } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { formatRelativeTime } from "../../lib/format";
import { GenerationStatusBadge } from "../generate/GenerationStatusBadge";
import { RunningStatus } from "../generate/GenerationResult";
import { OutputThumbs } from "../generate/OutputThumbs";
import { PURPOSE_LABELS, formatDuration } from "../generate/labels";

/** Generation history of the open project, newest first. */
export function HistoryTab() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const generations = useStudio((s) => s.workspace!.generations);
  const runningHere = useStudio(
    (s) => s.run?.status === "running" && s.run.projectId === s.workspace?.project.id,
  );
  const setModule = useStudio((s) => s.setModule);

  // The backend persists a `running` row; while our own call is in flight show it live instead.
  const rows = runningHere ? generations.filter((g) => g.status !== "running") : generations;

  if (!rows.length && !runningHere) {
    return (
      <EmptyState
        icon={<History size={24} />}
        title="No generations yet"
        action={
          <button className="btn btn-sm" onClick={() => setModule("generate")}>
            Open Generate
          </button>
        }
      >
        Every generation — completed or failed — is recorded here with its settings.
      </EmptyState>
    );
  }
  return (
    <ul className="history-list" aria-label="Generation history" data-project={projectId}>
      {runningHere && (
        <li className="history-row">
          <RunningStatus compact />
        </li>
      )}
      {rows.map((g) => (
        <HistoryRow key={g.id} g={g} />
      ))}
    </ul>
  );
}

function HistoryRow({ g }: { g: GenerationDTO }) {
  const providers = useStudio((s) => s.providers);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const selectAsset = useStudio((s) => s.selectAsset);
  const reuse = useStudio((s) => s.reuseGeneration);
  const readOnly = useStudio(selectReadOnly);
  const provider = providers?.find((p) => p.id === g.providerId);
  const model = provider?.models.find((m) => m.id === g.modelId);

  return (
    <li className="history-row" data-testid="history-row">
      <div className="history-main">
        <div className="history-head">
          <GenerationStatusBadge status={g.status} />
          <strong>{PURPOSE_LABELS[g.purpose]}</strong>
          <span title={`${g.providerId} / ${g.modelId}`}>
            {provider?.label ?? g.providerId} · {model?.label ?? g.modelId}
          </span>
          <span className="field-hint" title={new Date(g.startedAt).toLocaleString()}>
            {formatRelativeTime(g.startedAt)}
          </span>
          {g.durationMs !== null && (
            <span className="field-hint">{formatDuration(g.durationMs)}</span>
          )}
          <span className="field-hint">
            {g.referenceAssetIds.length} ref · {g.params.outputCount} out
            {g.params.aspectRatio ? ` · ${g.params.aspectRatio}` : ""}
            {g.params.imageSize ? ` · ${g.params.imageSize}` : ""}
          </span>
        </div>
        {g.error && (
          <div className="history-error">
            <span className="badge badge-danger">{g.error.kind}</span> {g.error.message}
          </div>
        )}
      </div>
      {g.outputAssetIds.length > 0 && (
        <OutputThumbs
          ids={g.outputAssetIds}
          selectedId={selectedId}
          onSelect={selectAsset}
          size="sm"
        />
      )}
      <button
        className="btn btn-sm"
        onClick={() => reuse(g)}
        disabled={readOnly || !model}
        title={
          model ? "Load these settings into Generate" : "This provider/model is no longer available"
        }
      >
        <RotateCw size={13} /> Reuse settings
      </button>
    </li>
  );
}
