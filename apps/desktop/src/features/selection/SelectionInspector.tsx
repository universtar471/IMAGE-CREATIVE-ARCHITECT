/**
 * Selection block at the top of the inspector (UX V6.1, ADR-044): breadcrumb, a small
 * thumbnail (click or double-click opens the large viewer), the media kind, role, state and
 * lineage of what is selected. It only reads; the module panel below keeps its own form, so
 * changing the selection never resets a draft. The centre keeps the one main preview.
 */
import { ChevronRight, Maximize2, Play } from "lucide-react";
import { formatClipDuration, formatDimensions } from "../../lib/format";
import { fileUrl } from "../../lib/files";
import { useStudio } from "../../app/store";
import { RoleBadge } from "../../components/common/StatusBadge";
import { VideoBadge } from "../../components/common/VideoBadge";
import { useLocale, useT } from "../../i18n";
import { GenerationStatusBadge } from "../generate/GenerationStatusBadge";
import { presetLabels } from "../presets/labels";
import type { AssetDTO } from "@arch/domain";
import type { Selection } from "./selection";
import { useSelection } from "./useSelection";
import { viewerSetFor } from "./viewerSet";

function openLarge(assetId: string) {
  const s = useStudio.getState();
  const ws = s.workspace;
  if (!ws) return;
  const assetIds = viewerSetFor(assetId, ws.assets, ws.generations);
  s.openViewer({ assetIds, index: Math.max(0, assetIds.indexOf(assetId)), compareWithId: null });
}

function focusAsset(assetId: string) {
  const s = useStudio.getState();
  s.selectAsset(assetId, { keepView: true });
  if (s.workspaceMode === "node") s.setCanvasSelection([`asset:${assetId}`]);
}

function Thumb({ asset, label }: { asset: AssetDTO; label: string }) {
  const src = fileUrl(asset.thumbnailPath ?? asset.absolutePath);
  const video = asset.mediaKind === "video" || (asset.mimeType ?? "").startsWith("video/");
  return (
    <button
      type="button"
      className="inspector-thumb"
      onClick={() => openLarge(asset.id)}
      onDoubleClick={() => openLarge(asset.id)}
      title={label}
      aria-label={label}
      data-testid="inspector-thumb"
    >
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
      {video && <VideoBadge durationMs={asset.durationMs} />}
      <span className="inspector-thumb-expand" aria-hidden="true">
        {video ? <Play size={14} /> : <Maximize2 size={14} />}
      </span>
    </button>
  );
}

const KIND_KEY = {
  image: "inspector.kind.image",
  video: "inspector.kind.video",
  reference: "inspector.kind.reference",
  generation: "inspector.kind.generation",
  draft: "inspector.kind.draft",
  multi: "inspector.kind.multi",
} as const;

export function SelectionInspector() {
  const selection = useSelection();
  if (selection.kind === "none") return null;
  return <SelectionDetails selection={selection} />;
}

