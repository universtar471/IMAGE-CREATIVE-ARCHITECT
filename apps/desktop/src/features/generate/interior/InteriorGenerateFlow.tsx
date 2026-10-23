import { ArrowRight } from "lucide-react";
import { InteriorCameraControls } from "../../camera/InteriorCameraControls";
import {
  GENERATION_GOALS,
  GENERATION_ROOMS,
  GENERATION_CHANGE_LEVELS,
  GENERATION_PRESERVE,
  GENERATION_LIGHTING,
  selectGenerationGoal,
  selectChangeLevel,
  setGenerationPreserve,
  resolveGenerationConflicts,
  keepGenerationLock,
  type InteriorGenerationState,
  type GenerationLight,
} from "@arch/domain";
import { SectionPanel } from "../../../components/panels/SectionPanel";
import { HelpPopover } from "../../../components/common/HelpPopover";
import { useLocale, useT } from "../../../i18n";
import { GenerationChoices } from "./GenerationChoices";
import { GenerationIcon } from "./GenerationIcon";
import { InteriorSourceInput } from "./InteriorSourceInput";
import { InteriorStylePicker } from "./InteriorStylePicker";
import { InteriorReference } from "./InteriorReference";
import { InteriorRecommendation } from "./InteriorRecommendation";

export function InteriorGenerateFlow({
  state,
  set,
  disabled,
  onContinue,
}: {
  state: InteriorGenerationState;
  set: (next: InteriorGenerationState) => void;
  disabled: boolean;
  onContinue?: () => void;
}) {
  const t = useT();
  const locale = useLocale((s) => s.locale);
  const conflicts = resolveGenerationConflicts(state);
  return (
    <div className="interior-generate-flow" data-testid="interior-generate-flow">
      <SectionPanel title={t("interiorFlow.source")}>
        <InteriorSourceInput state={state} set={set} disabled={disabled} />
      </SectionPanel>
      <SectionPanel title={t("interiorFlow.goal")}>
        <GenerationChoices
          items={GENERATION_GOALS}
          value={state.goal}
          disabled={disabled}
          label={t("interiorFlow.goal")}
          onChange={(id) => set(selectGenerationGoal(state, id))}
        />
      </SectionPanel>
      <SectionPanel title={t("interiorFlow.room")}>
        <GenerationChoices
          items={GENERATION_ROOMS}
          value={state.room}
          disabled={disabled}
          label={t("interiorFlow.room")}
          onChange={(room) => set({ ...state, room })}
        />
      </SectionPanel>
      <SectionPanel title={t("interiorFlow.style")}>
        <InteriorStylePicker state={state} set={set} disabled={disabled}>
          <InteriorRecommendation kind="style" state={state} set={set} disabled={disabled} />
          <InteriorReference state={state} set={set} disabled={disabled} />
        </InteriorStylePicker>
        {onContinue && (
          <button type="button" className="btn btn-primary" onClick={onContinue}>
            <ArrowRight size={15} aria-hidden /> {t("interiorFlow.generate")}
          </button>
        )}
      </SectionPanel>
      <SectionPanel title={t("interiorFlow.changeLevel")}>
        <GenerationChoices
          items={GENERATION_CHANGE_LEVELS}
          value={String(state.changeLevel)}
          disabled={disabled}
          label={t("interiorFlow.changeLevel")}
          onChange={(level) =>
            set(selectChangeLevel(state, Number(level) as InteriorGenerationState["changeLevel"]))
          }
        />
        <strong className="field-label">{t("interiorFlow.preserve")}</strong>
        <div
          className="generation-preserve-grid"
          role="group"
          aria-label={t("interiorFlow.preserve")}
        >
          {GENERATION_PRESERVE.map((item) => (
            <button
              type="button"
              className="generation-preserve"
              key={item.id}
              aria-pressed={state.preserve[item.id]}
              disabled={disabled}
              title={item.description[locale]}
              onClick={() => set(setGenerationPreserve(state, item.id, !state.preserve[item.id]))}
            >
              <GenerationIcon id={item.icon} />
              <span>{item.label[locale]}</span>
            </button>
          ))}
        </div>
      </SectionPanel>
      <SectionPanel
        title={t("interiorFlow.customize")}
        defaultOpen={state.goal === "ambience"}
        aside={
          <HelpPopover topic={t("interiorFlow.customize")}>
            {t("interiorFlow.customizeHint")}
          </HelpPopover>
        }
      >
        <SectionPanel title={t("interiorFlow.camera")}>
          <InteriorCameraControls state={state} set={set} disabled={disabled} />
        </SectionPanel>
        <SectionPanel title={t("interiorFlow.lighting")}>
          <GenerationChoices
            items={GENERATION_LIGHTING}
            value={state.lighting.preset}
            disabled={disabled}
            label={t("interiorFlow.lighting")}
            onChange={(preset) =>
              set({ ...state, lighting: { preset: preset as GenerationLight } })
            }
          />
          <InteriorRecommendation kind="lighting" state={state} set={set} disabled={disabled} />
        </SectionPanel>
        <label className="field">
          <span className="field-label">{t("interiorFlow.instruction")}</span>
          <textarea
            className="textarea"
            rows={3}
            maxLength={4000}
            value={state.instruction}
            disabled={disabled}
            onChange={(e) => set({ ...state, instruction: e.target.value })}
            data-testid="interior-instruction"
          />
        </label>
      </SectionPanel>
      {conflicts.map((conflict, index) => (
        <div
          className="callout callout-warning"
          role="alert"
          key={`${conflict.source}:${conflict.lock}:${index}`}
          data-testid="generation-hard-conflict"
        >
          <span>
            {t("interiorFlow.lockConflict", {
              lock: GENERATION_PRESERVE.find((p) => p.id === conflict.lock)!.label[locale],
            })}
          </span>
          {conflict.clause && <q>{conflict.clause}</q>}
          <div className="btn-row">
            <button
              className="btn btn-sm"
              disabled={disabled}
              type="button"
              onClick={() => set(setGenerationPreserve(state, conflict.lock, false))}
            >
              {t("interiorFlow.unlock", {
                lock: GENERATION_PRESERVE.find((p) => p.id === conflict.lock)!.label[locale],
              })}
            </button>
            <button
              className="btn btn-sm"
              type="button"
              disabled={disabled}
              onClick={() => set(keepGenerationLock(state, conflict))}
            >
              {t("interiorFlow.keepLock")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
