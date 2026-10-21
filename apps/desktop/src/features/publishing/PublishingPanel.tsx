import { ImageModelPicker, useImageModelChoice } from "../../components/panels/ImageModelPicker";
import { SheetModeTabs, SheetPanel } from "../sheets/SheetPanel";
import { useSheetDraft } from "../sheets/store";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Dice5,
  FileDown,
  FilePlus2,
  Loader2,
  Plus,
  Save,
  Shuffle,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  buildCaptionPrompt,
  PAPER_SIZES,
  PUBLICATION_STYLES,
  PUBLICATION_TYPES,
  SELECTION_MODES,
  TEXT_DENSITIES,
  type ConflictIssue,
  type RandomizeLevel,
} from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { SectionPanel } from "../../components/panels/SectionPanel";
import { Dialog } from "../../components/common/Dialog";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { call, toBridgeError, type PublicationExportFormat } from "../../lib/bridge";
import { fileUrl } from "../../lib/files";
import { useT, type TKey } from "../../i18n";
import { ENHANCE_PROVIDER_ID } from "../generate/extraPrompt";
import { exportPublication } from "./exporter";
import {
  MAX_PAGE_COUNT,
  applyAiCaptions,
  exportGate,
  issuePageIndex,
  issueSlotId,
  newSeed,
  planBlocker,
  publicationIssues,
  publishableAssets,
  settingsForStyle,
  settingsForType,
} from "./publishing";
import { usePublishing } from "./store";

/** Text-capable provider for the optional caption call (the HHTECH chat gateway). */
export const CAPTION_PROVIDER_ID = ENHANCE_PROVIDER_ID;

/** Right panel of the Publishing Studio (SRS §13.3). */
export function LocalPublishingPanel() {
  const imageChoice = useImageModelChoice();
  const projectId = useStudio((s) => s.workspace!.project.id);
  const projectName = useStudio((s) => s.workspace!.project.name);
  const assets = useStudio((s) => s.workspace!.assets);
  const readOnly = useStudio(selectReadOnly);
  const open = usePublishing((s) => s.open);
  useEffect(() => open(projectId, assets, projectName), [open, projectId, assets, projectName]);
  const isOpen = usePublishing((s) => s.projectId === projectId);
  if (!isOpen) return null;
  return (
    <div className="pub-panel" data-testid="publishing-panel">
      <ImageModelPicker {...imageChoice} disabled={readOnly} />
      <LibrarySection readOnly={readOnly} />
      <SettingsSection readOnly={readOnly} />
      <StyleSection readOnly={readOnly} />
      <RandomSection readOnly={readOnly} />
      <FactsSection readOnly={readOnly} />
      <CaptionSection readOnly={readOnly} />
      <CheckSection />
      <ExportSection />
    </div>
  );
}

function errorText(error: unknown) {
  return toBridgeError(error).message;
}

