import { useEffect, useState } from "react";
import { CornerDownRight, ImageOff, Sparkles, Star } from "lucide-react";
import { useStudio } from "../../app/store";
import { EmptyState, LoadingState } from "../../components/common/states";
import { call, type VersionDTO } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { formatRelativeTime } from "../../lib/format";
import { PURPOSE_LABELS } from "../generate/labels";
import { buildVersionTree } from "./tree";

/** Version lineage: imports are roots, generated outputs hang under their parent's version. */
export function VersionsTab() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const masterId = useStudio((s) => s.workspace!.project.activeMasterAssetId);
  const assets = useStudio((s) => s.workspace!.assets);
  const generations = useStudio((s) => s.workspace!.generations);
  const selectedId = useStudio((s) => s.selectedAssetId);
  const selectAsset = useStudio((s) => s.selectAsset);
  const revision = useStudio((s) => s.dataRevision);
  const [loaded, setLoaded] = useState<{ key: string; versions?: VersionDTO[]; error?: string }>();
  const key = `${projectId}|${revision}`;

  useEffect(() => {
    let alive = true;
    call("version_list", { projectId }).then(
      (versions) => alive && setLoaded({ key, versions }),
      (e: Error) => alive && setLoaded({ key, error: e.message }),
    );
    return () => {
      alive = false;
    };
  }, [projectId, key]);

  if (loaded?.error)
    return (
      <div className="state">
        <p>{loaded.error}</p>
      </div>
    );
  if (!loaded?.versions) return <LoadingState />;
  if (!loaded.versions.length)
    return (
      <EmptyState title="No versions yet">
        Each imported image starts a lineage; generated images branch from it.
      </EmptyState>
    );

  const nodes = buildVersionTree(loaded.versions);
  return (
    <ul className="version-tree" aria-label="Version lineage">
      {nodes.map(({ version: v, depth, childCount }) => {
        const asset = assets.find((a) => a.id === v.assetId);
        const gen = v.generationId ? generations.find((g) => g.id === v.generationId) : undefined;
        const thumb = asset?.status === "ready" ? fileUrl(asset.thumbnailPath) : null;
        return (
          <li key={v.id} style={{ paddingLeft: 8 + depth * 22 }}>
            <button
              className="version-row"
              aria-pressed={v.assetId === selectedId}
              disabled={!asset}
              onClick={() => selectAsset(v.assetId)}
              title={asset ? "Show in canvas" : "This asset was removed"}
            >
              {depth > 0 && <CornerDownRight size={13} className="version-branch" />}
              <span className="version-thumb">
                {thumb ? <img src={thumb} alt="" loading="lazy" /> : <ImageOff size={12} />}
              </span>
              <span className="version-name">
                {asset?.originalName ?? v.label ?? v.assetId}
                {v.assetId === masterId && (
                  <span className="badge badge-accent">
                    <Star size={10} /> Master
                  </span>
                )}
              </span>
              <span className={`badge ${v.generationId ? "badge-info" : "badge-neutral"}`}>
                {v.generationId && <Sparkles size={10} />}
                {v.operation}
              </span>
              {v.generationId && (
                <span className="field-hint version-gen">
                  {gen
                    ? `${PURPOSE_LABELS[gen.purpose]} · ${gen.providerId}/${gen.modelId}`
                    : `generation ${v.generationId.slice(0, 10)}…`}
                </span>
              )}
              {childCount > 0 && <span className="field-hint">{childCount} derived</span>}
              <span className="spacer" />
              <span className="field-hint">{formatRelativeTime(v.createdAt)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
