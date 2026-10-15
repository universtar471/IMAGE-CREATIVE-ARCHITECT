import { CheckSquare, Layers, RotateCcw, Search, Square, StopCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { GRADE_LOOK_CATALOG, GRADE_LOOKS, type AssetDTO } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { call } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { useLocale, useT } from "../../i18n";
import { GradeCanvas } from "./GradeCanvas";
import { GradeLookGallery } from "./GradeLookGallery";
import {
  batchSourceAssets, gradeAtIntensity, runBatchGrade, searchBatchAssets,
  selectFilteredIds, type BatchItemResult, type BatchSourceFilter, type BatchProgress,
} from "./batchGrade";

const PAGE_SIZE = 48;
const initialProgress: BatchProgress = {
  completed: 0, failed: 0, attempted: 0, total: 0, cancelled: false,
};

/** Main selection dialog: *real* project thumbnails, bulk selection, grading and per-asset versions. */
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
  const [lookId, setLookId] = useState<keyof typeof GRADE_LOOKS>("daylight_clean");
  const [intensity, setIntensity] = useState(100);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [progress, setProgress] = useState<BatchProgress>(initialProgress);
  const [results, setResults] = useState<Record<string, BatchItemResult>>({});
  const cancelRequested = useRef(false);
  const allAssets = workspace.assets;
  const sourceAssets = useMemo(() => batchSourceAssets(allAssets, source), [allAssets, source]);
  const filtered = useMemo(() => searchBatchAssets(sourceAssets, query), [sourceAssets, query]);
  const filteredIds = useMemo(() => filtered.map((a) => a.id), [filtered]);
  const shown = filtered.slice(0, page * PAGE_SIZE);
  const selectedReady = allAssets.filter((a) => selected.has(a.id) && a.status === "ready" && a.mimeType?.startsWith("image/"));
  const previewAsset: AssetDTO | null =
    allAssets.find((a) => a.id === previewId && a.status === "ready") ?? selectedReady[0] ?? shown[0] ?? null;
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));
  const scaledGrade = useMemo(() => gradeAtIntensity(GRADE_LOOKS[lookId], intensity), [lookId, intensity]);
  const label = `Batch color grade · ${lookId} · ${intensity}%`;
  const runningDisabled = busy || readOnly;
  const selectionDisabled = runningDisabled || hasRun;
  const errors = Object.values(results).filter((r) => r.status === "failed");
  const completed = Object.values(results).filter((r) => r.status === "completed");
  const remaining = selectedReady.filter((asset) => !results[asset.id]).map((asset) => asset.id);
  const tr = (en: string, vi: string) => locale === "vi" ? vi : en;

  const closeSafely = () => {
    if (busy) {
      cancelRequested.current = true;
      return; // Keep dialog mounted until native grade_apply finishes the current image.
    }
    onClose();
  };

  const toggle = (id: string) => {
    if (selectionDisabled) return;
    setSelected((previous) => selectFilteredIds(previous, [id], !previous.has(id)));
    setPreviewId(id);
  };

  const submit = async (retryFailed = false, resume = false) => {
    if (runningDisabled || (hasRun && !retryFailed && !resume)) return;
    const candidates = retryFailed
      ? errors.map((r) => r.assetId)
      : resume ? remaining : selectedReady.map((a) => a.id);
    if (!candidates.length) return;
    cancelRequested.current = false;
    setBusy(true);
    setProgress({ ...initialProgress, total: candidates.length });
    setResults((previous) => (retryFailed || resume) ? { ...previous } : {});
    let succeeded = 0;
    let failed = 0;
    try {
      const run = await runBatchGrade({
        assetIds: candidates,
        grade: scaledGrade,
        label,
        apply: (assetId, grade, gradeLabel) => call("grade_apply", {
          projectId: workspace.project.id,
          assetId,
          grade,
          label: gradeLabel,
        }),
        shouldCancel: () => cancelRequested.current,
        onItem: (result, p) => {
          setResults((current) => ({ ...current, [result.assetId]: result }));
          setProgress(p);
        },
      });
      succeeded = run.progress.completed;
      failed = run.progress.failed;
      setProgress(run.progress);
      setHasRun(true);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : String(error));
    } finally {
      // Once, never per image: preserve performance on large batches.
      try {
        const assets = await call("asset_list", { projectId: workspace.project.id });
        await adoptAssets(workspace.project.id, assets);
      } catch (error) {
        notify("warning", tr("Images saved, but library refresh failed.", "Ảnh đã lưu, nhưng không thể tải lại thư viện."));
      }
      setBusy(false);
      notify(failed > 0 ? "warning" : "success", tr(
        `Batch finished: ${succeeded} saved, ${failed} failed.`,
        `Hoàn thành: ${succeeded} ảnh đã lưu, ${failed} lỗi.`,
      ));
    }
  };

  return (
    <Dialog title={tr("Batch Color Grading V5.3", "Áp màu hàng loạt V5.3")} onClose={closeSafely} footer={
      <>
        <span className="batch-grade-footer-count">{selectedReady.length} {tr("selected", "ảnh đã chọn")}</span>
        {busy ? (
          <button type="button" className="btn btn-danger" onClick={() => { cancelRequested.current = true; }} disabled={cancelRequested.current}>
            <StopCircle size={14} /> {tr("Stop after current image", "Dừng sau ảnh hiện tại")}
          </button>
        ) : (
          <>
            {remaining.length > 0 && hasRun && <button className="btn" onClick={() => void submit(false, true)} disabled={readOnly}>
              {tr(`Resume (${remaining.length})`, `Tiếp tục (${remaining.length})`)}
            </button>}
            {errors.length > 0 && <button className="btn" onClick={() => void submit(true)} disabled={readOnly}>
              <RotateCcw size={14} /> {tr(`Retry failed (${errors.length})`, `Thử lại lỗi (${errors.length})`)}
            </button>}
            {hasRun && <button className="btn" onClick={() => { setHasRun(false); setResults({}); setProgress(initialProgress); }}>
              {tr("New batch", "Batch mới")}
            </button>}
            <button className="btn" onClick={onClose}>{t("common.close")}</button>
            <button className="btn btn-primary" disabled={readOnly || selectedReady.length === 0 || hasRun} onClick={() => void submit()}>
              <Layers size={14} /> {tr(`Grade ${selectedReady.length} images`, `Áp màu ${selectedReady.length} ảnh`)}
            </button>
          </>
        )}
      </>
    }>
      <p className="field-hint">{tr(
        "Choose images from this project, preview the look on a real image, then apply the same non-generative grade locally. Originals are never overwritten.",
        "Chọn ảnh trong dự án, xem trước màu trên ảnh thật, rồi áp cùng một bộ màu cục bộ. Không ghi đè ảnh gốc.",
      )}</p>
      <div className="batch-grade-toolbar">
        <label>
          <span>{tr("Image source", "Nguồn ảnh")}</span>
          <select className="input" value={source} disabled={busy} onChange={(event) => { setSource(event.target.value as BatchSourceFilter); setPage(1); }}>
            <option value="generated">{tr("Generated / graded", "Ảnh AI đã tạo / đã chỉnh màu")}</option>
            <option value="ungraded">{tr("All originals (exclude grades)", "Ảnh gốc (loại bản đã chỉnh màu)")}</option>
            <option value="all">{tr("All project images", "Tất cả ảnh dự án")}</option>
          </select>
        </label>
        <label>
          <span>{tr("Search", "Tìm ảnh")}</span>
          <span className="batch-grade-search"><Search size={14} /><input className="input" type="search" value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder={tr("Filename or id...", "Tên ảnh hoặc mã...")} /></span>
        </label>
      </div>
      <div className="batch-grade-selection-bar">
        <span>{filtered.length} {tr("matching images", "ảnh phù hợp")}</span>
        <button className="btn btn-sm" disabled={selectionDisabled || filtered.length===0} onClick={() => { setSelected((prev) => selectFilteredIds(prev, filteredIds, !allFilteredSelected)); }}>
          {allFilteredSelected ? <CheckSquare size={14} /> : <Square size={14} />}
          {allFilteredSelected ? tr("Deselect filtered", "Bỏ chọn nhóm lọc") : tr("Select all filtered", "Chọn tất cả đang lọc")}
        </button>
        <button className="btn btn-sm" disabled={selectionDisabled || selected.size===0} onClick={() => { setSelected(new Set()); }}>
          {tr("Clear selection", "Bỏ chọn tất cả")}
        </button>
      </div>
      <div className="batch-grade-grid" data-testid="batch-grade-gallery">
        {shown.map((asset) => {
          const checked = selected.has(asset.id);
          const thumb = fileUrl(asset.thumbnailPath);
          const status = results[asset.id];
          return (
            <div className={`batch-grade-tile ${checked ? "batch-grade-tile-selected" : ""}`} key={asset.id}>
              <button type="button" className="batch-grade-image" onClick={() => toggle(asset.id)} aria-pressed={checked} aria-label={`${checked ? "Deselect" : "Select"} ${asset.originalName ?? asset.id}`} disabled={selectionDisabled}>
                {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : <span>IMAGE</span>}
                <span className="batch-grade-check">{checked ? <CheckSquare size={18} /> : <Square size={18} />}</span>
              </button>
              <span className="batch-grade-filename" title={asset.originalName ?? asset.id}>{asset.originalName ?? asset.id}</span>
              <div className="batch-grade-tile-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => setPreviewId(asset.id)} disabled={busy}>{tr("Preview", "Xem màu")}</button>
                {status && <span className={`batch-grade-status batch-grade-${status.status}`} title={status.error ?? status.outputAssetId ?? ""}>{status.status === "completed" ? "✓" : "!"}</span>}
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <p className="field-hint">{tr("No images match. Try All project images.", "Không có ảnh phù hợp. Hãy thử Tất cả ảnh dự án.")}</p>}
      {shown.length < filtered.length && <button className="btn" disabled={busy} onClick={() => setPage((p) => p + 1)}>
        {tr(`Show more (${shown.length}/${filtered.length})`, `Xem thêm (${shown.length}/${filtered.length})`)}
      </button>}
      <div className="batch-grade-settings">
        <label>{tr("Colour preset (30 looks)", "Preset màu (30 màu)")}
          <select className="input" value={lookId} disabled={busy || hasRun} onChange={(event) => setLookId(event.target.value as keyof typeof GRADE_LOOKS)}>
            {GRADE_LOOK_CATALOG.map((item) => <option key={item.id} value={item.id}>{locale === "vi" ? item.labelVi : item.labelEn}</option>)}
          </select>
        </label>
        <label>{tr("Intensity", "Cường độ")} — {intensity}%
          <input className="input" type="range" min={0} max={100} step={5} value={intensity} disabled={busy || hasRun} onChange={(event) => setIntensity(Number(event.target.value))} />
        </label>
      </div>
      <button className="btn btn-sm" disabled={busy} onClick={() => setGalleryOpen((s) => !s)}>
        {galleryOpen ? tr("Hide real thumbnails", "Ẩn thư viện màu") : tr("View 30 real-colour thumbnails", "Xem 30 thumbnail màu thật")}
      </button>
      {galleryOpen && <GradeLookGallery asset={previewAsset} value={lookId} disabled={busy || hasRun} onChange={(v) => { if (!hasRun) setLookId(v as keyof typeof GRADE_LOOKS); }} />}
      <div className="batch-grade-preview">
        <strong>{tr("Actual preview · Before / After / Split", "Preview thực · Trước / Sau / Chia đôi")}</strong>
        <GradeCanvas asset={previewAsset} grade={scaledGrade} />
        <p className="field-hint">{tr("Preview and full-resolution save use the same colour parameters; selected images may look different due to their original lighting.", "Preview và ảnh xuất dùng chung thông số màu. Mỗi ảnh có thể khác nhau do ánh sáng nguồn.")}</p>
      </div>
      {(busy || hasRun) && <div className="batch-grade-progress" role="status" aria-live="polite">
        <strong>{progress.attempted} / {progress.total} {tr("processed", "đã xử lý")}</strong>
        <progress max={Math.max(1, progress.total)} value={progress.attempted} />
        <span>{tr("Saved", "Đã lưu")}: {progress.completed} · {tr("Failed", "Lỗi")}: {progress.failed}{progress.cancelled ? ` · ${tr("Stopped", "Đã dừng")}` : ""}</span>
        {errors.slice(0, 5).map((item) => <span key={item.assetId} className="batch-grade-error">{item.assetId}: {item.error}</span>)}
        {completed.length > 0 && <p className="field-hint">{tr(`${completed.length} new versions saved; originals retained.`, `${completed.length} phiên bản mới đã lưu; ảnh gốc được giữ nguyên.`)}</p>}
      </div>}
    </Dialog>
  );
}
