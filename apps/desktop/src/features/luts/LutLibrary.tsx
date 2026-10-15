import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Maximize2,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Trash2,
  X,
} from "lucide-react";
import type { AssetDTO } from "@arch/domain";
import { Dialog, ConfirmDialog } from "../../components/common/Dialog";
import {
  call,
  lutPreview,
  type LutItem,
  type LutListRequest,
  type LutSource,
} from "../../lib/bridge";
import { useStudio } from "../../app/store";
import { useT } from "../../i18n";
import { groupLuts, LUT_PAGE_SIZE, pickLutFolder, THUMB_SIZE } from "./lutApi";
import { useInView, useLazyThumbnail } from "./useLazyThumbnail";

export type LutLibraryProps = {
  asset: AssetDTO | null;
  selectedLutId?: string;
  strength?: number;
  disabled?: boolean;
  /** "panel" fits the 320–720 px right panel; "full" is the large dialog. */
  variant?: "panel" | "full";
  onSelect: (lutId: string | null) => void;
  onStrength: (value: number) => void;
};

function LutTile({
  lut,
  asset,
  selected,
  disabled,
  onSelect,
  onFavorite,
}: {
  lut: LutItem;
  asset: AssetDTO | null;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref);
  const assetId = asset?.status === "ready" ? asset.id : null;
  const statusMissing = lut.status === "missing";
  const key = assetId && lut.status === "ok" ? `${lut.id}:${assetId}` : null;
  const thumb = useLazyThumbnail(key, visible, () =>
    lutPreview({ lutId: lut.id, assetId: assetId!, size: THUMB_SIZE }),
  );
  const missing = statusMissing || thumb.error === "missing";
  const invalid = lut.status === "invalid";
  return (
    <div
      ref={ref}
      className={`lut-tile${selected ? " lut-tile-selected" : ""}${missing ? " lut-tile-missing" : ""}`}
      data-testid={`lut-tile-${lut.id}`}
    >
      <button
        type="button"
        className="lut-tile-pick"
        aria-pressed={selected}
        disabled={disabled || missing || invalid}
        onClick={onSelect}
        title={lut.relPath}
      >
        <span className="lut-thumb">
          {thumb.url ? (
            <img src={thumb.url} alt="" onError={thumb.onImageError} />
          ) : (
            <span className="lut-thumb-state">
              {missing
                ? t("luts.missing")
                : invalid
                  ? t("luts.invalid")
                  : !assetId
                    ? t("luts.needsImage")
                    : thumb.error
                      ? t("luts.previewFailed")
                      : t("luts.loadingThumb")}
            </span>
          )}
        </span>
        <span className="lut-name">{lut.name}</span>
      </button>
      {missing && (
        <span className="lut-badge lut-badge-missing" data-testid="lut-missing">
          {t("luts.missing")}
        </span>
      )}
      {lut.isLog && (
        <span className="lut-badge lut-badge-log" data-testid="lut-log-badge">
          {t("luts.logBadge")}
        </span>
      )}
      <button
        type="button"
        className={`lut-fav${lut.favorite ? " lut-fav-on" : ""}`}
        aria-pressed={lut.favorite}
        aria-label={t(lut.favorite ? "luts.unfavorite" : "luts.favorite", { name: lut.name })}
        onClick={onFavorite}
      >
        <Star size={12} />
      </button>
    </div>
  );
}

