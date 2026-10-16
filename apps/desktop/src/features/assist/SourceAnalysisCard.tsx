import { useMemo, useState } from "react";
import type { ProjectDNA } from "@arch/domain";
import { selectReadOnly, useStudio } from "../../app/store";
import { useT } from "../../i18n";
import {
  assistCatalog,
  assistSystemPrompt,
  parseSourceAnalysisReply,
  runDnaAssist,
  sourceAnalysisExtraPrompt,
  type AssistField,
  type AssistScope,
  type SourceAnalysis,
} from "../../lib/assist";
import { MAX_EXTRA_PROMPT_CHARS } from "../generate/extraPrompt";
import {
  AssistErrorCallout,
  AssistProposalDiff,
  assistErrorKind,
  useAssistSpend,
  useApplyAfterReopen,
  type AssistErrorKind,
  type AssistStepId,
} from "./AssistControl";

const STEP_BY_SCOPE: Record<AssistScope, AssistStepId> = {
  interior: "dna.building",
  building: "dna.building",
  context: "dna.context",
  lighting: "dna.lighting",
};

/** The extra prompt after "use this description": the analysis text appended once. */
export function mergeExtraPrompt(current: string | undefined, addition: string): string {
  const text = addition.trim();
  const existing = current?.trim() ?? "";
  if (!text || existing.includes(text)) return current ?? "";
  return (existing ? `${existing}\n\n${text}` : text).slice(0, MAX_EXTRA_PROMPT_CHARS);
}

/**
 * Source-image analysis (ADR-040, UI-5): "AI nhận diện từ ảnh". One paid `dna_assist` call in
 * mode `source`, only on an explicit click and after the spend confirmation. Observed and
 * inferred items are shown apart; inferred ones are never written anywhere. "Use this
 * description" writes `requestEn` + `keepEn` into the extra prompt and opens the ADR-030
 * proposal diff for the DNA fields, which are written only when the user applies them.
 *
 * Plugs into the quick-generate `analysisSlot`, or stands alone with an asset id and a wish.
 */
export function SourceAnalysisCard({
  assetId,
  wish,
  scope: scopeProp,
}: {
  assetId: string | null;
  wish: string;
  scope?: AssistScope;
}) {
  const t = useT();
  const project = useStudio((s) => s.workspace?.project ?? null);
  const dna = useStudio((s) => (s.workspace?.draftDna ?? null) as ProjectDNA | null);
  const readOnly = useStudio(selectReadOnly);
  const editDna = useStudio((s) => s.editDna);
  const setGenerateDraft = useStudio((s) => s.setGenerateDraft);
  const projectType = project?.projectType ?? "villa";
  const scope: AssistScope = scopeProp ?? (projectType === "interior" ? "interior" : "building");
  const catalog = useMemo(() => assistCatalog(scope, projectType), [scope, projectType]);
  const spend = useAssistSpend();
  const applyAfterReopen = useApplyAfterReopen(STEP_BY_SCOPE[scope]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AssistErrorKind | null>(null);
  const [result, setResult] = useState<{ assetId: string; analysis: SourceAnalysis } | null>(null);
  const [stage, setStage] = useState<"review" | "diff" | "done">("review");

  if (!project || !dna) return null;
  const analysis = result && result.assetId === assetId ? result.analysis : null;
  const extra = analysis ? sourceAnalysisExtraPrompt(analysis) : "";

  const analyse = async () => {
    if (!assetId) return;
    if (!(await spend.confirm())) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await runDnaAssist({
        projectId: project.id,
        mode: "source",
        scope,
        brief: wish.trim().slice(0, 1000),
        referenceAssetIds: [assetId],
        catalog,
        systemPrompt: assistSystemPrompt("source", catalog),
      });
      setResult({ assetId, analysis: parseSourceAnalysisReply(reply.raw, catalog) });
      setStage("review");
    } catch (err) {
      setError(assistErrorKind(err));
    } finally {
      setBusy(false);
    }
  };

  const applyDescription = () => {
    if (!analysis) return;
    if (extra) {
      setGenerateDraft({
        extraPrompt: mergeExtraPrompt(useStudio.getState().generateDraft.extraPrompt, extra),
      });
    }
    setStage(analysis.fields.length ? "diff" : "done");
  };

  const applyFields = (fields: AssistField[]) =>
    applyAfterReopen(() => {
      fields.forEach((field) => editDna(field.path, field.value));
      setStage("done");
    });

  const empty =
    !!analysis &&
    !analysis.observed.length &&
    !analysis.inferred.length &&
    !analysis.fields.length &&
    !extra;

  return (
    <section className="source-analysis" aria-label={t("assist.source.title")}>
      <div className="assist-title">
        <strong>{t("assist.source.title")}</strong>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!assetId || busy || readOnly}
          title={!assetId ? t("assist.source.noAsset") : undefined}
          onClick={() => void analyse()}
        >
          {busy ? t("common.loading") : t("assist.source.run")}
        </button>
      </div>
      <AssistErrorCallout error={error} />
      {empty && <p className="field-hint">{t("assist.source.empty")}</p>}
      {analysis && !empty && (
        <>
          {analysis.observed.length > 0 && (
            <div className="source-analysis-group">
              <span className="field-label">{t("assist.source.observed")}</span>
              <ul aria-label={t("assist.source.observed")}>
                {analysis.observed.map((item, index) => (
                  <li key={`o-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.inferred.length > 0 && (
            <div className="source-analysis-group">
              <span className="field-label">{t("assist.source.inferred")}</span>
              <ul aria-label={t("assist.source.inferred")}>
                {analysis.inferred.map((item, index) => (
                  <li key={`i-${index}`}>
                    {item.text} <span className="badge">{Math.round(item.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
              <small className="field-hint">{t("assist.source.inferredHint")}</small>
            </div>
          )}
          {analysis.requestEn && (
            <div className="source-analysis-group">
              <span className="field-label">{t("assist.source.request")}</span>
              <p lang="en">{analysis.requestEn}</p>
            </div>
          )}
          {analysis.keepEn.length > 0 && (
            <div className="source-analysis-group">
              <span className="field-label">{t("assist.source.keep")}</span>
              <p lang="en">{analysis.keepEn.join("; ")}</p>
            </div>
          )}
          {stage === "review" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={readOnly || (!extra && !analysis.fields.length)}
              onClick={applyDescription}
            >
              {t("assist.source.use")}
            </button>
          )}
          {stage === "diff" && (
            <AssistProposalDiff
              proposal={analysis}
              catalog={catalog}
              dna={dna}
              onApply={applyFields}
            />
          )}
          {stage !== "review" && extra && (
            <p className="field-hint" role="status">
              {t("assist.source.written")}
            </p>
          )}
        </>
      )}
      {spend.dialog}
    </section>
  );
}
