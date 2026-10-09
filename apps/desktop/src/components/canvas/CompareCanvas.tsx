import { useEffect, useState } from "react";
import type { AssetDTO } from "@arch/domain";
import { assetPreview } from "../../lib/bridge";
import { useT } from "../../i18n";

export type CompareMode = "before" | "after" | "split";

/** Binary-preview compare surface shared by enhancement and future post-processing tools. */
export function CompareCanvas({
  source,
  result,
  projectId = source?.projectId ?? result?.projectId,
}: {
  source: AssetDTO | null;
  result: AssetDTO | null;
  projectId?: string;
}) {
  const t = useT();
  const [mode, setMode] = useState<CompareMode>("split");
  const [split, setSplit] = useState(50);
  const [urls, setUrls] = useState<{ source: string | null; result: string | null }>({
    source: null,
    result: null,
  });
  const [error, setError] = useState(false);
  const sourceId = source?.id;
  const resultId = result?.id;

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    const loaded = new Map<string, Promise<string | null>>();
    const load = (assetId: string | undefined): Promise<string | null> => {
      if (!assetId || !projectId) return Promise.resolve(null);
      const existing = loaded.get(assetId);
      if (existing) return existing;
      const promise = assetPreview({ projectId, assetId, maxEdge: 1600 }).then((blob) => {
        if (typeof URL.createObjectURL !== "function") return "";
        const url = URL.createObjectURL(blob);
        created.push(url);
        return url;
      });
      loaded.set(assetId, promise);
      return promise;
    };
    void Promise.all([load(sourceId), load(resultId)])
      .then(([sourceUrl, resultUrl]) => {
        if (!cancelled) {
          setError(false);
          setUrls({ source: sourceUrl, result: resultUrl });
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [projectId, resultId, sourceId]);

  if (!source || !result)
    return (
      <div className="state" data-testid="compare-empty">
        {t("enhance.noCompare")}
      </div>
    );
  return (
    <section
      className="compare-canvas"
      data-testid="compare-canvas"
      aria-label={t("enhance.compare")}
    >
      <div className="compare-canvas-stage">
        {urls.source && (
          <img className="compare-canvas-image" src={urls.source} alt={t("enhance.before")} />
        )}
        {urls.result && mode !== "before" && (
          <img
            className="compare-canvas-image compare-canvas-after"
            src={urls.result}
            alt={t("enhance.after")}
            style={mode === "split" ? { clipPath: `inset(0 0 0 ${split}%)` } : undefined}
          />
        )}
        {mode === "split" && (
          <span className="compare-canvas-divider" style={{ left: `${split}%` }} />
        )}
        {error && (
          <div className="state" role="alert">
            {t("enhance.previewError")}
          </div>
        )}
      </div>
      <div className="compare-canvas-toolbar" role="group" aria-label={t("enhance.compare")}>
        {(["before", "after", "split"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`btn btn-sm ${mode === value ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={mode === value}
            onClick={() => setMode(value)}
          >
            {t(`enhance.${value}`)}
          </button>
        ))}
        {mode === "split" && (
          <input
            aria-label={t("enhance.split")}
            type="range"
            min="0"
            max="100"
            value={split}
            onChange={(event) => setSplit(Number(event.target.value))}
          />
        )}
      </div>
    </section>
  );
}
