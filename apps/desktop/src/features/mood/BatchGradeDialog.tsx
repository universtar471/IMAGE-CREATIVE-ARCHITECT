import { CheckSquare, Layers, RotateCcw, Search, Square, StopCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  GRADE_LOOK_CATALOG,
  GRADE_STYLE_PRESETS,
  type AssetDTO,
  type ColorGradeDNA,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { call } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { useLocale, useT } from "../../i18n";
import { GradeCanvas } from "./GradeCanvas";
import { GradeLookGallery } from "./GradeLookGallery";
import {
  STYLE_PRESET_IDS,
  gradeForPreset,
  matchingStylePresets,
  withLut,
  withLutStrength,
} from "./gradePresets";
import { neutralGrade } from "../../lib/grade";
import {
  batchSourceAssets,
  gradeAtIntensity,
  runBatchGrade,
  searchBatchAssets,
  selectFilteredIds,
  type BatchItemResult,
  type BatchSourceFilter,
  type BatchProgress,
} from "./batchGrade";

const PAGE_SIZE = 48;
const initialProgress: BatchProgress = {
  completed: 0,
  failed: 0,
  attempted: 0,
  total: 0,
  cancelled: false,
};

/** Batch choice: a v1 look id, a style preset id, or the project's current grade. */
const CURRENT = "current";

/**
 * Batch colour grade (V5.3, ADR-032): real project thumbnails, bulk selection and one
 * sequential `grade_apply` per image. Never writes `draftDna.colorGrade`.
 */
export function BatchGradeDialog({ onClose }: { onClose: () => void }) {
  const workspace = useStudio((s) => s.workspace!);
  const adoptAssets = useStudio((s) => s.adoptAssets);
  const notify = useStudio((s) => s.notify);
  const readOnly = useStudio(selectReadOnly);
  const t = useT();
  const locale = useLocale((s) => s.locale);

  const [source, setSource] = useState<BatchSourceFilter>("generated");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [presetId, setPresetId] = useState<string>("daylight_clean");
  // The LUT layer of the batch grade, chosen in the gallery's LUT tab.
  const [lut, setLut] = useState<ColorGradeDNA["lut"]>(undefined);
  const [intensity, setIntensity] = useState(100);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [progress, setProgress] = useState<BatchProgress>(initialProgress);
  const [results, setResults] = useState<Record<string, BatchItemResult>>({});
  // Refs, not state: read synchronously by the runner and by a second click in the same tick.
  const cancelRequested = useRef(false);
  const running = useRef(false);
  const closeWhenDone = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      // Unmounted mid-run (e.g. the panel went away): stop after the current image.
      mounted.current = false;
      cancelRequested.current = true;
    };
  }, []);

  const projectId = workspace.project.id;
  const allAssets = workspace.assets;
  const sourceAssets = useMemo(() => batchSourceAssets(allAssets, source), [allAssets, source]);
  const filtered = useMemo(() => searchBatchAssets(sourceAssets, query), [sourceAssets, query]);
  const filteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);
  const shown = filtered.slice(0, page * PAGE_SIZE);
  const selectedReady = allAssets.filter(
    (a) => selected.has(a.id) && a.status === "ready" && !!a.mimeType?.startsWith("image/"),
  );
  const previewAsset: AssetDTO | null =
    allAssets.find((a) => a.id === previewId && a.status === "ready") ??
    selectedReady[0] ??
    shown[0] ??
    null;
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const currentGrade = workspace.draftDna.colorGrade as ColorGradeDNA | undefined;
  const styleMatches = useMemo(
    () => matchingStylePresets(workspace.draftDna),
    [workspace.draftDna],
  );
  // Read once per choice; the batch never writes draftDna.colorGrade.
  const baseGrade = useMemo<ColorGradeDNA>(() => {
    const chosen =
      presetId === CURRENT ? { ...(currentGrade ?? neutralGrade()) } : gradeForPreset(presetId);
    const { lut: _ignored, ...rest } = chosen ?? neutralGrade();
    return lut ? { ...rest, lut } : rest;
  }, [currentGrade, lut, presetId]);
  const scaledGrade = useMemo(() => gradeAtIntensity(baseGrade, intensity), [baseGrade, intensity]);
  const label = `Batch color grade · ${presetId === CURRENT ? (currentGrade?.look ?? CURRENT) : presetId}${
    lut ? " + LUT" : ""
  } · ${intensity}%`;
  const runningDisabled = busy || readOnly;
  const selectionDisabled = runningDisabled || hasRun;
  const errors = Object.values(results).filter((r) => r.status === "failed");
  const completed = Object.values(results).filter((r) => r.status === "completed");
  const remaining = selectedReady.filter((asset) => !results[asset.id]).map((asset) => asset.id);

  const requestStop = () => {
    cancelRequested.current = true;
    setStopping(true);
  };

  const closeSafely = () => {
    if (running.current) {
      // Keep the dialog mounted until native grade_apply finishes the current image.
      closeWhenDone.current = true;
      requestStop();
      return;
    }
    onClose();
  };

  const toggle = (id: string) => {
    if (selectionDisabled) return;
    setSelected((previous) => selectFilteredIds(previous, [id], !previous.has(id)));
    setPreviewId(id);
  };

  const submit = async (mode: "new" | "retry" | "resume") => {
    if (running.current || readOnly || (hasRun && mode === "new")) return;
    const candidates =
      mode === "retry"
        ? errors.map((r) => r.assetId)
        : mode === "resume"
          ? remaining
          : selectedReady.map((a) => a.id);
    if (!candidates.length) return;
    running.current = true;
    cancelRequested.current = false;
    closeWhenDone.current = false;
    setBusy(true);
    setStopping(false);
    setProgress({ ...initialProgress, total: candidates.length });
    if (mode === "new") setResults({});
    let succeeded = 0;
    let failed = 0;
    let cancelled = false;
    try {
      const run = await runBatchGrade({
        assetIds: candidates,
        grade: scaledGrade,
        label,
        apply: (assetId, grade, gradeLabel) =>
          call("grade_apply", { projectId, assetId, grade, label: gradeLabel }),
        shouldCancel: () => cancelRequested.current,
        onItem: (result, p) => {
          if (!mounted.current) return;
          setResults((current) => ({ ...current, [result.assetId]: result }));
          setProgress(p);
        },
      });
      succeeded = run.progress.completed;
      failed = run.progress.failed;
      cancelled = run.progress.cancelled;
      if (mounted.current) setProgress(run.progress);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    } finally {
      // Once per run, never per image: keeps large batches fast.
      if (succeeded > 0) {
        try {
          const assets = await call("asset_list", { projectId });
          await adoptAssets(projectId, assets);
        } catch {
          notify("warning", t("moodGrade.batchDialog.refreshFailed"));
        }
      }
      running.current = false;
      notify(
        failed > 0 || cancelled ? "warning" : "success",
        t(cancelled ? "moodGrade.batchDialog.finishedStopped" : "moodGrade.batchDialog.finished", {
          completed: succeeded,
          failed,
        }),
      );
      if (mounted.current) {
        setHasRun(true);
        setBusy(false);
        setStopping(false);
        if (closeWhenDone.current) onClose();
      }
    }
  };

  const resetRun = () => {
    setHasRun(false);
    setResults({});
    setProgress(initialProgress);
  };

  return (
    <Dialog
      title={t("moodGrade.batchDialog.title")}
      onClose={closeSafely}
      footer={
        <>
          <span className="batch-grade-footer-count">
            {t("moodGrade.batchDialog.selectedCount", { count: selectedReady.length })}
          </span>
          {busy ? (
            <button
              type="button"
              className="btn btn-danger"
              data-testid="batch-grade-stop"
              onClick={requestStop}
              disabled={stopping}
            >
              <StopCircle size={14} />{" "}
              {t(stopping ? "moodGrade.batchDialog.stopping" : "moodGrade.batchDialog.stop")}
            </button>
          ) : (
            <>
              {remaining.length > 0 && hasRun && (
                <button
                  type="button"
                  className="btn"
                  data-testid="batch-grade-resume"
                  onClick={() => void submit("resume")}
                  disabled={readOnly}
                >
                  {t("moodGrade.batchDialog.resume", { count: remaining.length })}
                </button>
              )}
              {errors.length > 0 && (
                <button
                  type="button"
                  className="btn"
                  data-testid="batch-grade-retry"
                  onClick={() => void submit("retry")}
                  disabled={readOnly}
                >
                  <RotateCcw size={14} />{" "}
                  {t("moodGrade.batchDialog.retryFailed", { count: errors.length })}
                </button>
              )}
              {hasRun && (
                <button type="button" className="btn" onClick={resetRun}>
                  {t("moodGrade.batchDialog.newBatch")}
                </button>
              )}
              <button type="button" className="btn" onClick={onClose}>
                {t("common.close")}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="batch-grade-run"
                disabled={readOnly || selectedReady.length === 0 || hasRun}
                onClick={() => void submit("new")}
              >
                <Layers size={14} />{" "}
                {t("moodGrade.batchDialog.run", { count: selectedReady.length })}
              </button>
            </>
          )}
        </>
      }
    >
      <p className="field-hint">{t("moodGrade.batchDialog.intro")}</p>
      {readOnly && (
        <p className="field-hint" role="alert" data-testid="batch-grade-readonly">
          {t("moodGrade.batchDialog.readOnly")}
        </p>
      )}
      <div className="batch-grade-toolbar">
        <label>
          <span>{t("moodGrade.batchDialog.source")}</span>
          <select
            className="input"
            value={source}
            disabled={busy}
            onChange={(event) => {
              setSource(event.target.value as BatchSourceFilter);
              setPage(1);
            }}
          >
            <option value="generated">{t("moodGrade.batchDialog.sourceGenerated")}</option>
            <option value="ungraded">{t("moodGrade.batchDialog.sourceUngraded")}</option>
            <option value="all">{t("moodGrade.batchDialog.sourceAll")}</option>
          </select>
        </label>
        <label>
          <span>{t("moodGrade.batchDialog.search")}</span>
          <span className="batch-grade-search">
            <Search size={14} />
            <input
              className="input"
              type="search"
              value={query}
              disabled={busy}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder={t("moodGrade.batchDialog.searchPlaceholder")}
            />
          </span>
        </label>
      </div>
      <div className="batch-grade-selection-bar">
        <span>{t("moodGrade.batchDialog.matching", { count: filtered.length })}</span>
        <button
          type="button"
          className="btn btn-sm"
          disabled={selectionDisabled || filtered.length === 0}
          onClick={() =>
            setSelected((prev) => selectFilteredIds(prev, filteredIds, !allFilteredSelected))
          }
        >
          {allFilteredSelected ? <CheckSquare size={14} /> : <Square size={14} />}
          {t(
            allFilteredSelected
              ? "moodGrade.batchDialog.deselectFiltered"
              : "moodGrade.batchDialog.selectFiltered",
          )}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={selectionDisabled || selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          {t("moodGrade.batchDialog.clearSelection")}
        </button>
      </div>
      <div className="batch-grade-grid" data-testid="batch-grade-gallery">
        {shown.map((asset) => {
          const checked = selected.has(asset.id);
          const thumb = fileUrl(asset.thumbnailPath);
          const status = results[asset.id];
          const name = asset.originalName ?? asset.id;
          return (
            <div
              className={`batch-grade-tile ${checked ? "batch-grade-tile-selected" : ""}`}
              key={asset.id}
            >
              <button
                type="button"
                className="batch-grade-image"
                data-testid={`batch-grade-tile-${asset.id}`}
                onClick={() => toggle(asset.id)}
                aria-pressed={checked}
                aria-label={t("moodGrade.batchDialog.toggleImage", { name })}
                disabled={selectionDisabled}
              >
                {thumb ? (
                  <img src={thumb} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span>{t("moodGrade.batchDialog.noThumbnail")}</span>
                )}
                <span className="batch-grade-check">
                  {checked ? <CheckSquare size={18} /> : <Square size={18} />}
                </span>
              </button>
              <span className="batch-grade-filename" title={name}>
                {name}
              </span>
              <div className="batch-grade-tile-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setPreviewId(asset.id)}
                  disabled={busy}
                >
                  {t("moodGrade.batchDialog.previewImage")}
                </button>
                {status && (
                  <span
                    className={`batch-grade-status batch-grade-${status.status}`}
                    title={status.error ?? status.outputAssetId ?? ""}
                  >
                    {status.status === "completed" ? "✓" : "!"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <p className="field-hint">{t("moodGrade.batchDialog.noMatch")}</p>}
      {shown.length < filtered.length && (
        <button type="button" className="btn" disabled={busy} onClick={() => setPage((p) => p + 1)}>
          {t("moodGrade.batchDialog.showMore", { shown: shown.length, total: filtered.length })}
        </button>
      )}
      <div className="batch-grade-settings">
        <label>
          {t("moodGrade.batchDialog.look")}
          <select
            className="input"
            value={presetId}
            data-testid="batch-grade-look"
            disabled={busy || hasRun}
            onChange={(event) => {
              const id = event.target.value;
              if (id === CURRENT || gradeForPreset(id)) setPresetId(id);
            }}
          >
            {currentGrade && (
              <option value={CURRENT}>{t("moodGrade.batchDialog.currentGrade")}</option>
            )}
            <optgroup label={t("moodGrade.batchDialog.looksGroup")}>
              {GRADE_LOOK_CATALOG.map((item) => (
                <option key={item.id} value={item.id}>
                  {locale === "vi" ? item.labelVi : item.labelEn}
                </option>
              ))}
            </optgroup>
            <optgroup label={t("moodGrade.gradeCategory.style")}>
              {STYLE_PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {locale === "vi" ? GRADE_STYLE_PRESETS[id].vi : GRADE_STYLE_PRESETS[id].en}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <label>
          {t("moodGrade.batchDialog.intensity", { value: intensity })}
          <input
            className="input"
            type="range"
            min={0}
            max={100}
            step={5}
            value={intensity}
            disabled={busy || hasRun}
            onChange={(event) => setIntensity(Number(event.target.value))}
          />
        </label>
      </div>
      <button
        type="button"
        className="btn btn-sm"
        disabled={busy}
        onClick={() => setGalleryOpen((s) => !s)}
      >
        {t(galleryOpen ? "moodGrade.batchDialog.hideGallery" : "moodGrade.batchDialog.showGallery")}
      </button>
      {lut && (
        <p className="field-hint" data-testid="batch-grade-lut">
          {t("moodGrade.batchDialog.lutLayer", { strength: Math.round(lut.strength) })}{" "}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy || hasRun}
            onClick={() => setLut(undefined)}
          >
            {t("luts.clear")}
          </button>
        </p>
      )}
      {galleryOpen && (
        <GradeLookGallery
          asset={previewAsset}
          value={presetId}
          disabled={busy || hasRun}
          styleMatches={styleMatches}
          lutId={lut?.lutId}
          lutStrength={lut?.strength}
          onChange={(id) => {
            if (!hasRun && gradeForPreset(id)) setPresetId(id);
          }}
          onLut={(lutId) => {
            if (!hasRun) setLut(withLut({ ...neutralGrade(), lut }, lutId).lut);
          }}
          onLutStrength={(value) => {
            if (!hasRun) setLut(withLutStrength({ ...neutralGrade(), lut }, value).lut);
          }}
        />
      )}
      <div className="batch-grade-preview">
        <strong>{t("moodGrade.batchDialog.previewTitle")}</strong>
        <GradeCanvas asset={previewAsset} grade={scaledGrade} />
        <p className="field-hint">{t("moodGrade.batchDialog.previewHint")}</p>
      </div>
      {(busy || hasRun) && (
        <div className="batch-grade-progress" role="status" aria-live="polite">
          <strong>
            {t("moodGrade.batchDialog.processed", {
              done: progress.attempted,
              total: progress.total,
            })}
          </strong>
          <progress max={Math.max(1, progress.total)} value={progress.attempted} />
          <span>
            {t("moodGrade.batchDialog.summary", {
              completed: progress.completed,
              failed: progress.failed,
            })}
            {progress.cancelled ? ` · ${t("moodGrade.batchDialog.stopped")}` : ""}
          </span>
          {errors.slice(0, 5).map((item) => (
            <span key={item.assetId} className="batch-grade-error">
              {item.assetId}: {item.error}
            </span>
          ))}
          {completed.length > 0 && (
            <p className="field-hint">
              {t("moodGrade.batchDialog.savedVersions", { count: completed.length })}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
