import { Ban, Camera, History, RotateCcw, RotateCw } from "lucide-react";
import type { GenerationDTO } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { EmptyState } from "../../components/common/states";
import { formatDateTime, formatRelativeTime } from "../../lib/format";
import { ErrorMessage } from "../../components/common/ErrorMessage";
import { useT } from "../../i18n";
import { GenerationStatusBadge } from "../generate/GenerationStatusBadge";
import { ActiveGenerationStatus } from "../generate/GenerationResult";
import { OutputThumbs } from "../generate/OutputThumbs";
import { formatDuration, isActiveGeneration } from "../generate/labels";

/** Generation history of the open project, newest first. */
export function HistoryTab() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const generations = useStudio((s) => s.workspace!.generations);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const rows = generations;

  if (!rows.length) {
    return (
      <EmptyState
        icon={<History size={24} />}
        title={t("history.empty")}
        action={
          <button className="btn btn-sm" onClick={() => setModule("generate")}>
            {t("history.openGenerate")}
          </button>
        }
      >
        {t("history.emptyHint")}
      </EmptyState>
    );
  }
  return (
    <ul className="history-list" aria-label={t("history.label")} data-project={projectId}>
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
  const t = useT();
  const active = isActiveGeneration(g.status);
  const canRetry = g.status === "cancelled" || (!active && !!g.error?.retryable);
  const provider = providers?.find((p) => p.id === g.providerId);
  const model = provider?.models.find((m) => m.id === g.modelId);

  return (
    <li className="history-row" data-testid="history-row">
      <div className="history-main">
        <div className="history-head">
          <GenerationStatusBadge status={g.status} />
          <strong>{t(`labels.purpose.${g.purpose}`)}</strong>
          {g.cameraId && (
            <span className="badge badge-neutral" title={t("history.camera")}>
              <Camera size={10} /> {camera?.name ?? t("history.removedCamera")}
            </span>
          )}
          <span title={`${g.providerId} / ${g.modelId}`}>
            {provider?.label ?? g.providerId} · {model?.label ?? g.modelId}
          </span>
          <span className="field-hint" title={formatDateTime(g.createdAt)}>
            {formatRelativeTime(g.createdAt)}
          </span>
          {g.durationMs !== null && (
            <span className="field-hint">{formatDuration(g.durationMs)}</span>
          )}
          <span className="field-hint">
            {t("history.counts", {
              refs: g.referenceAssetIds.length,
              outputs: g.params.outputCount,
            })}
            {g.params.aspectRatio ? ` · ${g.params.aspectRatio}` : ""}
            {g.params.imageSize ? ` · ${g.params.imageSize}` : ""}
          </span>
        </div>
        {active && <ActiveGenerationStatus generation={g} compact />}
        {g.error && (
          <div className="history-error">
            <ErrorMessage kind={g.error.kind} message={g.error.message} />
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
          <Ban size={13} /> {t("common.cancel")}
        </button>
      )}
      {canRetry && (
        <button className="btn btn-sm" disabled={readOnly} onClick={() => void retry(g)}>
          <RotateCcw size={13} /> {t("common.retry")}
        </button>
      )}
      <button
        className="btn btn-sm"
        onClick={() => reuse(g)}
        disabled={readOnly || !model}
        title={model ? t("history.reuseTitle") : t("history.reuseGone")}
      >
        <RotateCw size={13} /> {t("history.reuse")}
      </button>
    </li>
  );
}
