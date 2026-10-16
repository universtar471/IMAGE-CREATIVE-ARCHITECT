import { useMemo, useState } from "react";
import type { AssetDTO, ProjectDNA } from "@arch/domain";
import { useStudio } from "../../app/store";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { useT } from "../../i18n";
import { BridgeError } from "../../lib/bridge";
import {
  assistCatalog,
  assistSystemPrompt,
  parseAssistReply,
  runDnaAssist,
  shouldOfferTranslation,
  type AssistCatalog,
  type AssistField,
  type AssistMode,
  type AssistScope,
  type AssistSuggestion,
} from "../../lib/assist";
import { getIn } from "../../lib/path";

export type AssistErrorKind = "notConfigured" | "quota" | "invalid" | "other";

/** Maps a failed `dna_assist` call to the message shown under the assist controls. */
export function assistErrorKind(err: unknown): AssistErrorKind {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  const code = err instanceof BridgeError ? err.code : null;
  return code === "PROVIDER_NOT_CONFIGURED"
    ? "notConfigured"
    : /credit|quota/.test(message)
      ? "quota"
      : code === "VALIDATION_ERROR" || err instanceof SyntaxError
        ? "invalid"
        : "other";
}

/** The spend confirmation every assist mode shows before its paid call (ADR-030). */
export function useAssistSpend() {
  const t = useT();
  const spend = useSpendConfirm();
  const confirm = () =>
    spend.request({
      providerId: "hhtech",
      provider: "HHTECH",
      model: "AI gợi ý",
      imageCount: 0,
      costText: t("assist.estimate"),
      estimatedTotal: null,
    });
  return { confirm, dialog: spend.dialog };
}

export type AssistStepId = "dna.building" | "dna.context" | "dna.lighting";

/**
 * Runs `apply` at once on an open step. On a confirmed step it first asks to reopen it
 * (ADR-029: no cascade) and skips `apply` when the user declines or the reopen fails.
 */
export function useApplyAfterReopen(stepId: AssistStepId) {
  const t = useT();
  const reopenStep = useStudio((state) => state.reopenWorkflowStep);
  const workflow = useStudio((state) => state.workflowView);
  return (apply: () => void): void => {
    const step = workflow?.steps.find((item) => item.id === stepId);
    if (step?.status !== "confirmed" && step?.status !== "needs_review") return apply();
    if (!window.confirm(t("assist.reopenConfirm"))) return;
    void reopenStep(stepId).then((reopened) => {
      if (reopened) apply();
    });
  };
}

export function AssistErrorCallout({ error }: { error: AssistErrorKind | null }) {
  const t = useT();
  const openProviderDialog = useStudio((state) => state.openProviderDialog);
  if (!error) return null;
  return (
    <div className="callout callout-warning" role="alert">
      {error === "notConfigured" ? (
        <>
          {t("assist.notConfigured")}{" "}
          <button className="link-btn" onClick={() => openProviderDialog("hhtech")}>
            {t("assist.providerSettings")}
          </button>
        </>
      ) : (
        t(`assist.error.${error}`)
      )}
    </div>
  );
}

/**
 * The ADR-030 proposal diff (current → AI proposal): one checkbox per field (default on), the
 * confidence and the reason. Nothing is written until "Apply" hands over the checked fields.
 */