function LutSourceManager({
  sources,
  busy,
  onRescan,
  onRemove,
}: {
  sources: LutSource[];
  busy: boolean;
  onRescan: (source: LutSource) => void;
  onRemove: (source: LutSource) => void;
}) {
  const t = useT();
  if (!sources.length) return <p className="field-hint">{t("luts.noSources")}</p>;
  return (
    <ul className="lut-sources" data-testid="lut-sources">
      {sources.map((source) => (
        <li key={source.id}>
          <span className="lut-source-path" title={source.path}>
            {source.path}
          </span>
          <span className="lut-source-count">
            {t("luts.sourceCount", { count: source.lutCount })}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            disabled={busy}
            aria-label={t("luts.rescan", { path: source.path })}
            title={t("luts.rescan", { path: source.path })}
            onClick={() => onRescan(source)}
          >
            <RefreshCw size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            disabled={busy}
            aria-label={t("luts.removeSource", { path: source.path })}
            title={t("luts.removeSource", { path: source.path })}
            data-testid={`lut-remove-${source.id}`}
            onClick={() => onRemove(source)}
          >
            <Trash2 size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The user's LUT library (ADR-031, API §21.3): folders the user owns, indexed by the
 * backend. Thumbnails are the current asset through each LUT, loaded lazily.
 */
export function LutLibrary({
  asset,
  selectedLutId,
  strength,
  disabled = false,
  variant = "panel",
  onSelect,
  onStrength,
}: LutLibraryProps) {
  const t = useT();
  const notify = useStudio((s) => s.notify);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [archOnly, setArchOnly] = useState(true);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ items: LutItem[]; total: number } | null>(null);
  const [listError, setListError] = useState(false);
  const [sources, setSources] = useState<LutSource[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<LutSource | null>(null);
  const [fullOpen, setFullOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const listSeq = useRef(0);

  useEffect(() => {
    const mine = ++listSeq.current;
    const request: LutListRequest = {
      ...(query.trim() ? { query: query.trim() } : {}),
      favoritesOnly,
      archOnly,
      limit: LUT_PAGE_SIZE,
      offset: page * LUT_PAGE_SIZE,
    };
    call("lut_list", request).then(
      (next) => {
        if (mine !== listSeq.current) return;
        setResult(next);
        setListError(false);
      },
      () => {
        if (mine === listSeq.current) setListError(true);
      },
    );
  }, [query, favoritesOnly, archOnly, page, reload]);

  useEffect(() => {
    let live = true;
    call("lut_source_list", {}).then(
      (list) => live && setSources(list),
      () => live && setSources([]),
    );
    return () => {
      live = false;
    };
  }, [reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const groups = useMemo(() => groupLuts(result?.items ?? []), [result]);
  const total = result?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LUT_PAGE_SIZE));

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const addFolder = () =>
    run(async () => {
      const path = await pickLutFolder();
      if (!path) return;
      const scan = await call("lut_source_add", { path });
      setSummary(t("luts.scanSummary", { added: scan.added, invalid: scan.invalid }));
      setPage(0);
    });

  const rescan = (source: LutSource) =>
    run(async () => {
      const scan = await call("lut_source_rescan", { sourceId: source.id });
      setSummary(t("luts.scanSummary", { added: scan.added, invalid: scan.invalid }));
    });

  const remove = (source: LutSource) =>
    run(async () => {
      setConfirmRemove(null);
      await call("lut_source_remove", { sourceId: source.id });
      setSummary(t("luts.sourceRemoved", { path: source.path }));
      setPage(0);
    });

  const toggleFavorite = (lut: LutItem) =>
    run(async () => {
      await call("lut_set_favorite", { lutId: lut.id, favorite: !lut.favorite });
    });

  const selected = selectedLutId
    ? (result?.items.find((item) => item.id === selectedLutId) ?? null)
    : null;

  return (
    <div className={`lut-library lut-library-${variant}`} data-testid={`lut-library-${variant}`}>
      <div className="lut-toolbar">
        <span className="lut-search">
          <Search size={13} aria-hidden="true" />
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t("luts.search")}
            aria-label={t("luts.search")}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </span>
        <div className="lut-filters">
          <label className="lut-check">
            <input
              type="checkbox"
              checked={favoritesOnly}
              data-testid="lut-favorites-filter"
              onChange={(event) => {
                setFavoritesOnly(event.target.checked);
                setPage(0);
              }}
            />
            <Star size={12} aria-hidden="true" /> {t("luts.favoritesOnly")}
          </label>
          <label className="lut-check" title={t("luts.archOnlyHint")}>
            <input
              type="checkbox"
              checked={archOnly}
              data-testid="lut-arch-filter"
              onChange={(event) => {
                setArchOnly(event.target.checked);
                setPage(0);
              }}
            />
            {t("luts.archOnly")}
          </label>
        </div>
        <div className="lut-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            data-testid="lut-add-folder"
            onClick={() => void addFolder()}
          >
            <FolderPlus size={13} /> {t("luts.addFolder")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-expanded={managerOpen}
            onClick={() => setManagerOpen((open) => !open)}
          >
            <Settings2 size={13} /> {t("luts.manageSources")}
          </button>
          {variant === "panel" && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              data-testid="lut-open-full"
              onClick={() => setFullOpen(true)}
            >
              <Maximize2 size={13} /> {t("luts.openFull")}
            </button>
          )}
        </div>
      </div>
      {summary && (
        <p className="field-hint" role="status" data-testid="lut-summary">
          {summary}
        </p>
      )}
      {managerOpen && (
        <LutSourceManager
          sources={sources}
          busy={busy}
          onRescan={(source) => void rescan(source)}
          onRemove={setConfirmRemove}
        />
      )}
      {selectedLutId && (
        <div className="lut-selected" data-testid="lut-selected">
          <span className="lut-selected-name" title={selected?.relPath}>
            {t("luts.selected", { name: selected?.name ?? selectedLutId })}
          </span>
          <label className="lut-strength">
            <span>{t("luts.strength", { value: Math.round(strength ?? 0) })}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={strength ?? 0}
              disabled={disabled}
              data-testid="lut-strength"
              aria-label={t("luts.strengthLabel")}
              onChange={(event) => onStrength(Number(event.target.value))}
            />
          </label>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={disabled}
            onClick={() => onSelect(null)}
          >
            <X size={12} /> {t("luts.clear")}
          </button>
        </div>
      )}
      {listError && (
        <p className="field-hint" role="alert">
          {t("luts.listFailed")}
        </p>
      )}
      {result && total === 0 && (
        <p className="field-hint" data-testid="lut-empty">
          {sources.length ? t("luts.noMatch") : t("luts.empty")}
        </p>
      )}
      <div className="lut-groups">
        {groups.map((group) => (
          <section key={group.key} className="lut-group">
            <h4 className="lut-group-title" title={`${group.pack} › ${group.category}`}>
              {group.pack === group.category ? group.pack : `${group.pack} › ${group.category}`}
            </h4>
            <div className="lut-grid">
              {group.items.map((lut) => (
                <LutTile
                  key={lut.id}
                  lut={lut}
                  asset={asset}
                  selected={lut.id === selectedLutId}
                  disabled={disabled}
                  onSelect={() => onSelect(lut.id)}
                  onFavorite={() => void toggleFavorite(lut)}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {total > LUT_PAGE_SIZE && (
        <div className="lut-pager">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page === 0}
            aria-label={t("luts.prevPage")}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            <ChevronLeft size={13} />
          </button>
          <span data-testid="lut-page">{t("luts.page", { page: page + 1, pages, total })}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={page + 1 >= pages}
            aria-label={t("luts.nextPage")}
            data-testid="lut-next-page"
            onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          >
            <ChevronRight size={13} />
          </button>
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title={t("luts.removeTitle")}
          danger
          confirmLabel={t("common.remove")}
          message={t("luts.removeConfirm", { path: confirmRemove.path })}
          onConfirm={() => void remove(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
      {fullOpen && (
        <LutLibraryDialog
          asset={asset}
          selectedLutId={selectedLutId}
          strength={strength}
          disabled={disabled}
          onSelect={onSelect}
          onStrength={onStrength}
          onClose={() => {
            setFullOpen(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Full-size LUT library (API §21.3). */
export function LutLibraryDialog({
  onClose,
  ...props
}: Omit<LutLibraryProps, "variant"> & { onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      title={t("luts.title")}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t("common.close")}
        </button>
      }
    >
      <LutLibrary {...props} variant="full" />
    </Dialog>
  );
}
