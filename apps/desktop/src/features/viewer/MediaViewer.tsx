/**
 * Large media viewer / lightbox (UX V6.1-R1, ADR-044). One layer over the whole app, in a
 * portal, for the asset set the opener chose (one run's outputs, or one media kind of the
 * project). Images: Fit, 100 %, zoom 25–400 %, pan, ←/→, compare with another image. Clips:
 * the real player, no autoplay, paused and released when the viewer closes or moves on.
 *
 * Viewing never writes: no store data but `viewer` changes, nothing is sent to the backend,
 * and the canvas, selection, prompt draft and Node Canvas transform stay mounted underneath.
 * Esc closes and gives focus back to the element that opened it.
 */
import { ChevronLeft, ChevronRight, Columns2, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isVideoAsset, type AssetDTO } from "@arch/domain";
import { useStudio } from "../../app/store";
import { CompareCanvas } from "../../components/canvas/CompareCanvas";
import { ImageViewer } from "../../components/canvas/ImageViewer";
import { fileUrl } from "../../lib/files";
import { formatClipDuration } from "../../lib/format";
import { useT } from "../../i18n";

/** The large viewer's image zoom range (Fit may be smaller for very large images). */
export const VIEWER_MIN_ZOOM = 0.25;
export const VIEWER_MAX_ZOOM = 4;

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, video, [tabindex]:not([tabindex="-1"])';

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function MediaViewer() {
  const viewer = useStudio((s) => s.viewer);
  // The element that had focus when the viewer opened gets it back on close.
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (viewer && !wasOpen.current) {
      opener.current = document.activeElement as HTMLElement | null;
      wasOpen.current = true;
    }
    if (!viewer && wasOpen.current) {
      wasOpen.current = false;
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
    }
  }, [viewer]);
  if (!viewer) return null;
  return createPortal(<ViewerLayer />, document.body);
}