function LibrarySection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const assets = useStudio((s) => s.workspace!.assets);
  const projectName = useStudio((s) => s.workspace!.project.name);
  const notify = useStudio((s) => s.notify);
  const records = usePublishing((s) => s.records);
  const recordId = usePublishing((s) => s.recordId);
  const dirty = usePublishing((s) => s.dirty);
  const busy = usePublishing((s) => s.busy);
  const publication = usePublishing((s) => s.publication);
  const { saveRecord, openRecord, deleteRecord, newBook } = usePublishing.getState();
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const run = async (action: () => Promise<void>, failKey: TKey) => {
    try {
      await action();
    } catch (error) {
      notify("error", errorText(error), t(failKey));
    }
  };
  return (
    <SectionPanel
      title={t("publishing.library")}
      aside={
        publication && (
          <span className={`badge ${dirty ? "badge-warning" : "badge-success"}`}>
            {dirty ? t("publishing.unsaved") : t("publishing.saved")}
          </span>
        )
      }
    >
      <div className="btn-row">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={readOnly || !publication || busy}
          onClick={() => void run(saveRecord, "publishing.saveFailed")}
          data-testid="pub-save"
        >
          {busy ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
          {t("publishing.save")}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => newBook(assets, projectName)}
        >
          <FilePlus2 size={13} /> {t("publishing.newBook")}
        </button>
      </div>
      {records.length === 0 ? (
        <p className="field-hint">{t("publishing.noRecords")}</p>
      ) : (
        <ul className="pub-records">
          {records.map((record) => (
            <li key={record.id} className={record.id === recordId ? "is-active" : ""}>
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() => void run(() => openRecord(record.id), "publishing.openFailed")}
              >
                {record.title || t("publishing.untitled")}
              </button>
              <span className="field-hint">
                {t("publishing.recordMeta", {
                  type: t(`publishing.types.${record.type}`),
                  paper: t(`publishing.papers.${record.paper}`),
                  pages: record.targetPageCount,
                })}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={t("publishing.deleteBook")}
                disabled={readOnly || busy}
                onClick={() => setConfirmDelete({ id: record.id, title: record.title })}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirmDelete && (
        <Dialog
          title={t("publishing.deleteBook")}
          size="sm"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)} autoFocus>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-danger"
                onClick={() => {
                  const id = confirmDelete.id;
                  setConfirmDelete(null);
                  void run(() => deleteRecord(id), "publishing.deleteFailed");
                }}
              >
                {t("publishing.deleteBook")}
              </button>
            </>
          }
        >
          <p>
            {t("publishing.deleteConfirm", {
              title: confirmDelete.title || t("publishing.untitled"),
            })}
          </p>
        </Dialog>
      )}
    </SectionPanel>
  );
}

