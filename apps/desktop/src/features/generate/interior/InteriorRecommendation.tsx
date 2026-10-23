import { useState } from "react";
import { Check, Loader2, RefreshCw, Settings2 } from "lucide-react";
import {
  GENERATION_STYLES,
  GENERATION_LIGHTING,
  interiorRecommendationPrompt,
  parseInteriorRecommendation,
  type InteriorGenerationState,
  type InteriorRecommendationKind,
  type InteriorStyleAdvice,
  type InteriorLightAdvice,
} from "@arch/domain";
import { useStudio } from "../../../app/store";
import { useSpendConfirm } from "../../../components/common/SpendConfirm";
import { ErrorMessage } from "../../../components/common/ErrorMessage";
import { runDnaAssist } from "../../../lib/assist";
import { BridgeError, toBridgeError } from "../../../lib/bridge";
import { useLocale, useT } from "../../../i18n";
import { GenerationIcon } from "./GenerationIcon";

/** Recommendations use the existing chat/vision bridge and shared JSON decoder, never generation_submit. */
export function InteriorRecommendation({
  kind,
  state,
  set,
  disabled,
}: {
  kind: InteriorRecommendationKind;
  state: InteriorGenerationState;
  set: (next: InteriorGenerationState) => void;
  disabled: boolean;
}) {
  const ws = useStudio((s) => s.workspace!);
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const spend = useSpendConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof toBridgeError> | null>(null);
  const [proposal, setProposal] = useState<{
    key: string;
    data: InteriorStyleAdvice | InteriorLightAdvice;
  } | null>(null);
  const key = JSON.stringify([ws.project.id, ws.draftDna, state, locale]);
  const current = proposal?.key === key ? proposal.data : null;
  const run = async () => {
    if (busy || disabled || !state.input.assetId) return;
    setBusy(true);
    setError(null);
    try {
      if (
        !(await spend.request({
          providerId: "hhtech",
          provider: "HHTECH",
          model: t(kind === "style" ? "interiorFlow.suggestStyles" : "interiorFlow.suggestLight"),
          imageCount: 0,
          costText: t("assist.estimate"),
          estimatedTotal: null,
          confirmLabel: t("assist.continue"),
        }))
      )
        return;
      const result = await runDnaAssist({
        projectId: ws.project.id,
        mode: "images",
        scope: kind,
        referenceAssetIds: [state.input.assetId, state.reference?.assetId].filter(
          (id): id is string => !!id,
        ),
        catalog: { scope: kind, fields: [] },
        systemPrompt: interiorRecommendationPrompt(kind),
        context: {
          projectType: "interior",
          currentModule: useStudio.getState().activeModule,
          language: locale,
          dna: ws.draftDna,
          currentSelections: state,
          currentImageId: state.input.assetId,
          reference: state.reference,
        },
      });
      setProposal({ key, data: parseInteriorRecommendation(result.raw, kind) });
    } catch (err) {
      setError(
        toBridgeError(
          err instanceof BridgeError ? err : new Error(t("interiorFlow.recommendationError")),
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const styles = current && "recommendations" in current ? current : null;
  const light = current && "preset" in current ? current : null;
  return (
    <div className="interior-recommendation">
      <button
        type="button"
        className="btn btn-sm"
        disabled={disabled || busy || !state.input.assetId}
        title={!state.input.assetId ? t("interiorFlow.requiresImage") : undefined}
        onClick={() => void run()}
      >
        {busy ? (
          <Loader2 size={16} className="spin" />
        ) : (
          <GenerationIcon id={kind === "style" ? "icon-ai-style" : "icon-ai-light"} />
        )}
        {t(kind === "style" ? "interiorFlow.suggestStyles" : "interiorFlow.suggestLight")}
      </button>
      {error && (
        <div role="alert">
          <ErrorMessage message={error.message} />
          <button
            className="btn btn-sm"
            type="button"
            disabled={busy || disabled}
            onClick={() => void run()}
          >
            <RefreshCw size={16} aria-hidden />
            {t("interiorFlow.retry")}
          </button>
          <button
            className="btn btn-sm"
            type="button"
            onClick={() => useStudio.getState().openProviderDialog("hhtech")}
          >
            <Settings2 size={16} aria-hidden />
            {t("generate.providerSettings")}
          </button>
        </div>
      )}
      {styles && (
        <div
          role="group"
          aria-label={t("interiorFlow.styleSuggestions")}
          className="interior-style-recommendations"
        >
          {styles.recommendations.map((item) => {
            const style = GENERATION_STYLES.find((p) => p.id === item.style_id)!;
            const lighting = GENERATION_LIGHTING.find((p) => p.id === item.suggested_lighting)!;
            return (
              <div className="callout" key={item.style_id}>
                <strong>
                  {style.label[locale]} · {item.compatibility_score}%
                </strong>
                <p>{item.short_reason}</p>
                <span className="field-hint">
                  {lighting.label[locale]} · {t("interiorFlow.changeLevel")}{" "}
                  {item.recommended_change_level}
                </span>
                <button
                  className="btn btn-sm"
                  type="button"
                  disabled={disabled || state.changeLevel === 0}
                  onClick={() =>
                    set({
                      ...state,
                      style: item.style_id,
                      sourceAnalysis: {
                        roomType: styles.analysis.room_type.slice(0, 150),
                        geometry: styles.analysis.geometry,
                        materials: styles.analysis.materials,
                        lighting: styles.analysis.lighting,
                      },
                    })
                  }
                >
                  <Check size={16} aria-hidden />
                  {t("interiorFlow.apply")}: {style.label[locale]}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {light && (
        <div className="callout">
          <strong>{GENERATION_LIGHTING.find((p) => p.id === light.preset)!.label[locale]}</strong>
          <p>{light.reason}</p>
          <button
            type="button"
            className="btn btn-sm"
            disabled={disabled}
            onClick={() => set({ ...state, lighting: { preset: light.preset } })}
          >
            <Check size={16} aria-hidden />
            {t("interiorFlow.apply")}
          </button>
        </div>
      )}
      {spend.dialog}
    </div>
  );
}