export function AssistProposalDiff({
  proposal,
  catalog,
  dna,
  busy = false,
  onApply,
  onTranslate,
}: {
  proposal: AssistSuggestion;
  catalog: AssistCatalog;
  dna: ProjectDNA;
  busy?: boolean;
  onApply: (fields: AssistField[]) => void;
  onTranslate?: (path: string, text: string) => void;
}) {
  const t = useT();
  const [checked, setChecked] = useState<string[]>(() =>
    proposal.fields.map((field) => field.path),
  );
  const displayValue = (path: string, value: unknown) => {
    if (Array.isArray(value)) return value.join(", ");
    const definition = catalog.fields.find((field) => field.path === path);
    if (definition?.options)
      return definition.options.find((option) => option.id === value)?.en ?? String(value ?? "—");
    return String(value ?? "—");
  };
  return (
    <>
      <div className="assist-diff-list">
        {proposal.fields.map((field) => (
          <div key={field.path} className="assist-diff-row">
            <input
              type="checkbox"
              aria-label={field.path}
              checked={checked.includes(field.path)}
              onChange={(event) =>
                setChecked(
                  event.target.checked
                    ? [...checked, field.path]
                    : checked.filter((path) => path !== field.path),
                )
              }
            />
            <span className="assist-diff-content">
              <strong>{t(("assist.field." + field.path.replaceAll(".", "_")) as never)}</strong>
              <span className="assist-values">
                {displayValue(field.path, getIn(dna, field.path))} →{" "}
                {displayValue(field.path, field.value)}
              </span>
              <small>{field.reason}</small>
            </span>
            <span className="badge">{Math.round(field.confidence * 100)}%</span>
            {onTranslate &&
              catalog.fields.find((definition) => definition.path === field.path)?.kind ===
                "text" && (
                <TranslateChip
                  text={String(getIn(dna, field.path) ?? "")}
                  disabled={busy}
                  onClick={() => onTranslate(field.path, String(getIn(dna, field.path) ?? ""))}
                />
              )}
          </div>
        ))}
      </div>
      {proposal.dropped.length > 0 && (
        <details>
          <summary>{t("assist.dropped", { count: proposal.dropped.length })}</summary>
          <ul>
            {proposal.dropped.map((item, index) => (
              <li key={`${item.path}-${index}`}>
                {item.path}: {item.why}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={!checked.length}
        onClick={() => onApply(proposal.fields.filter((field) => checked.includes(field.path)))}
      >
        {t("assist.apply", { count: checked.length })}
      </button>
    </>
  );
}

export function TranslateChip({
  text,
  onClick,
  disabled = false,
}: {
  text: string | undefined;
  onClick: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  if (!text || !shouldOfferTranslation(text)) return null;
  return (
    <button
      type="button"
      className="chip assist-translate-chip"
      disabled={disabled}
      onClick={onClick}
    >
      {t("assist.translate")}
    </button>
  );
}

export function AssistControl({
  scope,
  stepId,
  projectType,
  projectId,
  dna,
  assets,
  hasMaster = false,
  onApply,
  buttonLabel,
  initialMode,
}: {
  scope: AssistScope;
  stepId: AssistStepId;
  projectType: string;
  projectId: string;
  dna: ProjectDNA;
  assets: AssetDTO[];
  hasMaster?: boolean;
  onApply: (fields: AssistField[]) => void;
  buttonLabel?: string;
  initialMode?: AssistMode;
}) {
  const t = useT();
  const spend = useAssistSpend();
  const applyAfterReopen = useApplyAfterReopen(stepId);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistMode | null>(initialMode ?? null);
  const [brief, setBrief] = useState("");
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AssistErrorKind | null>(null);
  const [proposal, setProposal] = useState<AssistSuggestion | null>(null);
  // Remounts the diff (all fields checked again) for every new reply.
  const [proposalRun, setProposalRun] = useState(0);
  const catalog = useMemo(() => assistCatalog(scope, projectType), [scope, projectType]);
  const references = assets.filter(
    (asset) => asset.role.endsWith("_reference") && asset.status === "ready",
  );

  const run = async (selectedMode: AssistMode | null = mode) => {
    if (!selectedMode) return;
    setBusy(true);
    setError(null);
    try {
      const result = await runDnaAssist({
        projectId,
        mode: selectedMode,
        scope,
        ...(selectedMode === "brief" ? { brief: brief.slice(0, 1000) } : {}),
        ...(selectedMode === "images" ? { referenceAssetIds: referenceAssetIds.slice(0, 3) } : {}),
        catalog,
        systemPrompt: assistSystemPrompt(selectedMode, catalog),
      });
      setProposal(parseAssistReply(result.raw, catalog));
      setProposalRun((count) => count + 1);
    } catch (err) {
      setError(assistErrorKind(err));
    } finally {
      setBusy(false);
    }
  };

  const translate = async (path: string, text: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await runDnaAssist({
        projectId,
        mode: "translate",
        scope,
        translate: [{ path, text }],
        catalog,
        systemPrompt: assistSystemPrompt("translate", catalog),
      });
      setProposal(parseAssistReply(result.raw, catalog));
      setProposalRun((count) => count + 1);
    } catch (err) {
      setError(assistErrorKind(err));
    } finally {
      setBusy(false);
    }
  };

  const continueToCall = async (selectedMode: AssistMode | null = mode) => {
    if (!selectedMode) return;
    if (await spend.confirm()) await run(selectedMode);
  };

  const apply = (fields: AssistField[]) =>
    applyAfterReopen(() => {
      onApply(fields);
      setProposal(null);
      setOpen(false);
    });

  return (
    <>
      <button
        type="button"
        className="btn btn-sm assist-trigger"
        disabled={initialMode === "master" && !hasMaster}
        onClick={() => {
          setOpen(true);
          setMode(initialMode ?? null);
          setProposal(null);
          setError(null);
          if (initialMode) void continueToCall(initialMode);
        }}
      >
        {buttonLabel ?? t("assist.button")}
      </button>
      {open && (
        <div className="assist-popover" role="dialog" aria-label={t("assist.title")}>
          <div className="assist-title">
            <strong>{t("assist.title")}</strong>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              aria-label={t("common.close")}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>
          {!proposal ? (
            <>
              {!initialMode && (
                <div className="assist-modes" role="tablist">
                  {(["brief", "images", "master"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="btn btn-sm"
                      aria-selected={mode === value}
                      aria-pressed={mode === value}
                      disabled={value === "master" && !hasMaster}
                      onClick={() => setMode(value)}
                    >
                      {t(`assist.mode.${value}`)}
                    </button>
                  ))}
                </div>
              )}
              {mode === "brief" && (
                <label className="field">
                  <span className="field-label">{t("assist.briefLabel")}</span>
                  <textarea
                    className="textarea"
                    maxLength={1000}
                    value={brief}
                    placeholder={t("assist.briefPlaceholder")}
                    onChange={(event) => setBrief(event.target.value)}
                  />
                </label>
              )}
              {mode === "images" && (
                <div className="assist-reference-list">
                  {references.length ? (
                    references.map((asset) => (
                      <label key={asset.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={referenceAssetIds.includes(asset.id)}
                          disabled={
                            !referenceAssetIds.includes(asset.id) && referenceAssetIds.length >= 3
                          }
                          onChange={(event) =>
                            setReferenceAssetIds(
                              event.target.checked
                                ? [...referenceAssetIds, asset.id]
                                : referenceAssetIds.filter((id) => id !== asset.id),
                            )
                          }
                        />
                        {asset.originalName}
                      </label>
                    ))
                  ) : (
                    <span className="field-hint">{t("assist.noReferences")}</span>
                  )}
                </div>
              )}
              {mode && !initialMode && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || (mode === "brief" && !brief.trim())}
                  onClick={() => void continueToCall()}
                >
                  {busy ? t("common.loading") : t("assist.continue")}
                </button>
              )}
              <AssistErrorCallout error={error} />
            </>
          ) : (
            <AssistProposalDiff
              key={proposalRun}
              proposal={proposal}
              catalog={catalog}
              dna={dna}
              busy={busy}
              onApply={apply}
              onTranslate={(path, text) => void translate(path, text)}
            />
          )}
          {spend.dialog}
        </div>
      )}
    </>
  );
}
