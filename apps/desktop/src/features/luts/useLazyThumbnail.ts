/**
 * Lazy backend thumbnails (grade_preview / lut_preview): load only once the tile scrolls
 * near the viewport, and never let an older response replace a newer one.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { BridgeError } from "../../lib/bridge";

/** True once `ref` has been near the viewport. Without IntersectionObserver: at once. */
export function useInView(ref: RefObject<Element | null>, rootMargin = "200px"): boolean {
  const supported = typeof IntersectionObserver === "function";
  const [seen, setSeen] = useState(!supported);
  useEffect(() => {
    const el = ref.current;
    if (seen || !el || !supported) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin, seen, supported]);
  return seen;
}

export type ThumbnailState = {
  url: string | null;
  loading: boolean;
  /** "missing" when the backend reports NOT_FOUND (a LUT file that moved away). */
  error: null | "missing" | "failed";
  /** For `<img onError>`: bytes that do not decode count as a failed preview. */
  onImageError: () => void;
};

/**
 * Loads `load()` when `enabled` and whenever `key` changes. Each request gets a sequence
 * number; only the latest one may set the state, so a slow answer for an older key is
 * dropped. Object URLs are revoked when replaced and on unmount.
 */
export function useLazyThumbnail(
  key: string | null,
  enabled: boolean,
  load: () => Promise<Blob>,
): ThumbnailState {
  const [state, setState] = useState<Omit<ThumbnailState, "onImageError"> & { key: string | null }>(
    {
      key: null,
      url: null,
      loading: false,
      error: null,
    },
  );
  const seq = useRef(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const mine = ++seq.current;
    if (!key || !enabled) return;
    void (async () => {
      try {
        const blob = await loadRef.current();
        if (mine !== seq.current) return;
        const url = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setState({ key, url, loading: false, error: null });
      } catch (err) {
        if (mine !== seq.current) return;
        const missing = err instanceof BridgeError && err.code === "NOT_FOUND";
        setState({ key, url: null, loading: false, error: missing ? "missing" : "failed" });
      }
    })();
  }, [key, enabled]);

  useEffect(
    () => () => {
      seq.current++;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  const shownUrl = state.url;
  const onImageError = () =>
    setState((current) =>
      current.url === shownUrl ? { ...current, url: null, error: "failed" } : current,
    );
  if (!key || state.key !== key)
    return { url: null, loading: !!key && enabled, error: null, onImageError };
  return { url: state.url, loading: state.loading, error: state.error, onImageError };
}
