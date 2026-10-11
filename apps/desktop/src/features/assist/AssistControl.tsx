import { useMemo, useState } from "react";
import type { AssetDTO, ProjectDNA } from "@arch/domain";
import { useStudio } from "../../app/store";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { useT } from "../../i18n";
import { BridgeError, call } from "../../lib/bridge";
import {
  assistCatalog,
  assistSystemPrompt,
  parseAssistReply,
  type AssistField,
  type AssistMode,
  type AssistScope,
} from "../../lib/assist";

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
}: {
  scope: AssistScope;
  stepId: "dna.building" | "dna.context" | "dna.lighting";
  projectType: string;
  projectId: string;
  dna: ProjectDNA;
  assets: AssetDTO[];
  hasMaster?: boolean;
  onApply: (fields: AssistField[]) => void;
  buttonLabel?: string;
}) {
  const t = useT();
  const spend = useSpendConfirm();
  const openProviderDialog = useStudio((state) => state.openProviderDialog);
  const reopenStep = useStudio((state) => state.reopenWorkflowStep);
  const workflow = useStudio((state) => state.workflowView);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistMode | null>(null);
  const [brief, setBrief] = useState("");
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"notConfigured" | "quota" | "invalid" | "other" | null>(null);
  const [proposal, setProposal] = useState<ReturnType<typeof parseAssistReply> | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const catalog = useMemo(() => assistCatalog(scope, projectType), [scope, projectType]);
  const references = assets.filter(
    (asset) => asset.role.endsWith("_reference") && asset.status === "ready",
  );

  const run = async () => {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call("dna_assist", {
        projectId,
        mode,
        scope,
        ...(mode === "brief" ? { brief: brief.slice(0, 1000) } : {}),
        ...(mode === "images" ? { referenceAssetIds: referenceAssetIds.slice(0, 3) } : {}),
        catalog,
        systemPrompt: assistSystemPrompt(mode, catalog),
      });
      const parsed = parseAssistReply(result.raw, catalog);
      setProposal(parsed);
      setChecked(parsed.fields.map((field) => field.path));
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      const code = err instanceof BridgeError ? err.code : null;
      setError(
        code === "PROVIDER_NOT_CONFIGURED"
          ? "notConfigured"
          : /credit|quota/.test(message)
            ? "quota"
            : code === "VALIDATION_ERROR" || err instanceof SyntaxError
              ? "invalid"
              : "other",
      );
    } finally {
      setBusy(false);
    }
  };

  const continueToCall = async () => {
    if (!mode) return;
    const confirmed = await spend.request({
      providerId: "hhtech",
      provider: "HHTECH",
      model: "AI gợi ý",
      imageCount: 0,
      costText: t("assist.estimate"),
      estimatedTotal: null,
    });
    if (confirmed) await run();
  };

  const apply = async () => {
    const step = workflow?.steps.find((item) => item.id === stepId);
    if (step?.status === "confirmed" || step?.status === "needs_review") {
      if (!window.confirm(t("assist.reopenConfirm"))) return;
      if (!(await reopenStep(stepId))) return;
    }
    onApply(proposal?.fields.filter((field) => checked.includes(field.path)) ?? []);
    setProposal(null);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-sm assist-trigger"
        onClick={() => {
          setOpen(true);
          setProposal(null);
          setError(null);
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
              <div className="assist-modes">
                {(["brief", "images", "master"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="btn btn-sm"
                    aria-pressed={mode === value}
                    disabled={value === "master" && !hasMaster}
                    onClick={() => setMode(value)}
                  >
                    {t(`assist.mode.${value}`)}
                  </button>
                ))}
              </div>
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
              {mode && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy || (mode === "brief" && !brief.trim())}
                  onClick={() => void continueToCall()}
                >
                  {busy ? t("common.loading") : t("assist.continue")}
                </button>
              )}
              {error && (
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
              )}
            </>
          ) : (
            <>
              <div className="assist-diff-list">
                {proposal.fields.map((field) => (
                  <label key={field.path} className="assist-diff-row">
                    <input
                      type="checkbox"
                      checked={checked.includes(field.path)}
                      onChange={(event) =>
                        setChecked(
                          event.target.checked
                            ? [...checked, field.path]
                            : checked.filter((path) => path !== field.path),
                        )
                      }
                    />
                    <span>
                      <code>{field.path}</code>
                      <span className="assist-values">{String(field.value)}</span>
                      <small>{field.reason}</small>
                    </span>
                    <span className="badge">{Math.round(field.confidence * 100)}%</span>
                  </label>
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
                onClick={() => void apply()}
              >
                {t("assist.apply", { count: checked.length })}
              </button>
            </>
          )}
          {spend.dialog}
        </div>
      )}
    </>
  );
}
