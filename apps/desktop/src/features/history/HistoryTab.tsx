import { Ban, Camera, History, RotateCcw, RotateCw } from "lucide-react";
import type { GenerationDTO } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { formatRelativeTime } from "../../lib/format";
import { GenerationStatusBadge } from "../generate/GenerationStatusBadge";
import { ActiveGenerationStatus } from "../generate/GenerationResult";
import { OutputThumbs } from "../generate/OutputThumbs";
import { PURPOSE_LABELS, formatDuration, isActiveGeneration } from "../generate/labels";

/** Generation history of the open project, newest first. */
export function HistoryTab() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const generations = useStudio((s) => s.workspace!.generations);
  const setModule = useStudio((s) => s.setModule);
  const rows = generations;

  if (!rows.length) {
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
  const retry = useStudio((s) => s.retryGeneration);
  const cancelJob = useStudio((s) => s.cancelJob);
  const camera = useStudio((s) =>
    g.cameraId ? s.workspace?.draftDna.cameras.find((c) => c.id === g.cameraId) : undefined,
  );
  const readOnly = useStudio(selectReadOnly);
  const active = isActiveGeneration(g.status);
  const canRetry = g.status === "cancelled" || (!active && !!g.error?.retryable);
  const provider = providers?.find((p) => p.id === g.providerId);
  const model = provider?.models.find((m) => m.id === g.modelId);

  return (
    <li className="history-row" data-testid="history-row">
      <div className="history-main">
        <div className="history-head">
          <GenerationStatusBadge status={g.status} />
          <strong>{PURPOSE_LABELS[g.purpose]}</strong>
          {g.cameraId && (
            <span className="badge badge-neutral" title="Camera">
              <Camera size={10} /> {camera?.name ?? "removed camera"}
            </span>
          )}
          <span title={`${g.providerId} / ${g.modelId}`}>
            {provider?.label ?? g.providerId} · {model?.label ?? g.modelId}
          </span>
          <span className="field-hint" title={new Date(g.createdAt).toLocaleString()}>
            {formatRelativeTime(g.createdAt)}
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
        {active && <ActiveGenerationStatus generation={g} compact />}
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
      {active && g.jobId && (
        <button className="btn btn-sm" disabled={readOnly} onClick={() => void cancelJob(g.jobId!)}>
          <Ban size={13} /> Cancel
        </button>
      )}
      {canRetry && (
        <button className="btn btn-sm" disabled={readOnly} onClick={() => void retry(g)}>
          <RotateCcw size={13} /> Retry
        </button>
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
