import { SheetResult } from "../sheets/SheetPanel";
import { useSheetDraft } from "../sheets/store";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, Eye, Loader2, Lock, LockOpen } from "lucide-react";
import type { AssetDTO, CaptionPageSlot, PageSlot, Publication, TextSlot } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { Dialog } from "../../components/common/Dialog";
import { useT } from "../../i18n";
import { PageView } from "./PageView";
import { renderPage } from "./exporter";
import {
  approveCaption,
  issuePageIndex,
  publicationIssues,
  publishableAssets,
  replaceImage,
  setCaptionText,
  setSentenceFact,
  setText,
  setTextFact,
  swapImages,
  toPublicationAsset,
  type SlotRef,
} from "./publishing";
import { usePublishing } from "./store";

/** Center view of the Publishing Studio (SRS §13.3): page strip, page editor, preview. */
export function LocalPublishingStudio() {
  const t = useT();
  const projectId = useStudio((s) => s.workspace!.project.id);
  const projectName = useStudio((s) => s.workspace!.project.name);
  const assets = useStudio((s) => s.workspace!.assets);
  const readOnly = useStudio(selectReadOnly);
  const open = usePublishing((s) => s.open);
  const publication = usePublishing((s) => s.publication);
  const facts = usePublishing((s) => s.facts);
  const accepted = usePublishing((s) => s.acceptedWarnings);
  const selectedPageId = usePublishing((s) => s.selectedPageId);
  const selectedSlotId = usePublishing((s) => s.selectedSlotId);
  const select = usePublishing((s) => s.select);
  const update = usePublishing((s) => s.update);
  const toggleLock = usePublishing((s) => s.toggleLock);
  const [preview, setPreview] = useState(false);

  useEffect(() => open(projectId, assets, projectName), [open, projectId, assets, projectName]);

  const validation = useMemo(
    () => (publication ? publicationIssues(publication, assets, facts, accepted) : null),
    [publication, assets, facts, accepted],
  );

  if (!publication) {
    return (
      <div className="pub-empty" data-testid="publishing-empty">
        <BookOpen size={28} />
        <h3>{t("publishing.emptyTitle")}</h3>
        <p className="field-hint">{t("publishing.emptyHint")}</p>
      </div>
    );
  }

  const page =
    publication.pages.find((item) => item.id === selectedPageId) ?? publication.pages[0]!;
  const pageNumber = publication.pages.indexOf(page) + 1;
  const locked = publication.lockedPageIds.includes(page.id);
  const slot = page.slots.find((item) => item.id === selectedSlotId) ?? null;
  const issueCount = (index: number) =>
    validation?.issues.filter((issue) => issuePageIndex(issue) === index).length ?? 0;
  const editable = !readOnly && !locked;

  return (
    <div className="pub-studio" data-testid="publishing-studio">
      <div className="pub-toolbar">
        <strong>{t("publishing.pageN", { number: pageNumber })}</strong>
        <span className="badge badge-neutral">{t(`publishing.pageKinds.${page.kind}`)}</span>
        {page.layoutTemplateId && (
          <span className="field-hint">{t(`publishing.layouts.${page.layoutTemplateId}`)}</span>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-sm"
          aria-pressed={locked}
          disabled={readOnly}
          onClick={() => toggleLock(page.id)}
          data-testid="pub-lock"
        >
          {locked ? <Lock size={13} /> : <LockOpen size={13} />}
          {locked ? t("publishing.unlock") : t("publishing.lock")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setPreview(true)}
          data-testid="pub-preview"
        >
          <Eye size={13} /> {t("publishing.preview")}
        </button>
      </div>
      <div className="pub-editor">
        <div className="pub-canvas">
          <PageView
            publication={publication}
            page={page}
            assets={assets}
            selectedSlotId={selectedSlotId}
            onSelectSlot={(slotId) => select(page.id, slotId)}
            onSwap={editable ? (from, to) => update(swapImages(publication, from, to)) : undefined}
          />
        </div>
        <aside className="pub-inspector" aria-label={t("publishing.editor")}>
          {locked && <p className="callout callout-warning">{t("publishing.lockedHint")}</p>}
          {!slot ? (
            <p className="field-hint">{t("publishing.selectSlot")}</p>
          ) : (
            <SlotInspector
              key={`${page.id}:${slot.id}`}
              publication={publication}
              slotRef={{ pageId: page.id, slotId: slot.id }}
              slot={slot}
              assets={assets}
              disabled={!editable}
            />
          )}
          {page.warnings.includes("dense_page_suggest_a3_or_digital") && (
            <p className="callout callout-warning">{t("publishing.densePage")}</p>
          )}
        </aside>
      </div>
      <div className="pub-strip" role="list" aria-label={t("publishing.pagesLabel")}>
        {publication.pages.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="listitem"
            className={`pub-thumb ${item.id === page.id ? "is-active" : ""}`}
            onClick={() => select(item.id)}
            aria-current={item.id === page.id ? "page" : undefined}
            data-testid={`pub-thumb-${index + 1}`}
          >
            <PageView publication={publication} page={item} assets={assets} thumbnail />
            <span className="pub-thumb-label">
              {index + 1}
              {publication.lockedPageIds.includes(item.id) && <Lock size={10} />}
              {issueCount(index) > 0 && (
                <span className="badge badge-warning">{issueCount(index)}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {preview && (
        <ExportPreview
          publication={publication}
          pageIndex={pageNumber - 1}
          assets={assets}
          projectId={projectId}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}

function SlotInspector({
  publication,
  slotRef,
  slot,
  assets,
  disabled,
}: {
  publication: Publication;
  slotRef: SlotRef;
  slot: PageSlot;
  assets: readonly AssetDTO[];
  disabled: boolean;
}) {
  const t = useT();
  const update = usePublishing((s) => s.update);
  const facts = usePublishing((s) => s.facts);
  const confirmed = facts.filter((f) => f.status === "verified" || f.status === "user_declared");
  const factText = (id: string | null) => facts.find((f) => f.id === id)?.text ?? id ?? "";

  if (slot.type === "image") {
    const choices = publishableAssets(assets);
    return (
      <div className="pub-inspector-body">
        <strong>{t("publishing.imageSlot")}</strong>
        <label className="field">
          <span className="field-label">{t("publishing.replaceWith")}</span>
          <select
            className="select"
            value={slot.assetId}
            disabled={disabled}
            onChange={(event) => {
              const asset = choices.find((item) => item.id === event.target.value);
              if (asset) update(replaceImage(publication, slotRef, toPublicationAsset(asset)));
            }}
            data-testid="pub-replace"
          >
            {!choices.some((item) => item.id === slot.assetId) && (
              <option value={slot.assetId}>{slot.label ?? slot.assetId}</option>
            )}
            {choices.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.originalName ?? asset.id}
              </option>
            ))}
          </select>
          <span className="field-hint">{t("publishing.swapHint")}</span>
        </label>
      </div>
    );
  }

  if (slot.type === "text") return <TextInspector {...{ publication, slotRef, slot, disabled }} />;

  return (
    <CaptionInspector
      key={slot.caption.sentences.map((s) => s.text).join(" ")}
      publication={publication}
      slotRef={slotRef}
      slot={slot}
      disabled={disabled}
      confirmed={confirmed}
      factText={factText}
    />
  );
}

function TextInspector({
  publication,
  slotRef,
  slot,
  disabled,
}: {
  publication: Publication;
  slotRef: SlotRef;
  slot: TextSlot;
  disabled: boolean;
}) {
  const t = useT();
  const update = usePublishing((s) => s.update);
  const facts = usePublishing((s) => s.facts);
  return (
    <div className="pub-inspector-body">
      <strong>
        {t("publishing.textSlot")} · {t(`publishing.roles.${slot.role}`)}
      </strong>
      <textarea
        className="textarea"
        rows={4}
        value={slot.text}
        disabled={disabled}
        placeholder={t("publishing.textPlaceholder")}
        onChange={(event) => update(setText(publication, slotRef, event.target.value))}
        data-testid="pub-text"
      />
      <label className="field">
        <span className="field-label">{t("publishing.linkFact")}</span>
        <select
          className="select"
          value={slot.factRef ?? ""}
          disabled={disabled}
          onChange={(event) =>
            update(setTextFact(publication, slotRef, event.target.value || null))
          }
        >
          <option value="">{t("publishing.noFact")}</option>
          {facts.map((fact) => (
            <option key={fact.id} value={fact.id}>
              {fact.text}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function CaptionInspector({
  publication,
  slotRef,
  slot,
  disabled,
  confirmed,
  factText,
}: {
  publication: Publication;
  slotRef: SlotRef;
  slot: CaptionPageSlot;
  disabled: boolean;
  confirmed: { id: string; text: string }[];
  factText: (id: string | null) => string;
}) {
  const t = useT();
  const update = usePublishing((s) => s.update);
  const facts = usePublishing((s) => s.facts);
  const joined = slot.caption.sentences.map((s) => s.text).join(" ");
  // Local draft so typing a sentence end does not re-split mid-word; applied on blur. The
  // parent keys this component by the stored text, so an outside change (AI) resets it.
  const [draft, setDraft] = useState(joined);
  const commit = () => {
    if (draft !== joined) update(setCaptionText(publication, slotRef, draft, facts));
  };
  const words = draft.trim() ? draft.trim().split(/\s+/).length : 0;
  return (
    <div className="pub-inspector-body">
      <strong>
        {t("publishing.captionSlot")} · {t(`publishing.textKinds.${slot.caption.textKind}`)}
        {slot.caption.group && ` · ${t(`publishing.groups.${slot.caption.group}`)}`}
      </strong>
      <textarea
        className="textarea"
        rows={4}
        value={draft}
        disabled={disabled}
        placeholder={t("publishing.captionPlaceholder")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        data-testid="pub-caption"
      />
      <span
        className={`field-hint ${slot.caption.wordLimit && words > slot.caption.wordLimit ? "field-error" : ""}`}
      >
        {t("publishing.wordCount", { count: words, limit: slot.caption.wordLimit ?? "—" })}
      </span>
      <ol className="pub-sentences">
        {slot.caption.sentences.map((sentence, index) => (
          <li key={index} data-testid={`pub-sentence-${index}`}>
            <span>{sentence.text}</span>
            <span className="pub-sentence-meta">
              {sentence.factRef ? (
                <span className="badge badge-success" data-testid="pub-fact-badge">
                  {t("publishing.factBadge", { fact: factText(sentence.factRef) })}
                </span>
              ) : sentence.needs_review ? (
                <span className="badge badge-warning" data-testid="pub-review-badge">
                  {t("publishing.needsReview")}
                </span>
              ) : null}
              <select
                className="select"
                aria-label={t("publishing.linkFactN", { number: index + 1 })}
                value={sentence.factRef ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  update(
                    setSentenceFact(publication, slotRef, index, event.target.value || null, facts),
                  )
                }
              >
                <option value="">{t("publishing.noFact")}</option>
                {confirmed.map((fact) => (
                  <option key={fact.id} value={fact.id}>
                    {fact.text}
                  </option>
                ))}
              </select>
            </span>
          </li>
        ))}
      </ol>
      {slot.caption.needs_review && (
        <button
          type="button"
          className="btn btn-sm"
          disabled={disabled}
          onClick={() => update(approveCaption(publication, slotRef, facts))}
          data-testid="pub-approve"
        >
          <Check size={13} /> {t("publishing.approve")}
        </button>
      )}
      <span className="field-hint">{t("publishing.approveHint")}</span>
    </div>
  );
}

/** The real export renderer on the current page, at half resolution. */
function ExportPreview({
  publication,
  pageIndex,
  assets,
  projectId,
  onClose,
}: {
  publication: Publication;
  pageIndex: number;
  assets: readonly AssetDTO[];
  projectId: string;
  onClose: () => void;
}) {
  const t = useT();
  const [state, setState] = useState<
    | { status: "rendering" }
    | { status: "ready"; url: string }
    | { status: "error"; message: string }
  >({ status: "rendering" });
  useEffect(() => {
    let cancelled = false;
    renderPage(publication, publication.pages[pageIndex]!, assets, projectId, 0.5)
      .then((canvas) => {
        if (!cancelled) setState({ status: "ready", url: canvas.toDataURL("image/jpeg", 0.85) });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [publication, pageIndex, assets, projectId]);
  return (
    <Dialog title={t("publishing.previewTitle", { number: pageIndex + 1 })} onClose={onClose}>
      {state.status === "rendering" && (
        <p className="field-hint">
          <Loader2 size={13} className="spin" /> {t("publishing.rendering")}
        </p>
      )}
      {state.status === "error" && (
        <p className="callout callout-error">
          {t("publishing.previewFailed", { message: state.message })}
        </p>
      )}
      {state.status === "ready" && (
        <img className="pub-preview-image" src={state.url} alt={t("publishing.preview")} />
      )}
    </Dialog>
  );
}

export function PublishingStudio() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const draft = useSheetDraft(projectId, "publishing");
  return draft.mode === "ai" ? <SheetResult kind="publishing" /> : <LocalPublishingStudio />;
}
