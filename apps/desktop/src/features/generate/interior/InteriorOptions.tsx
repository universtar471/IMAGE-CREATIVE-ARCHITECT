import { useState } from "react";
import { Building2, Sun } from "lucide-react";
import {
  GENERATION_LIGHTING,
  generationFromLegacy,
  type InteriorGenerationState,
  type GenerationLight,
} from "@arch/domain";
import { useStudio } from "../../../app/store";
import { Dialog } from "../../../components/common/Dialog";
import { useT } from "../../../i18n";
import { InteriorDnaPanel } from "../../dna/InteriorDnaPanel";
import { GenerationChoices } from "./GenerationChoices";
import { InteriorRecommendation } from "./InteriorRecommendation";

/** Existing space DNA and indoor light choices, accessed from the creation flow. */
export function InteriorOptions({
  state,
  set,
  disabled,
}: {
  state: InteriorGenerationState;
  set: (next: InteriorGenerationState) => void;
  disabled: boolean;
}) {
  const t = useT();
  const ws = useStudio((s) => s.workspace!);
  const [options, setOptions] = useState<{ kind: "space" | "lighting"; roomId?: string } | null>(
    null,
  );
  const close = () => {
    const latest = useStudio.getState().workspace;
    const roomId = latest?.draftDna.interior?.roomId;
    // Space edits (including AI and catalog suggestions) use the original DNA editor.
    // Carry an explicitly changed room back into the structured generation draft.
    if (
      options?.kind === "space" &&
      latest?.project.id === ws.project.id &&
      roomId &&
      roomId !== options.roomId
    ) {
      set({
        ...(latest.shotIntent?.interiorGeneration ?? state),
        room: generationFromLegacy(roomId).room,
      });
    }
    setOptions(null);
  };
  return (
    <>
      <div className="module-actions interior-options">
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => setOptions({ kind: "space", roomId: ws.draftDna.interior?.roomId })}
        >
          <Building2 size={16} aria-hidden /> {t("interior.space")}
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled}
          onClick={() => setOptions({ kind: "lighting" })}
        >
          <Sun size={16} aria-hidden /> {t("interiorFlow.lighting")}
        </button>
      </div>
      {options && (
        <Dialog
          title={t(options.kind === "space" ? "interior.space" : "interiorFlow.lighting")}
          onClose={close}
        >
          {options.kind === "space" ? (
            <fieldset className="region-edit-fields" disabled={disabled}>
              <InteriorDnaPanel />
            </fieldset>
          ) : (
            <>
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
            </>
          )}
        </Dialog>
      )}
    </>
  );
}