function ViewerLayer() {
  const t = useT();
  const viewer = useStudio((s) => s.viewer)!;
  const assets = useStudio((s) => s.workspace?.assets ?? []);
  const close = useStudio((s) => s.closeViewer);
  const layer = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const items = viewer.assetIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is AssetDTO => !!a);
  const index = Math.min(Math.max(0, viewer.index), Math.max(0, items.length - 1));
  const asset = items[index] ?? null;
  const video = asset ? isVideoAsset(asset) : false;
  const compareWith =
    !video && viewer.compareWithId
      ? (assets.find((a) => a.id === viewer.compareWithId && !isVideoAsset(a)) ?? null)
      : null;
  // A source image to compare with: the asset's lineage parent, when it is an image.
  const parent =
    asset && !video
      ? (assets.find((a) => a.id === asset.parentAssetId && !isVideoAsset(a)) ?? null)
      : null;

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= items.length) return;
    useStudio.setState({ viewer: { ...viewer, index: next, compareWithId: null } });
  };
  const setCompare = (id: string | null) =>
    useStudio.setState({ viewer: { ...viewer, compareWithId: id } });

  useEffect(() => {
    // Focus inside the viewer so keys work at once (image zoom, Esc, arrows).
    const target = layer.current?.querySelector<HTMLElement>('[data-testid="image-viewer"]');
    (target ?? closeBtn.current)?.focus();
  }, [asset?.id, compareWith?.id]);

  // Keys are handled on the viewer layer itself (it holds the focus while open) and stop
  // there, so canvas or panel shortcuts behind it never fire.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "Tab" && layer.current) {
      const nodes = [...layer.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    // The focused player keeps its own arrow keys (seek); fields keep theirs.
    const target = event.target as HTMLElement | null;
    if (isEditable(target) || target?.tagName === "VIDEO") return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    }
  };

  const name = asset?.originalName ?? asset?.id ?? "";
  return (
    <div
      ref={layer}
      className="media-viewer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("viewer.label")}
      data-testid="media-viewer"
      data-kind={video ? "video" : "image"}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="media-viewer">
        <header className="media-viewer-bar">
          <strong className="media-viewer-title" title={name}>
            {name}
          </strong>
          {items.length > 1 && (
            <span className="media-viewer-pos" data-testid="viewer-position">
              {t("viewer.position", { index: index + 1, total: items.length })}
            </span>
          )}
          <span className="spacer" />
          {!video && parent && !compareWith && (
            <button type="button" className="btn btn-sm" onClick={() => setCompare(parent.id)}>
              <Columns2 size={14} /> {t("viewer.compareSource")}
            </button>
          )}
          {compareWith && (
            <button type="button" className="btn btn-sm" onClick={() => setCompare(null)}>
              {t("viewer.compareOff")}
            </button>
          )}
          <button
            ref={closeBtn}
            type="button"
            className="btn btn-sm btn-icon"
            onClick={close}
            aria-label={t("viewer.close")}
            title={t("viewer.close")}
            data-testid="viewer-close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="media-viewer-body">
          {!asset ? (
            <div className="media-viewer-state">{t("viewer.empty")}</div>
          ) : asset.status === "missing_file" ? (
            <div className="media-viewer-state" role="alert">
              {t("viewer.missing", { name, path: asset.managedRelPath })}
            </div>
          ) : video ? (
            <ViewerVideo key={asset.id} asset={asset} />
          ) : compareWith ? (
            <CompareCanvas source={compareWith} result={asset} />
          ) : (
            <ViewerImage key={asset.id} asset={asset} />
          )}
          {items.length > 1 && (
            <>
              <button
                type="button"
                className="media-viewer-nav is-prev"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label={t("viewer.previous")}
                title={t("viewer.previous")}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                className="media-viewer-nav is-next"
                onClick={() => go(1)}
                disabled={index === items.length - 1}
                aria-label={t("viewer.next")}
                title={t("viewer.next")}
              >
                <ChevronRight size={22} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ViewerImage({ asset }: { asset: AssetDTO }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const src = fileUrl(asset.absolutePath);
  if (!src || failed)
    return (
      <div className="media-viewer-state" role="alert">
        <p>{t("viewer.unsupported")}</p>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          {t("viewer.retry")}
        </button>
      </div>
    );
  return (
    <ImageViewer
      key={attempt}
      src={src}
      alt={asset.originalName ?? asset.id}
      naturalWidth={asset.widthPx}
      naturalHeight={asset.heightPx}
      minZoom={VIEWER_MIN_ZOOM}
      maxZoom={VIEWER_MAX_ZOOM}
      keyboard
      onError={() => setFailed(true)}
    />
  );
}

/**
 * The real player: controls (play, seek, volume, mute, fullscreen) from the browser, a Stop
 * button, no autoplay. Unmounting (close, next item) pauses and releases the media, so no
 * sound keeps playing behind the app.
 */
export function ViewerVideo({ asset }: { asset: AssetDTO }) {
  const t = useT();
  const ref = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const src = fileUrl(asset.absolutePath);
  const poster = fileUrl(asset.thumbnailPath) ?? undefined;

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el) return;
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [attempt]);

  const posterLabel =
    asset.posterSource === "frame"
      ? t("viewer.posterFrame")
      : asset.posterSource === "source"
        ? t("viewer.posterSource")
        : t("viewer.posterUnknown");

  return (
    <figure className="media-viewer-video" data-testid="viewer-video" data-state={state}>
      {state === "error" ? (
        <div className="media-viewer-state" role="alert">
          {poster && <img src={poster} alt={posterLabel} />}
          <p>{t("videoModule.playError")}</p>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setState("loading");
              setAttempt((n) => n + 1);
            }}
          >
            {t("viewer.retry")}
          </button>
        </div>
      ) : (
        <video
          key={attempt}
          ref={ref}
          src={src ?? undefined}
          poster={poster}
          controls
          preload="metadata"
          playsInline
          aria-label={t("videoModule.player")}
          onLoadedMetadata={() => setState("ready")}
          onError={() => setState("error")}
        />
      )}
      <figcaption className="media-viewer-caption">
        <span>{posterLabel}</span>
        {asset.durationMs != null && <span>{formatClipDuration(asset.durationMs)}</span>}
        {state === "loading" && <span>{t("viewer.loading")}</span>}
        {state !== "error" && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              el.pause();
              el.currentTime = 0;
            }}
            data-testid="viewer-stop"
          >
            <Square size={12} /> {t("viewer.stop")}
          </button>
        )}
      </figcaption>
    </figure>
  );
}