function SelectionDetails({ selection }: { selection: Exclude<Selection, { kind: "none" }> }) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const ws = useStudio((s) => s.workspace!);
  const assetById = (id: string | null | undefined) =>
    id ? (ws.assets.find((a) => a.id === id) ?? null) : null;

  const title =
    selection.kind === "image" || selection.kind === "video" || selection.kind === "reference"
      ? (selection.asset.originalName ?? selection.asset.id)
      : selection.kind === "generation"
        ? t(`labels.purpose.${selection.generation.purpose}`)
        : selection.kind === "draft"
          ? t("branches.draft")
          : t("inspector.items", { count: selection.items.length });

  return (
    <section
      className="selection-inspector"
      aria-label={t("inspector.label")}
      data-testid="selection-inspector"
      data-kind={selection.kind}
    >
      <nav className="inspector-crumbs" aria-label={t("inspector.breadcrumb")}>
        <span>{ws.project.name}</span>
        <ChevronRight size={12} aria-hidden="true" />
        <span>{t(KIND_KEY[selection.kind])}</span>
        <ChevronRight size={12} aria-hidden="true" />
        <strong title={title}>{title}</strong>
      </nav>

      {(selection.kind === "image" ||
        selection.kind === "video" ||
        selection.kind === "reference") && (
        <div className="inspector-row">
          <Thumb
            asset={selection.asset}
            label={
              selection.kind === "video" ? t("selectionActions.play") : t("selectionActions.expand")
            }
          />
          <dl className="inspector-meta">
            <dt>{t("inspector.role")}</dt>
            <dd>
              <RoleBadge role={selection.asset.role} short />
            </dd>
            {selection.kind === "video" ? (
              <>
                <dt>{t("inspector.duration")}</dt>
                <dd>{formatClipDuration(selection.asset.durationMs) ?? "—"}</dd>
              </>
            ) : (
              <>
                <dt>{t("inspector.size")}</dt>
                <dd>{formatDimensions(selection.asset.widthPx, selection.asset.heightPx)}</dd>
              </>
            )}
            {selection.kind === "reference" && (
              <>
                <dt>{t("inspector.inDraft")}</dt>
                <dd>{selection.inDraft ? t("inspector.yes") : t("inspector.no")}</dd>
              </>
            )}
            {selection.asset.parentAssetId && assetById(selection.asset.parentAssetId) && (
              <>
                <dt>{t("inspector.parent")}</dt>
                <dd>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => focusAsset(selection.asset.parentAssetId!)}
                  >
                    {assetById(selection.asset.parentAssetId)!.originalName ??
                      selection.asset.parentAssetId}
                  </button>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {selection.kind === "generation" && (
        <div className="inspector-generation">
          <div className="inspector-row">
            {assetById(selection.generation.parentAssetId) && (
              <Thumb
                asset={assetById(selection.generation.parentAssetId)!}
                label={t("inspector.source")}
              />
            )}
            <dl className="inspector-meta">
              <dt>{t("inspector.status")}</dt>
              <dd>
                <GenerationStatusBadge status={selection.generation.status} />
              </dd>
              <dt>{t("inspector.model")}</dt>
              <dd>{selection.generation.modelId}</dd>
            </dl>
          </div>
          {selection.phase === "pending" && (
            <p className="field-hint">{t("branches.noResultYet")}</p>
          )}
          {selection.generation.error && (
            <p className="field-hint inspector-error">{selection.generation.error.message}</p>
          )}
          {selection.generation.outputAssetIds.length > 0 && (
            <div className="inspector-outputs" aria-label={t("inspector.outputs")}>
              {selection.generation.outputAssetIds.map((id) => {
                const output = assetById(id);
                if (!output) return null;
                const src = fileUrl(output.thumbnailPath ?? output.absolutePath);
                return (
                  <button
                    key={id}
                    type="button"
                    className="inspector-output"
                    onClick={() => focusAsset(id)}
                    onDoubleClick={() => openLarge(id)}
                    title={output.originalName ?? id}
                  >
                    {src ? <img src={src} alt={output.originalName ?? id} loading="lazy" /> : id}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selection.kind === "draft" && (
        <div className="inspector-row">
          {assetById(selection.sourceAssetId) && (
            <Thumb asset={assetById(selection.sourceAssetId)!} label={t("inspector.source")} />
          )}
          <div>
            <p className="field-hint">{t("inspector.draftHint")}</p>
            <div className="branch-chips">
              {presetLabels(selection.presetIds, locale).map((label) => (
                <span className="branch-chip" key={label}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {selection.kind === "multi" && (
        <div className="inspector-outputs">
          {selection.items.slice(0, 8).map((item) => {
            const a =
              item.kind === "image" || item.kind === "video" || item.kind === "reference"
                ? item.asset
                : null;
            if (!a) return null;
            const src = fileUrl(a.thumbnailPath ?? a.absolutePath);
            return (
              <button
                key={a.id}
                type="button"
                className="inspector-output"
                onClick={() => focusAsset(a.id)}
                title={a.originalName ?? a.id}
              >
                {src ? <img src={src} alt={a.originalName ?? a.id} loading="lazy" /> : a.id}
                {item.kind === "video" && <VideoBadge durationMs={a.durationMs} />}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
