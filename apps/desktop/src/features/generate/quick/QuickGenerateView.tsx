import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Eye,
  FileText,
  ImageOff,
  ImagePlus,
  KeyRound,
  PenTool,
  Settings2,
  Upload,
} from "lucide-react";
import type { AssetDTO } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../../app/store";
import { ConfirmDialog, Dialog } from "../../../components/common/Dialog";
import { ErrorMessage } from "../../../components/common/ErrorMessage";
import { RoleBadge } from "../../../components/common/StatusBadge";
import { SectionPanel } from "../../../components/panels/SectionPanel";
import { FieldGroup, NumberField, SelectField } from "../../../components/panels/fields";
import { useT, type TKey } from "../../../i18n";
import { translateDomainMessage } from "../../../i18n/domain";
import { fileUrl } from "../../../lib/files";
import { useAssetImport } from "../../assets/useAssetImport";
import { ConflictPanel, useConflictFix } from "../../validation/ConflictPanel";
import { BlockedExplainer } from "../../workflow/BlockedExplainer";
import { GeneratePanel, GenerateProvidersGate, ProviderSection } from "../GeneratePanel";
import { GeneratePromptPreview } from "../GeneratePromptPreview";
import { GenerationResult } from "../GenerationResult";
import { QualityField } from "../QualityField";
import { MAX_EXTRA_PROMPT_CHARS } from "../extraPrompt";
import { resolveGenerateForm, type GenerateForm } from "../form";
import { useGenerateSubmit } from "../useGenerateSubmit";
import {
  FAITHFULNESS_LEVELS,
  QUICK_SOURCES,
  SOURCE_ROLE,
  availableQuickSources,
  initialQuickChoice,
  keepFacts,
  quickDraft,
  resolveSourceAsset,
  sourceCandidates,
  type QuickChoice,
  type QuickSource,
} from "./quickDraft";

/** What the analysis slot (UI-5, "AI nhận diện từ ảnh") gets to work with. */
export type QuickAnalysisContext = { asset: AssetDTO | null; wish: string };

export type QuickGenerateViewProps = {
  /** Rendered under the source image; a function receives the current source and wish. */
  analysisSlot?: ReactNode | ((ctx: QuickAnalysisContext) => ReactNode);
  /** Start with this asset as the source (e.g. "use as source" from the library). */
  initialSourceAssetId?: string | null;
  /** "Tùy chỉnh đầy đủ": defaults to showing the Generate panel in the request column. */
  onOpenFullPanel?: () => void;
};

const WISH_FIELD_ID = "quick-wish";

/**
 * Quick generate (ADR-040, UI-3): the source picker and the large source image on the left,
 * the request panel on the right. It fills the Generate draft and submits through the same
 * gate, spend confirmation and `submitGeneration` as the Generate panel.
 */
export function QuickGenerateView(props: QuickGenerateViewProps) {
  return (
    <div className="quick-generate" data-testid="quick-generate">
      <GenerateProvidersGate>
        <QuickGenerateBody {...props} />
      </GenerateProvidersGate>
    </div>
  );
}