function SettingsSection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const assets = useStudio((s) => s.workspace!.assets);
  const settings = usePublishing((s) => s.settings);
  const publication = usePublishing((s) => s.publication);
  const planStale = usePublishing((s) => s.planStale);
  const setSettings = usePublishing((s) => s.setSettings);
  const plan = usePublishing((s) => s.plan);
  const usable = publishableAssets(assets);
  const selected = new Set(settings.selectedImageIds);
  const count = usable.filter((asset) => selected.has(asset.id)).length;
  const blocker = planBlocker(settings, assets);
  const lockedPages = publication?.lockedPageIds.length ?? 0;
  const toggle = (id: string) =>
    setSettings({
      selectedImageIds: selected.has(id)
        ? settings.selectedImageIds.filter((item) => item !== id)
        : [...settings.selectedImageIds, id],
    });
  const disabled = readOnly;

  return (
    <SectionPanel title={t("publishing.settings")}>
      <div className="field">
        <span className="field-label">{t("publishing.type")}</span>
        <div className="segmented pub-segmented" role="group" aria-label={t("publishing.type")}>
          {PUBLICATION_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={settings.type === type}
              disabled={disabled}
              onClick={() => setSettings(settingsForType(settings, type))}
              data-testid={`pub-type-${type}`}
            >
              {t(`publishing.types.${type}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          {t("publishing.images")}{" "}
          <span className="field-hint">
            {t("publishing.imagesCount", { count, total: usable.length })}
          </span>
        </span>
        {usable.length === 0 ? (
          <p className="callout callout-warning">{t("publishing.noPublishable")}</p>
        ) : (
          <>
            <div className="pub-image-grid">
              {usable.map((asset) => (
                <label
                  key={asset.id}
                  className={`pub-image-pick ${selected.has(asset.id) ? "is-selected" : ""}`}
                  title={asset.originalName ?? asset.id}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(asset.id)}
                    disabled={disabled}
                    onChange={() => toggle(asset.id)}
                    aria-label={asset.originalName ?? asset.id}
                  />
                  {fileUrl(asset.thumbnailPath) && (
                    <img src={fileUrl(asset.thumbnailPath)!} alt="" draggable={false} />
                  )}
                </label>
              ))}
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => setSettings({ selectedImageIds: usable.map((asset) => asset.id) })}
              >
                {t("publishing.selectAll")}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={disabled}
                onClick={() => setSettings({ selectedImageIds: [] })}
              >
                {t("publishing.selectNone")}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="field">
        <span className="field-label">{t("publishing.policy")}</span>
        <div className="segmented" role="group" aria-label={t("publishing.policy")}>
          {SELECTION_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={settings.selectionMode === mode}
              disabled={disabled}
              onClick={() => setSettings({ selectionMode: mode })}
            >
              {t(`publishing.policies.${mode}`, { count })}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <label className="field">
          <span className="field-label">{t("publishing.pages")}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={MAX_PAGE_COUNT}
            step={1}
            value={settings.targetPageCount}
            disabled={disabled}
            onChange={(event) => setSettings({ targetPageCount: Number(event.target.value) })}
            data-testid="pub-page-count"
          />
        </label>
        <label className="field">
          <span className="field-label">{t("publishing.paper")}</span>
          <select
            className="select"
            value={settings.paper}
            disabled={disabled}
            onChange={(event) =>
              setSettings({ paper: event.target.value as (typeof PAPER_SIZES)[number] })
            }
            data-testid="pub-paper"
          >
            {PAPER_SIZES.map((paper) => (
              <option key={paper} value={paper}>
                {t(`publishing.papers.${paper}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span className="field-label">{t("publishing.density")}</span>
          <select
            className="select"
            value={settings.textDensity}
            disabled={disabled}
            onChange={(event) =>
              setSettings({ textDensity: event.target.value as (typeof TEXT_DENSITIES)[number] })
            }
          >
            {TEXT_DENSITIES.map((density) => (
              <option key={density} value={density}>
                {t(`publishing.densities.${density}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t("publishing.bookTitle")}</span>
          <input
            className="input"
            value={settings.title}
            disabled={disabled}
            placeholder={t("publishing.titlePlaceholder")}
            onChange={(event) => setSettings({ title: event.target.value })}
          />
        </label>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.allowImageRepeat}
          disabled={disabled}
          onChange={(event) => setSettings({ allowImageRepeat: event.target.checked })}
        />
        {t("publishing.allowRepeat")}
      </label>

      {planStale && <p className="callout callout-warning">{t("publishing.planStale")}</p>}
      <span title={blocker ? t(blocker, { max: MAX_PAGE_COUNT }) : undefined}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || blocker !== null || lockedPages > 0}
          onClick={() => plan(assets)}
          data-testid="pub-plan"
        >
          <Sparkles size={14} /> {publication ? t("publishing.replan") : t("publishing.plan")}
        </button>
      </span>
      {blocker && <span className="field-hint">{t(blocker, { max: MAX_PAGE_COUNT })}</span>}
      {lockedPages > 0 && <span className="field-hint">{t("publishing.replanLocked")}</span>}
    </SectionPanel>
  );
}

function StyleSection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const settings = usePublishing((s) => s.settings);
  const publication = usePublishing((s) => s.publication);
  const setSettings = usePublishing((s) => s.setSettings);
  const update = usePublishing((s) => s.update);
  const pick = (styleId: string) => {
    const next = settingsForStyle(settings, styleId);
    // Same type: restyle the planned book at once (content and layout stay). Another type
    // needs a re-plan, which stays the user's choice.
    if (publication && next.type === publication.type) {
      setSettings({ styleId: next.styleId });
      usePublishing.setState({ planStale: false });
      update({ ...publication, styleId: next.styleId });
    } else {
      setSettings(next);
    }
  };
  return (
    <SectionPanel title={t("publishing.styles")}>
      {PUBLICATION_TYPES.map((type) => (
        <div key={type} className="pub-style-group">
          <span className="field-label">
            {t("publishing.styleOfType", { type: t(`publishing.types.${type}`) })}
          </span>
          <div className="pub-style-grid">
            {PUBLICATION_STYLES.filter((style) => style.type === type).map((style) => (
              <button
                key={style.id}
                type="button"
                className="pub-style-card"
                aria-pressed={settings.styleId === style.id}
                disabled={readOnly}
                onClick={() => pick(style.id)}
                data-testid={`pub-style-${style.id}`}
              >
                <span className="pub-swatches" aria-hidden="true">
                  {Object.values(style.palette).map((color, index) => (
                    <span key={index} style={{ background: color }} />
                  ))}
                </span>
                <span>{t(`publishing.styleNames.${style.id}` as TKey)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </SectionPanel>
  );
}

const LEVELS: { level: RandomizeLevel; key: TKey }[] = [
  { level: "style", key: "publishing.randomStyle" },
  { level: "layout", key: "publishing.randomLayout" },
  { level: "smart", key: "publishing.randomSmart" },
];

function RandomSection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const publication = usePublishing((s) => s.publication);
  const seed = usePublishing((s) => s.settings.seed);
  const setSettings = usePublishing((s) => s.setSettings);
  const randomize = usePublishing((s) => s.randomize);
  const [seedText, setSeedText] = useState(String(seed));
  const [shownSeed, setShownSeed] = useState(seed);
  if (shownSeed !== seed) {
    // Keep the field in step when the seed changes elsewhere (reopening a book).
    setShownSeed(seed);
    setSeedText(String(seed));
  }
  const parsed = Number(seedText);
  const valid = Number.isInteger(parsed) && seedText.trim() !== "";
  const disabled = readOnly || !publication || !valid;
  return (
    <SectionPanel title={t("publishing.random")}>
      <div className="pub-seed-row">
        <label className="field">
          <span className="field-label">{t("publishing.seed")}</span>
          <input
            className="input"
            inputMode="numeric"
            value={seedText}
            disabled={readOnly}
            onChange={(event) => setSeedText(event.target.value)}
            onBlur={() => valid && setSettings({ seed: parsed })}
            data-testid="pub-seed"
          />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          disabled={readOnly}
          onClick={() => setSeedText(String(newSeed()))}
          aria-label={t("publishing.newSeed")}
          title={t("publishing.newSeed")}
        >
          <Dice5 size={14} />
        </button>
      </div>
      <div className="btn-row">
        {LEVELS.map(({ level, key }) => (
          <button
            key={level}
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => randomize(level, parsed)}
            data-testid={`pub-random-${level}`}
          >
            <Shuffle size={13} /> {t(key)}
          </button>
        ))}
      </div>
      <span className="field-hint">{t("publishing.randomHint")}</span>
    </SectionPanel>
  );
}

function FactsSection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const facts = usePublishing((s) => s.facts);
  const addFact = usePublishing((s) => s.addFact);
  const removeFact = usePublishing((s) => s.removeFact);
  const [text, setText] = useState("");
  const add = () => {
    addFact(text);
    setText("");
  };
  return (
    <SectionPanel title={t("publishing.facts")} defaultOpen={false}>
      <span className="field-hint">{t("publishing.factsHint")}</span>
      {facts.length === 0 ? (
        <p className="field-hint">{t("publishing.noFacts")}</p>
      ) : (
        <ul className="pub-facts">
          {facts.map((fact) => (
            <li key={fact.id}>
              <span>{fact.text}</span>
              <span className="badge badge-success">{t("publishing.declared")}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-icon"
                aria-label={t("publishing.removeFact")}
                disabled={readOnly}
                onClick={() => removeFact(fact.id)}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pub-seed-row">
        <input
          className="input"
          value={text}
          disabled={readOnly}
          placeholder={t("publishing.factPlaceholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && add()}
          data-testid="pub-fact-input"
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={readOnly || !text.trim()}
          onClick={add}
          data-testid="pub-fact-add"
        >
          <Plus size={13} /> {t("publishing.addFact")}
        </button>
      </div>
    </SectionPanel>
  );
}

/** Optional paid caption call; hidden unless a text-capable provider is configured. */
function CaptionSection({ readOnly }: { readOnly: boolean }) {
  const t = useT();
  const projectId = useStudio((s) => s.workspace!.project.id);
  const provider = useStudio((s) => s.providers?.find((p) => p.id === CAPTION_PROVIDER_ID));
  const notify = useStudio((s) => s.notify);
  const publication = usePublishing((s) => s.publication);
  const facts = usePublishing((s) => s.facts);
  const update = usePublishing((s) => s.update);
  const spend = useSpendConfirm();
  const [running, setRunning] = useState(false);
  if (!provider?.configured || !publication) return null;
  const request = buildCaptionPrompt(publication, facts);
  const run = async () => {
    if (request.slots.length === 0) {
      notify("info", t("publishing.aiNoSlots"));
      return;
    }
    const ok = await spend.request({
      providerId: provider.id,
      provider: provider.label,
      model: t("publishing.aiModel"),
      imageCount: 0,
      costText: t("publishing.aiCost"),
      estimatedTotal: null,
    });
    if (!ok) return;
    setRunning(true);
    try {
      const { raw } = await call("publication_caption_draft", {
        projectId,
        providerId: provider.id,
        prompt: request.prompt,
      });
      const current = usePublishing.getState().publication ?? publication;
      const result = applyAiCaptions(current, raw, facts);
      if (!result) {
        notify("warning", t("publishing.aiBadAnswer"));
        return;
      }
      update(result.publication);
      notify("success", t("publishing.aiDone", { count: result.filled }));
    } catch (error) {
      notify("error", errorText(error), t("publishing.aiFailed"));
    } finally {
      setRunning(false);
    }
  };
  return (
    <SectionPanel title={t("publishing.aiTitle")} defaultOpen={false}>
      <span className="field-hint">{t("publishing.aiHint")}</span>
      <button
        type="button"
        className="btn btn-sm"
        disabled={readOnly || running}
        onClick={() => void run()}
        data-testid="pub-ai-captions"
      >
        {running ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}
        {running ? t("publishing.aiRunning") : t("publishing.aiCaptions")}
      </button>
      {spend.dialog}
    </SectionPanel>
  );
}

function useValidation() {
  const assets = useStudio((s) => s.workspace!.assets);
  const publication = usePublishing((s) => s.publication);
  const facts = usePublishing((s) => s.facts);
  const accepted = usePublishing((s) => s.acceptedWarnings);
  return useMemo(
    () => (publication ? publicationIssues(publication, assets, facts, accepted) : null),
    [publication, assets, facts, accepted],
  );
}

/** Reason text of an issue (`low_ppi`, `needs_review`, …) or the page-count numbers. */
function useIssueDetail() {
  const t = useT();
  return (issue: ConflictIssue) => {
    const params = issue.params;
    if (issue.code === "PAGE_COUNT_MISMATCH")
      return t("publishing.reasons.page_count", {
        expected: params.expected ?? "",
        actual: params.actual ?? "",
      });
    const reason = typeof params.reason === "string" ? params.reason : null;
    if (!reason) return "";
    const key = `publishing.reasons.${reason}` as TKey;
    const text = t(key, params);
    return text === key ? reason : text;
  };
}

function CheckSection() {
  const t = useT();
  const validation = useValidation();
  const publication = usePublishing((s) => s.publication);
  const select = usePublishing((s) => s.select);
  const acceptWarnings = usePublishing((s) => s.acceptWarnings);
  const detail = useIssueDetail();
  if (!publication || !validation) return null;
  const pendingWarnings = validation.issues.filter((i) => i.severity === "WARN" && !i.accepted);
  return (
    <SectionPanel
      title={t("publishing.check")}
      aside={
        <span
          className={`badge ${validation.verdict === "BLOCK" ? "badge-danger" : validation.verdict === "WARN" ? "badge-warning" : "badge-success"}`}
        >
          {validation.issues.length}
        </span>
      }
    >
      {validation.issues.length === 0 ? (
        <p className="callout callout-success" data-testid="pub-check-clean">
          {t("publishing.checkClean")}
        </p>
      ) : (
        <ul className="pub-issues" data-testid="pub-issues">
          {validation.issues.map((issue, index) => {
            const pageIndex = issuePageIndex(issue);
            return (
              <li key={`${issue.code}:${issue.path}:${index}`} data-code={issue.code}>
                <span
                  className={`badge ${issue.severity === "BLOCK" ? "badge-danger" : issue.accepted ? "badge-success" : "badge-warning"}`}
                >
                  {issue.severity === "BLOCK" ? <Ban size={11} /> : <AlertTriangle size={11} />}
                  {issue.code}
                </span>
                <span>
                  {t(issue.messageKey as TKey)} <span className="field-hint">{detail(issue)}</span>
                </span>
                {pageIndex !== null ? (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      select(
                        publication.pages[pageIndex]?.id ?? null,
                        issueSlotId(publication, issue),
                      )
                    }
                  >
                    {t("publishing.goToPage", { number: pageIndex + 1 })}
                  </button>
                ) : (
                  <span className="field-hint">{t("publishing.wholeBook")}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {pendingWarnings.length > 0 && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => acceptWarnings(pendingWarnings.map((issue) => issue.code))}
          data-testid="pub-accept-warnings"
        >
          {t("publishing.acceptWarnings")}
        </button>
      )}
    </SectionPanel>
  );
}

const FORMATS: { format: PublicationExportFormat; key: TKey }[] = [
  { format: "pdf", key: "publishing.exportPdf" },
  { format: "png", key: "publishing.exportPng" },
  { format: "jpeg", key: "publishing.exportJpeg" },
];

function ExportSection() {
  const t = useT();
  const projectId = useStudio((s) => s.workspace!.project.id);
  const assets = useStudio((s) => s.workspace!.assets);
  const notify = useStudio((s) => s.notify);
  const publication = usePublishing((s) => s.publication);
  const acceptWarnings = usePublishing((s) => s.acceptWarnings);
  const validation = useValidation();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<PublicationExportFormat | null>(null);
  if (!publication || !validation) return null;
  const gate = exportGate(validation);

  const run = async (format: PublicationExportFormat) => {
    setProgress({ done: 0, total: publication.pages.length });
    try {
      const result = await exportPublication(
        publication,
        format,
        assets,
        projectId,
        (done, total) => setProgress({ done, total }),
      );
      if (result.saved) notify("success", t("publishing.exported", { count: result.paths.length }));
      else notify("info", t("publishing.exportCancelled"));
    } catch (error) {
      notify("error", errorText(error), t("publishing.exportFailed"));
    } finally {
      setProgress(null);
    }
  };
  const start = (format: PublicationExportFormat) => {
    if (gate.status === "blocked") return;
    if (gate.status === "confirm") setConfirm(format);
    else void run(format);
  };

  return (
    <SectionPanel title={t("publishing.export")}>
      {gate.status === "blocked" && (
        <p className="callout callout-error" data-testid="pub-export-blocked">
          {t("publishing.exportBlocked", {
            codes: [...new Set(gate.issues.map((issue) => issue.code))].join(", "),
          })}
        </p>
      )}
      <div className="btn-row">
        {FORMATS.map(({ format, key }) => (
          <button
            key={format}
            type="button"
            className={`btn btn-sm ${format === "pdf" ? "btn-primary" : ""}`}
            disabled={gate.status === "blocked" || progress !== null}
            onClick={() => start(format)}
            data-testid={`pub-export-${format}`}
          >
            <FileDown size={13} /> {t(key)}
          </button>
        ))}
      </div>
      {progress && (
        <p className="field-hint" role="status">
          <Loader2 size={13} className="spin" />{" "}
          {t("publishing.exporting", { done: progress.done, total: progress.total })}
        </p>
      )}
      <span className="field-hint">{t("publishing.exportHint")}</span>
      {confirm && gate.status === "confirm" && (
        <Dialog
          title={t("publishing.confirmTitle")}
          size="sm"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)} autoFocus>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  const format = confirm;
                  setConfirm(null);
                  acceptWarnings(gate.issues.map((issue) => issue.code));
                  void run(format);
                }}
                data-testid="pub-confirm-export"
              >
                {t("publishing.confirmExport")}
              </button>
            </>
          }
        >
          <p>{t("publishing.confirmBody", { count: gate.issues.length })}</p>
        </Dialog>
      )}
    </SectionPanel>
  );
}

export function PublishingPanel() {
  const projectId = useStudio((s) => s.workspace!.project.id);
  const draft = useSheetDraft(projectId, "publishing");
  return (
    <>
      <SheetModeTabs kind="publishing" />
      {draft.mode === "ai" ? <SheetPanel kind="publishing" /> : <LocalPublishingPanel />}
    </>
  );
}
