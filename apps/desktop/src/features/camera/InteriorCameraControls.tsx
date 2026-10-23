import type { InteriorGenerationState } from "@arch/domain";
import {
  effectiveGenerationPreserve,
  GENERATION_CAMERAS,
  setGenerationPreserve,
} from "@arch/domain";
import { LockKeyhole, UnlockKeyhole } from "lucide-react";
import { useStudio } from "../../app/store";
import { HelpPopover } from "../../components/common/HelpPopover";
import { useT } from "../../i18n";
import { GenerationChoices } from "../generate/interior/GenerationChoices";
import { GenerationIcon } from "../generate/interior/GenerationIcon";
import { useInteriorGeneration } from "../generate/interior/useInteriorGeneration";
import { CameraSyncStatus } from "./CameraSyncStatus";

/** Shared controls for the Camera inspector and the interior Generate workflow. */
export function InteriorCameraControls({
  state,
  set,
  disabled,
}: {
  state: InteriorGenerationState;
  set: (next: InteriorGenerationState) => void;
  disabled: boolean;
}) {
  const t = useT();
  const locked = effectiveGenerationPreserve(state).camera;
  const openStudio = () => {
    const studio = useStudio.getState();
    studio.setWorkspaceMode("studio");
    studio.setModule("camera");
    studio.setCenterView("orbit");
  };
  return (
    <>
      <div className="segmented" role="group" aria-label={t("variation.cameraMode")}>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={locked}
          onClick={() => set(setGenerationPreserve(state, "camera", true))}
        >
          <LockKeyhole size={15} aria-hidden /> {t("variation.keepCamera")}
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!locked}
          onClick={() => {
            const next = setGenerationPreserve(state, "camera", false);
            set({
              ...next,
              camera: next.camera.mode === "original" ? { mode: "eye_level" } : next.camera,
            });
          }}
        >
          <UnlockKeyhole size={15} aria-hidden /> {t("variation.changeCamera")}
        </button>
      </div>
      {locked && <span className="field-hint">{t("variation.cameraLockedHint")}</span>}
      <GenerationChoices
        items={GENERATION_CAMERAS.filter((item) => item.id !== "original")}
        value={state.camera.mode}
        disabled={disabled || locked}
        label={t("interiorFlow.camera")}
        onChange={(mode) => {
          set({ ...state, camera: { mode: mode as InteriorGenerationState["camera"]["mode"] } });
          if (mode === "studio") openStudio();
        }}
      />
      <div className="btn-row">
        <CameraSyncStatus allowUnlock={false} />
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t("multiAngle.openStudio")}
          title={t("multiAngle.openStudio")}
          disabled={disabled}
          onClick={openStudio}
        >
          <GenerationIcon id="icon-camera-studio" />
        </button>
        {!state.camera.cameraId && !effectiveGenerationPreserve(state).camera && (
          <HelpPopover topic={t("interiorFlow.camera")}>{t("multiAngle.syncHelp")}</HelpPopover>
        )}
      </div>
    </>
  );
}
export function ConnectedInteriorCameraControls({ disabled }: { disabled: boolean }) {
  const { state, set } = useInteriorGeneration();
  return <InteriorCameraControls state={state} set={set} disabled={disabled} />;
}
