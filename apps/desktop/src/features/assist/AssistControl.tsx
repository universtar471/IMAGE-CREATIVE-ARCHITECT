import { useMemo, useRef, useState } from "react";
import {
  assistFieldSection,
  isVideoAsset,
  type AssetDTO,
  type DnaStepId,
  type ProjectDNA,
} from "@arch/domain";
import { useStudio } from "../../app/store";
import { useSpendConfirm } from "../../components/common/SpendConfirm";
import { useT } from "../../i18n";
import { BridgeError } from "../../lib/bridge";
import {
  assistCatalog,
  assistSystemPrompt,
  type AssistSuggestion,
  type AssistCatalog,
  suggest,
  shouldOfferTranslation,
  type AssistField,
  type AssistMode,
  type AssistScope,
} from "../../lib/assist";
import { getIn } from "../../lib/path";

const stepForPath = (path: string): DnaStepId | undefined =>
  (
    ({
      building: "dna.building",
      context: "dna.context",
      lighting: "dna.lighting",
      camera: "dna.camera",
    }) as const
  )[assistFieldSection(path) as "building" | "context" | "lighting" | "camera"];

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
  context,
  catalog: suppliedCatalog,
}: {
  scope: AssistScope;
  stepId?: DnaStepId;
  projectType: string;
  projectId: string;
  dna: ProjectDNA;
  assets: AssetDTO[];
  hasMaster?: boolean;
  onApply: (fields: AssistField[]) => void;
  buttonLabel?: string;
  initialMode?: AssistMode;
  context?: Record<string, unknown>;
  catalog?: AssistCatalog;
}) {
  const t = useT();
  const spend = useSpendConfirm();
  const openProviderDialog = useStudio((state) => state.openProviderDialog);
  const reopenStep = useStudio((state) => state.reopenWorkflowStep);
  const workflow = useStudio((state) => state.workflowView);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AssistMode | null>(initialMode ?? null);
  const [brief, setBrief] = useState("");
  const [referenceAssetIds, setReferenceAssetIds] = useState<string[]>(() =>
    assets
      .filter(
        (asset) =>
          asset.role.endsWith("_reference") && asset.status === "ready" && !isVideoAsset(asset),
      )
      .slice(0, 3)
      .map((asset) => asset.id),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"notConfigured" | "quota" | "invalid" | "other" | null>(null);
  const [proposal, setProposal] = useState<AssistSuggestion | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const token = useRef(0);
  const canUseMaster =
    hasMaster &&
    (!workflow || workflow.steps.some((s) => s.id === "generate.master" && s.status === "done"));
  const catalog = useMemo(() => {
    const base = suppliedCatalog ?? assistCatalog(scope, projectType);
    return {
      ...base,
      fields: base.fields.filter((field) => {
        const section = assistFieldSection(field.path);
        const step = workflow?.steps.find((s) => s.id === stepForPath(field.path));
        return (
          !(dna.locks as unknown as Record<string, unknown>)[section] ||
          step?.status === "confirmed" ||
          step?.status === "needs_review"
        );
      }),
    };
  }, [scope, projectType, suppliedCatalog, dna.locks, workflow]);
  const references = assets.filter((asset) => asset.status === "ready" && !isVideoAsset(asset));

  const run = async (
    selectedMode: AssistMode | null = mode,
    translate?: Array<{ path: string; text: string }>,
  ) => {
    if (!selectedMode || busy) return;
    const epoch = ++token.current;
    setBusy(true);
    setError(null);
    try {
      const state = useStudio.getState();
      const selectedId = state.selectedAssetId ?? state.workspace?.project.activeMasterAssetId;
      const imageIds =
        selectedMode === "images"
          ? referenceAssetIds
          : [
              selectedId,
              ...assets
                .filter((asset) => asset.role.endsWith("_reference"))
                .map((asset) => asset.id),
            ].filter((id): id is string => !!id && references.some((asset) => asset.id === id));
      const parsed = await suggest(
        {
          projectId,
          mode: selectedMode,
          scope,
          ...(selectedMode === "brief" ? { brief: brief.slice(0, 1000) } : {}),
          ...(selectedMode !== "master" && selectedMode !== "translate"
            ? { referenceAssetIds: [...new Set(imageIds)].slice(0, 3) }
            : {}),
          ...(translate ? { translate } : {}),
          context: {
            projectType,
            currentModule: useStudio.getState().activeModule,
            currentImageId: selectedId,
            selectedCameraId: state.selectedCameraId,
            currentSelections: state.workspace?.shotIntent,
            dna,
            ...context,
          },
          catalog,
          systemPrompt: assistSystemPrompt(selectedMode, catalog),
        },
        dna,
        catalog,
      );
      if (epoch !== token.current) return;
      setProposal(parsed);
      setChecked(parsed.fields.map((field) => field.path));
    } catch (err) {
      if (epoch !== token.current) return;
      const message = err instanceof Error ? err.message.toLowerCase() : "";
      const code = err instanceof BridgeError ? err.code : null;
      setError(
        code === "PROVIDER_NOT_CONFIGURED"
          ? "notConfigured"
          : code === "PROVIDER_QUOTA" || /credit|quota/.test(message)
            ? "quota"
            : code === "VALIDATION_ERROR" || err instanceof SyntaxError
              ? "invalid"
              : "other",
      );
    } finally {
      if (epoch === token.current) setBusy(false);
    }
  };

  const translate = (path: string, text: string) => continueToCall("translate", [{ path, text }]);

  const displayValue = (path: string, value: unknown) => {
    if (Array.isArray(value)) return value.join(", ");
    const definition = catalog.fields.find((field) => field.path === path);
    if (definition?.options)
      return definition.options.find((option) => option.id === value)?.en ?? String(value ?? "—");
    return String(value ?? "—");
  };

  const continueToCall = async (
    selectedMode: AssistMode | null = mode,
    translate?: Array<{ path: string; text: string }>,
  ) => {
    if (!selectedMode) return;
    const confirmed = await spend.request({
      providerId: "hhtech",
      provider: "HHTECH",
      model: "AI gợi ý",
      imageCount: 0,
      costText: t("assist.estimate"),
      estimatedTotal: null,
    });
    if (confirmed) await run(selectedMode, translate);
  };

  const apply = async () => {
    const fields = proposal?.fields.filter((field) => checked.includes(field.path)) ?? [];
    const stepIds = [...new Set([stepId, ...fields.map((f) => stepForPath(f.path))])];
    const reopenIds = stepIds.filter(
      (id): id is DnaStepId =>
        !!id &&
        !!workflow?.steps.some(
          (step) =>
            step.id === id && (step.status === "confirmed" || step.status === "needs_review"),
        ),
    );
    if (reopenIds.length) {
      if (!window.confirm(t("assist.reopenConfirm"))) return;
      for (const id of reopenIds) if (!(await reopenStep(id))) return;
    }
    try {
      onApply(fields);
    } catch {
      setError("invalid");
      return;
    }
    token.current++;
    setProposal(null);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-sm assist-trigger"
        disabled={busy || !catalog.fields.length || (initialMode === "master" && !canUseMaster)}
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
              onClick={() => {
                token.current++;
                setBusy(false);
                setOpen(false);
              }}
            >
              ×
            </button>
          </div>
          {!proposal || error ? (
            <>
              {!initialMode && (
                <div className="assist-modes" role="group">
                  {(["brief", "images", "master"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="btn btn-sm"
                      aria-pressed={mode === value}
                      disabled={busy || (value === "master" && !canUseMaster)}
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
                    disabled={busy}
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
                  disabled={
                    busy ||
                    (mode === "brief" && !brief.trim()) ||
                    (mode === "images" && !referenceAssetIds.length)
                  }
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
                      <strong>
                        {field.path.startsWith("camera.") ||
                        field.path.startsWith("region.") ||
                        field.path.startsWith("effects.") ||
                        field.path.startsWith("mood.") ||
                        field.path === "colorGrade.look"
                          ? field.path.split(".").slice(1).join(" · ")
                          : t(("assist.field." + field.path.replaceAll(".", "_")) as never)}
                      </strong>
                      <span className="assist-values">
                        {displayValue(field.path, getIn(dna, field.path))} →{" "}
                        {displayValue(field.path, field.value)}
                      </span>
                      <small>{field.reason}</small>
                    </span>
                    <span className="badge">{Math.round(field.confidence * 100)}%</span>
                    {catalog.fields.find((definition) => definition.path === field.path)?.kind ===
                      "text" && (
                      <TranslateChip
                        text={String(getIn(dna, field.path) ?? "")}
                        disabled={busy}
                        onClick={() =>
                          void translate(field.path, String(getIn(dna, field.path) ?? ""))
                        }
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
                disabled={busy || !checked.length}
                onClick={() => void apply()}
              >
                {t("assist.apply", { count: checked.length })}
              </button>
            </>
          )}
          {proposal && !proposal.fields.length && <span role="status">{t("menu.retryHelp")}</span>}
          {busy && <span role="status">{t("common.loading")}</span>}
          {error && (
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => {
                setProposal(null);
                void continueToCall();
              }}
            >
              {t("common.tryAgain")}
            </button>
          )}
          {spend.dialog}
        </div>
      )}
    </>
  );
}
