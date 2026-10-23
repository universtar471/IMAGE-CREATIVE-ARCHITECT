import type { InteriorGenerationState } from "@arch/domain";
import { effectiveGenerationPreserve, GENERATION_CAMERAS } from "@arch/domain";
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
  return (
    <>
      <GenerationChoices
        items={GENERATION_CAMERAS}
        value={state.camera.mode}
        disabled={disabled || effectiveGenerationPreserve(state).camera}
        label={t("interiorFlow.camera")}
        onChange={(mode) =>
          set({ ...state, camera: { mode: mode as InteriorGenerationState["camera"]["mode"] } })
        }
      />
      <div className="btn-row">
        <CameraSyncStatus />
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label={t("multiAngle.openStudio")}
          title={t("multiAngle.openStudio")}
          disabled={disabled}
          onClick={() => {
            useStudio.getState().setModule("camera");
            useStudio.getState().setCenterView("orbit");
          }}
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