function QuickGenerateBody({
  analysisSlot,
  initialSourceAssetId = null,
  onOpenFullPanel,
}: QuickGenerateViewProps) {
  const providers = useStudio((s) => s.providers!);
  const ws = useStudio((s) => s.workspace!);
  const draft = useStudio((s) => s.generateDraft);
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const t = useT();
  const masterId = ws.project.activeMasterAssetId;
  // Provider and model do not depend on the references: resolve them from the draft first.
  const model = resolveGenerateForm(draft, providers, ws.assets, masterId).model;
  const [choice, setChoice] = useState<QuickChoice>(() =>
    initialQuickChoice(draft, model, ws.assets, initialSourceAssetId),
  );
  const [full, setFull] = useState(false);
  const sources = availableQuickSources(model);
  // A source the model cannot serve is never kept (e.g. after switching to a text-only model).
  const effective: QuickChoice = sources.includes(choice.source)
    ? choice
    : { ...choice, source: "text" };
  const effectiveDraft = quickDraft(draft, effective, ws.assets, masterId, model);
  const form = resolveGenerateForm(effectiveDraft, providers, ws.assets, masterId);
  const source = resolveSourceAsset(effective, ws.assets, masterId);
  const wish = draft.extraPrompt ?? "";

  const openFull = () => {
    // The full panel edits the same draft: hand it the quick choice first.
    setDraft({
      source: effectiveDraft.source,
      purpose: effectiveDraft.purpose,
      referenceAssetIds: effectiveDraft.referenceAssetIds,
    });
    if (onOpenFullPanel) onOpenFullPanel();
    else setFull(true);
  };

  return (
    <>
      <section className="quick-source-column" aria-label={t("quick.sourceLabel")}>
        <SourceCards
          sources={sources}
          active={effective.source}
          onPick={(next) => setChoice({ ...effective, source: next, sourceAssetId: null })}
        />
        {sources.length < QUICK_SOURCES.length && form.model && (
          <span className="field-hint" data-testid="quick-sources-hidden">
            {t("quick.sourcesHidden", { model: form.model.label })}
          </span>
        )}
        <SourceStage
          source={effective.source}
          asset={source}
          candidates={sourceCandidates(effective.source, ws.assets, masterId)}
          onPick={(id) => setChoice({ ...effective, sourceAssetId: id })}
        />
        {typeof analysisSlot === "function" ? analysisSlot({ asset: source, wish }) : analysisSlot}
        <SectionPanel title={t("generate.compiledPrompt")} defaultOpen={false}>
          <GeneratePromptPreview referenceIds={form.referenceIds} />
        </SectionPanel>
      </section>
      <aside className="quick-request-column" aria-label={t("quick.requestLabel")}>
        {full ? (
          <>
            <button className="link-btn" onClick={() => setFull(false)} data-testid="quick-back">
              <ArrowLeft size={13} /> {t("quick.backToQuick")}
            </button>
            <GeneratePanel />
          </>
        ) : (
          <RequestPanel
            form={form}
            choice={effective}
            source={source}
            onChoice={setChoice}
            onOpenFull={openFull}
          />
        )}
      </aside>
    </>
  );
}

const SOURCE_ICONS: Record<QuickSource, typeof ImagePlus> = {
  existing: ImagePlus,
  sketch: PenTool,
  text: FileText,
};

function SourceCards({
  sources,
  active,
  onPick,
}: {
  sources: readonly QuickSource[];
  active: QuickSource;
  onPick: (source: QuickSource) => void;
}) {
  const t = useT();
  return (
    <div className="quick-source-cards" role="group" aria-label={t("quick.sourceLabel")}>
      {sources.map((source) => {
        const Icon = SOURCE_ICONS[source];
        return (
          <button
            key={source}
            type="button"
            className="quick-source-card"
            aria-pressed={active === source}
            onClick={() => onPick(source)}
            data-testid={`quick-source-${source}`}
          >
            <Icon size={18} />
            <strong>{t(`quick.sources.${source}.title`)}</strong>
            <span>{t(`quick.sources.${source}.hint`)}</span>
          </button>
        );
      })}
    </div>
  );
}

