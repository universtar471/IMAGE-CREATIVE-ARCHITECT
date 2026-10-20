import { useLayoutEffect, useState, type RefObject } from "react";

export type ElementSize = { width: number; height: number };

/**
 * Size of an element in CSS px, kept current with a ResizeObserver (window resize, maximize,
 * restore, panel drags and Windows display scale all arrive here). Starts at 0×0 until the
 * first measurement; environments without ResizeObserver (old jsdom) keep the first read.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        prev.width === Math.round(rect.width) && prev.height === Math.round(rect.height)
          ? prev
          : { width: Math.round(rect.width), height: Math.round(rect.height) },
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}