function SourceStage({
  source,
  asset,
  candidates,
  onPick,
}: {
  source: QuickSource;
  asset: AssetDTO | null;
  candidates: readonly AssetDTO[];
  onPick: (id: string) => void;
}) {
  const readOnly = useStudio(selectReadOnly);
  const { busy, duplicate, pickAndImport } = useAssetImport();
  const t = useT();

  if (source === "text") {
    return (
      <div className="quick-stage quick-stage-text" data-testid="quick-stage-text">
        <FileText size={28} />
        <strong>{t("quick.textStageTitle")}</strong>
        <span>{t("quick.textStageHint")}</span>
      </div>
    );
  }

  const role = SOURCE_ROLE[source];
  const importSource = async () => {
    const before = new Set(useStudio.getState().workspace?.assets.map((a) => a.id) ?? []);
    await pickAndImport(role);
    const added = useStudio
      .getState()
      .workspace?.assets.find((a) => !before.has(a.id) && a.role === role);
    if (added) onPick(added.id);
  };
  const importing = busy ? t("quick.importing", { done: busy.done, total: busy.total }) : null;
  const src = asset ? fileUrl(asset.absolutePath) : null;

  return (
    <>
      {asset ? (
        <figure className="quick-stage" data-testid="quick-stage-image">
          {src ? (
            <img src={src} alt={asset.originalName ?? asset.id} decoding="async" />
          ) : (
            <ImageOff size={28} aria-label={t("assets.fileMissing")} />
          )}
          <figcaption>
            <span className="ref-name">{asset.originalName ?? asset.id}</span>
            <RoleBadge role={asset.role} short />
          </figcaption>
        </figure>
      ) : (
        <button
          type="button"
          className="quick-stage quick-dropzone"
          disabled={readOnly || !!busy}
          onClick={() => void importSource()}
          data-testid="quick-dropzone"
        >
          <Upload size={28} />
          <strong>{t(`quick.empty.${source}.title`)}</strong>
          <span>{importing ?? t(`quick.empty.${source}.step`)}</span>
        </button>
      )}
      {asset && (
        <div className="quick-source-strip">
          {candidates.length > 1 && (
            <div className="quick-thumbs" role="radiogroup" aria-label={t("quick.pickSource")}>
              {candidates.map((candidate) => {
                const thumb = fileUrl(candidate.thumbnailPath);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="radio"
                    aria-checked={candidate.id === asset.id}
                    title={candidate.originalName ?? candidate.id}
                    aria-label={candidate.originalName ?? candidate.id}
                    className="quick-thumb"
                    onClick={() => onPick(candidate.id)}
                  >
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : <ImageOff size={14} />}
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            className="btn btn-sm"
            disabled={readOnly || !!busy}
            onClick={() => void importSource()}
            data-testid="quick-import"
          >
            <ImagePlus size={13} /> {importing ?? t("quick.importOther")}
          </button>
        </div>
      )}
      {duplicate && (
        <ConfirmDialog
          title={t("assets.duplicateTitle")}
          message={duplicate.message}
          confirmLabel={t("assets.importAnyway")}
          onConfirm={() => duplicate.resolve(true)}
          onCancel={() => duplicate.resolve(false)}
        />
      )}
    </>
  );
}

function RequestPanel({
  form,
  choice,
  source,
  onChoice,
  onOpenFull,
}: {
  form: GenerateForm;
  choice: QuickChoice;
  source: AssetDTO | null;
  onChoice: (choice: QuickChoice) => void;
  onOpenFull: () => void;
}) {
  const draft = useStudio((s) => s.generateDraft);
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const readOnly = useStudio(selectReadOnly);
  const openProviderDialog = useStudio((s) => s.openProviderDialog);
  const t = useT();
  const submit = useGenerateSubmit(form);
  const [planOpen, setPlanOpen] = useState(false);
  const model = form.model;
  const p = form.params;
  const disabled = submit.running || readOnly;
  // The quick screen's own precondition comes first: an image source needs an image.
  const sourceReason = choice.source === "existing" && !source ? t("quick.reasonNoSource") : null;
  const disabledReason = sourceReason ?? submit.disabledReason;
  const thisRun = submit.thisRun;

  return (
    <div className="quick-request">
      <div className="field">
        <label className="field-label" htmlFor={WISH_FIELD_ID}>
          {t("quick.wish")}
        </label>
        <textarea
          id={WISH_FIELD_ID}
          className="textarea"
          rows={4}
          maxLength={MAX_EXTRA_PROMPT_CHARS}
          value={draft.extraPrompt ?? ""}
          disabled={disabled}
          placeholder={t("quick.wishPlaceholder")}
          onChange={(e) => setDraft({ extraPrompt: e.target.value })}
          data-testid="quick-wish"
        />
        <span className="field-hint">{t("quick.wishHint")}</span>
      </div>

      {choice.source !== "text" && (
        <FieldGroup
          label={t("quick.faithfulness")}
          hint={t(`quick.faithHint.${choice.faithfulness}`)}
        >
          <div className="segmented" role="group" aria-label={t("quick.faithfulness")}>
            {FAITHFULNESS_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={choice.faithfulness === level}
                disabled={disabled}
                onClick={() => onChoice({ ...choice, faithfulness: level })}
                data-testid={`quick-faith-${level}`}
              >
                {t(`quick.faith.${level}`)}
              </button>
            ))}
          </div>
        </FieldGroup>
      )}

      {model && (
        <div className="field-row">
          {model.aspectRatios.length > 0 && (
            <SelectField
              label={t("generate.aspectRatio")}
              allowEmpty={false}
              disabled={disabled}
              value={p.aspectRatio ?? undefined}
              options={model.aspectRatios.map((r) => ({ value: r, label: r }))}
              onChange={(v) => setDraft({ params: { ...p, aspectRatio: v ?? null } })}
            />
          )}
        </div>
      )}
      {model && model.maxOutputs > 1 && (
        <FieldGroup label={t("quick.imageCount")} hint={t("quick.imageCountHint")}>
          <div className="segmented" role="group" aria-label={t("quick.imageCount")}>
            {Array.from({ length: model.maxOutputs }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={p.outputCount === n}
                disabled={disabled}
                onClick={() => setDraft({ params: { ...p, outputCount: n } })}
                data-testid={`quick-count-${n}`}
              >
                {n}
              </button>
            ))}
          </div>
        </FieldGroup>
      )}

      <KeepSummary />

      <SectionPanel title={t("quick.advanced")} defaultOpen={false}>
        <ProviderSection form={form} disabled={disabled} />
        {model && model.imageSizes.length > 0 && (
          <SelectField
            label={t("generate.imageSize")}
            allowEmpty={false}
            disabled={disabled}
            value={p.imageSize ?? undefined}
            options={model.imageSizes.map((r) => ({ value: r, label: r }))}
            onChange={(v) => setDraft({ params: { ...p, imageSize: v ?? null } })}
          />
        )}
        {model && (
          <QualityField
            model={model}
            value={p.quality}
            disabled={disabled}
            onChange={(quality) => setDraft({ params: { ...p, quality } })}
          />
        )}
        {model?.supportsSeed && (
          <NumberField
            label={t("generate.seed")}
            hint={t("generate.seedHint")}
            disabled={disabled}
            value={p.seed ?? undefined}
            onChange={(v) => setDraft({ params: { ...p, seed: v ?? null } })}
          />
        )}
      </SectionPanel>
      <button className="link-btn" onClick={onOpenFull} data-testid="quick-open-full">
        <Settings2 size={12} /> {t("quick.openFull")}
      </button>

      <div className="generate-footer">
        {thisRun?.status === "error" && (
          <div className="callout callout-error" role="alert">
            <ErrorMessage
              code={thisRun.code}
              message={translateDomainMessage(thisRun.message, t)}
            />
            {thisRun.needsKeyFor && (
              <button
                className="btn btn-sm"
                onClick={() => openProviderDialog(thisRun.needsKeyFor)}
              >
                <KeyRound size={13} /> {t("generate.setApiKey")}
              </button>
            )}
          </div>
        )}
        <button
          className="btn btn-primary generate-btn"
          onClick={() => setPlanOpen(true)}
          data-testid="quick-plan"
        >
          <Eye size={15} /> {t("quick.viewPlan")}
        </button>
        {disabledReason && <span className="field-hint">{disabledReason}</span>}
      </div>

      <GenerationResult />

      {planOpen && (
        <PlanDialog
          form={form}
          choice={choice}
          source={source}
          cost={submit.cost}
          conflicts={submit.conflicts}
          disabledReason={disabledReason}
          blockedBy={submit.workflowGate.ok ? null : submit.workflowGate.blockedBy}
          onClose={() => setPlanOpen(false)}
          onConfirm={() => {
            setPlanOpen(false);
            void submit.generate();
          }}
        />
      )}
      {submit.spendDialog}
    </div>
  );
}

function KeepSummary() {
  const dna = useStudio((s) => s.workspace!.draftDna);
  const setModule = useStudio((s) => s.setModule);
  const t = useT();
  const facts = keepFacts(dna);
  const rows = [
    facts.style ? t("quick.keepStyle", { value: facts.style }) : null,
    facts.floors !== null ? t("masterCheck.floors", { n: facts.floors }) : null,
    facts.roof ? t("quick.keepRoof", { value: facts.roof }) : null,
    ...facts.materials,
    facts.locked.length
      ? t("quick.keepLocked", {
          list: facts.locked.map((key) => t(`quick.lockNames.${key}`)).join(", "),
        })
      : null,
  ].filter((row): row is string => !!row);
  return (
    <div className="quick-keep" data-testid="quick-keep">
      <strong>{t("quick.keepTitle")}</strong>
      {rows.length ? (
        <ul>
          {rows.map((row, index) => (
            <li key={`${index}:${row}`}>{row}</li>
          ))}
        </ul>
      ) : (
        <span className="field-hint">{t("quick.keepEmpty")}</span>
      )}
      <button className="link-btn" onClick={() => setModule("design_dna")}>
        {t("quick.keepEdit")}
      </button>
    </div>
  );
}

function PlanDialog({
  form,
  choice,
  source,
  cost,
  conflicts,
  disabledReason,
  blockedBy,
  onClose,
  onConfirm,
}: {
  form: GenerateForm;
  choice: QuickChoice;
  source: AssetDTO | null;
  cost: string | null;
  conflicts: ReturnType<typeof useGenerateSubmit>["conflicts"];
  disabledReason: string | null;
  blockedBy: Parameters<typeof BlockedExplainer>[0]["stepId"] | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const draft = useStudio((s) => s.generateDraft);
  const setDraft = useStudio((s) => s.setGenerateDraft);
  const t = useT();
  const fixElsewhere = useConflictFix(undefined, onClose);
  // A wish issue: close the plan, then put the cursor in the wish (after the dialog has
  // handed focus back to the plan button).
  const fix: typeof fixElsewhere = (issue) => {
    if (issue.path !== "extraPrompt") return fixElsewhere(issue);
    onClose();
    setTimeout(() => document.getElementById(WISH_FIELD_ID)?.focus(), 0);
  };
  const wish = draft.extraPrompt?.trim();
  const sourceKey: TKey = `quick.sources.${choice.source}.title`;
  return (
    <Dialog
      title={t("quick.planTitle")}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary"
            disabled={disabledReason !== null}
            onClick={onConfirm}
            data-testid="plan-confirm"
          >
            {t("quick.planConfirm")}
          </button>
        </>
      }
    >
      <dl className="kv" data-testid="plan-summary">
        <dt>{t("quick.planWhat")}</dt>
        <dd>{t("quick.planWhatValue", { count: form.params.outputCount })}</dd>
        <dt>{t("quick.planSource")}</dt>
        <dd>{t(sourceKey)}</dd>
        {choice.source !== "text" && (
          <>
            <dt>{t("quick.planSourceImage")}</dt>
            <dd>{source ? (source.originalName ?? source.id) : t("quick.planNone")}</dd>
            <dt>{t("quick.faithfulness")}</dt>
            <dd>{t(`quick.faith.${choice.faithfulness}`)}</dd>
          </>
        )}
        <dt>{t("quick.planReferences")}</dt>
        <dd>{form.referenceIds.length}</dd>
        {form.params.aspectRatio && (
          <>
            <dt>{t("generate.aspectRatio")}</dt>
            <dd>{form.params.aspectRatio}</dd>
          </>
        )}
        <dt>{t("spend.provider")}</dt>
        <dd>{form.provider?.label ?? t("quick.planNone")}</dd>
        <dt>{t("spend.model")}</dt>
        <dd>{form.model?.label ?? t("quick.planNone")}</dd>
        <dt>{t("quick.wish")}</dt>
        <dd>{wish || t("quick.planNone")}</dd>
        <dt>{t("spend.estimate")}</dt>
        <dd data-testid="plan-cost">{cost ?? t("spend.unknown")}</dd>
      </dl>
      <ConflictPanel
        entries={[{ validation: conflicts }]}
        onFix={fix}
        onApprove={(codes) =>
          setDraft({ approvedExceptions: [...(draft.approvedExceptions ?? []), ...codes] })
        }
      />
      {disabledReason ? (
        <div data-testid="plan-disabled-reason">
          <span className="field-hint">{disabledReason}</span>
          {blockedBy && <BlockedExplainer stepId={blockedBy} />}
        </div>
      ) : (
        <span className="field-hint">{t("quick.planSpendHint")}</span>
      )}
    </Dialog>
  );
}
